// Each player's stats rebuilt from ESPN's play-by-play: period by period, so
// live prop chances can be fitted and tested on how past games actually
// unfolded (only the backtest reads those; they're stored per league-month
// like box scores), and moment by moment, to replay a tracked parlay's chance
// through its games.
import { cached, limiter, readStore, writeStore } from './cache';
import type { Game } from './espn';
import type { LeagueConfig } from './leagues';
import { clockMinutes } from './model/live';
import type { PropMarket } from './props';

const BASE = 'https://site.api.espn.com/apis/site/v2/sports';
const CORE = 'https://sports.core.api.espn.com/v2/sports';
const VERSION = 'sp1';
const lane = limiter(4);

export type SplitStat =
  | 'pts'
  | 'reb'
  | 'ast'
  | 'stl'
  | 'blk'
  | 'tov'
  | 'goals'
  | 'sog'
  | 'saves'
  | 'pass_yds'
  | 'pass_cmp'
  | 'pass_att'
  | 'pass_td'
  | 'pass_int'
  | 'rush_yds'
  | 'rush_att'
  | 'rec'
  | 'rec_yds';

/**
 * One game, period by period: the home-minus-away margin after each
 * regulation period, and each player's count of every stat per period, with
 * overtime folded into the last one (shootouts left out, as box scores do).
 */
export type PeriodSplits = {
  periods: number;
  margins: number[];
  players: Record<string, Partial<Record<SplitStat, number[]>>>;
};

export const SPLIT_LEAGUES: Record<string, number> = { nba: 4, nhl: 3, nfl: 4 };

/** Which rebuilt stats make up each prop market, per league. */
export const MARKET_PARTS: Record<string, Partial<Record<PropMarket, SplitStat[]>>> = {
  nba: { pts: ['pts'], reb: ['reb'], ast: ['ast'], stl: ['stl'], blk: ['blk'], tov: ['tov'], pra: ['pts', 'reb', 'ast'], pr: ['pts', 'reb'], pa: ['pts', 'ast'], ar: ['ast', 'reb'] },
  nhl: { pts: ['goals', 'ast'], goals: ['goals'], ast: ['ast'], sog: ['sog'], blk: ['blk'], saves: ['saves'] },
  nfl: {
    pass_yds: ['pass_yds'],
    pass_cmp: ['pass_cmp'],
    pass_att: ['pass_att'],
    pass_td: ['pass_td'],
    pass_int: ['pass_int'],
    pass_rush_yds: ['pass_yds', 'rush_yds'],
    rush_yds: ['rush_yds'],
    rush_att: ['rush_att'],
    rec_yds: ['rec_yds'],
    rec: ['rec'],
    rush_rec_yds: ['rush_yds', 'rec_yds']
  }
};

/** Minutes in a regulation period, and whether the play-by-play clock counts up (hockey's does) or down. */
const CLOCK: Record<string, { minutes: number; up: boolean }> = { nba: { minutes: 12, up: false }, nhl: { minutes: 20, up: true }, nfl: { minutes: 15, up: false } };

/** Credits a player with `n` (default 1) of a stat on the play at hand. */
type Credit = (id: unknown, stat: SplitStat, n?: number) => void;

/** Yards on a football play as its text tells it: the first "for N yards" or "for no gain", or a scoring line's "21 Yd pass". */
function footballYards(text: string) {
  const m = text.match(/for (-?\d+) yards?\b|for no gain|\b(\d+) Yd (?:pass|run)\b/i);
  return m ? Number(m[1] ?? m[2] ?? 0) : null;
}

/** A player as the play text names him ("J.Smith-Schuster"). */
const NAME = "[A-Z][A-Za-z]*\\.[A-Za-z'-]+";
const MARKER = '(?:[A-Z]{2,3} )?\\d{1,2}';

/**
 * A gain cut back by a foul: when a penalty is marked off from a spot between
 * the line of scrimmage and where the play ended, only the yards to that spot
 * count. Which side of the field a marker like "DEN 11" is on comes from
 * matching where the play ended against the line and the gain.
 */
function creditedYards(p: any, text: string, gain: number) {
  const line = Number(p?.start?.yardsToEndzone);
  const end = text.match(new RegExp(`\\b(?:to|at) (${MARKER}) for -?\\d+ yards?`))?.[1];
  const spot = text.match(new RegExp(`enforced at (${MARKER})\\b`))?.[1];
  if (gain <= 0 || !end || !spot || !Number.isFinite(line)) return gain;
  const endsAt = line - gain;
  const [endSide, endYard] = end.includes(' ') ? end.split(' ') : [null, end];
  const [spotSide, spotYard] = spot.includes(' ') ? spot.split(' ') : [null, spot];
  if (endSide === null) return gain;
  // Yards to the end zone from a marker on the defense's side are the marker itself; from the offense's, 100 less it.
  const defense = Number(endYard) === endsAt ? endSide : 100 - Number(endYard) === endsAt ? null : undefined;
  if (defense === undefined) return gain;
  const spotAt = spotSide === null ? 50 : (spotSide === endSide) === (defense !== null) ? Number(spotYard) : 100 - Number(spotYard);
  return spotAt >= endsAt && spotAt <= line ? line - spotAt : gain;
}

/**
 * A football play's passing, rushing and catching, by who's tagged as
 * passer, rusher and receiver. Plays wiped out by a penalty don't count, nor
 * do sacks (not a pass attempt, and a passer's yards are counted before them)
 * or two-point tries; after a replay reversal, the play as it was ruled. A
 * botched snap is a carry for no yards and a lateral's yards go to whoever
 * ran with it, as the official scorers count them.
 */
function footballPlay(p: any, credit: Credit, names: Map<string, string>) {
  const type = String(p?.type?.text ?? '');
  const ruled = String(p?.text ?? '')
    .split(/TWO-POINT CONVERSION/i)[0]
    .split(/REVERSED\.\s*/i);
  const text = ruled[ruled.length - 1];
  if (!text.trim() || /no play/i.test(text) || /penalty|two-point/i.test(type) || /sacked/i.test(text)) return;
  const first = (role: string) => (p.participants ?? []).find((x: any) => x?.type === role)?.athlete?.$ref?.match(/athletes\/(\d+)/)?.[1];
  if (/aborted/i.test(text)) {
    credit(first('rusher'), 'rush_att');
    return;
  }
  const lateral = text.match(new RegExp(`Lateral to (${NAME})[^.]*? for (-?\\d+) yards?`, 'i'));
  const extra = lateral ? Number(lateral[2]) : 0;
  const passer = first('passer');
  if (passer && !/^Rush/.test(type)) {
    if (/INTERCEPTED/.test(text)) {
      credit(passer, 'pass_att');
      credit(passer, 'pass_int');
    } else if (/incomplete|spiked/i.test(text)) {
      credit(passer, 'pass_att');
    } else if (/\bpass\b/i.test(text)) {
      const gain = footballYards(text);
      const receiver = first('receiver');
      if (gain === null || !receiver) return;
      const yards = creditedYards(p, text, gain);
      credit(passer, 'pass_att');
      credit(passer, 'pass_cmp');
      credit(passer, 'pass_yds', yards + extra);
      if (type === 'Passing Touchdown') credit(passer, 'pass_td');
      credit(receiver, 'rec');
      credit(receiver, 'rec_yds', yards);
      if (lateral) credit(names.get(lateral[1]), 'rec_yds', extra);
    }
    return;
  }
  const rusher = first('rusher');
  const gain = footballYards(text);
  if (!rusher) return;
  credit(rusher, 'rush_att');
  credit(rusher, 'rush_yds', gain === null ? 0 : creditedYards(p, text, gain));
  if (lateral) credit(names.get(lateral[1]), 'rush_yds', extra);
}

/** Basketball: points and assists on made shots, rebounds, turnovers, steals and blocks, by who's listed first and second. */
function basketballPlay(p: any, credit: Credit) {
  const ids: string[] = (p.participants ?? []).map((x: any) => x?.athlete?.id).filter(Boolean);
  const type = String(p?.type?.text ?? '');
  const text = String(p?.text ?? '');
  if (p.scoringPlay && Number(p.scoreValue) > 0) {
    credit(ids[0], 'pts', Number(p.scoreValue));
    if (/assists?\)/i.test(text)) credit(ids[1], 'ast');
  }
  if (/rebound/i.test(type)) credit(ids[0], 'reb');
  // "Traveling" and the like have their own type; the text always says turnover.
  if (/turnover/i.test(text)) credit(ids[0], 'tov');
  if (/steals?\)/i.test(text)) credit(ids[1], 'stl');
  // "X blocks Y's layup": the shooter is listed first, the blocker second.
  if (/\bblocks\b/i.test(text)) credit(ids[1], 'blk');
}

/** Hockey: goals (also shots on goal) and assists, shots and the saves on them, blocked shots, by tagged role. */
function hockeyPlay(p: any, credit: Credit) {
  const ids: string[] = (p.participants ?? []).map((x: any) => x?.athlete?.id).filter(Boolean);
  const roles: string[] = (p.participants ?? []).map((x: any) => String(x?.type ?? ''));
  const type = String(p?.type?.text ?? '');
  const who = (role: string) => ids.filter((_, i) => roles[i] === role);
  if (type === 'Goal') {
    for (const id of who('scorer')) {
      credit(id, 'goals');
      credit(id, 'sog');
    }
    for (const id of who('assister')) credit(id, 'ast');
  } else if (type === 'Shot') {
    for (const id of who('shooter')) credit(id, 'sog');
    for (const id of who('saver')) credit(id, 'saves');
  } else if (type === 'Blocked') {
    for (const id of who('defender')) credit(id, 'blk');
  }
}

/** A game's plays, each with its regulation period (0-based; overtime folded into the last) and its credits; shootouts left out. */
function* creditedPlays(league: string, plays: any[]) {
  const periods = SPLIT_LEAGUES[league];
  const names = league === 'nfl' ? footballNames(plays) : new Map<string, string>();
  for (const p of plays) {
    const number = Number(p?.period?.number);
    if (!Number.isFinite(number) || number < 1) continue;
    // Hockey's fifth "period" is the shootout, which box scores leave out.
    if (league === 'nhl' && number > 4) continue;
    const credits: [string, SplitStat, number][] = [];
    const credit: Credit = (id, stat, n = 1) => {
      if (id) credits.push([String(id), stat, n]);
    };
    if (league === 'nfl') footballPlay(p, credit, names);
    else if (league === 'nba') basketballPlay(p, credit);
    else hockeyPlay(p, credit);
    yield { play: p, number, period: Math.min(number, periods) - 1, credits };
  }
}

/** Who's who in a game's play text: the abbreviated names of tagged passers' targets and runners, to their ids. */
function footballNames(plays: any[]) {
  const names = new Map<string, string>();
  const id = (p: any, role: string) => (p.participants ?? []).find((x: any) => x?.type === role)?.athlete?.$ref?.match(/athletes\/(\d+)/)?.[1];
  for (const p of plays) {
    const text = String(p?.text ?? '');
    const target = text.match(new RegExp(`\\bpass (?:\\w+ )*?to (${NAME})`))?.[1];
    const runner = text.replace(/^(\s*\([^)]*\))*\s*/, '').match(new RegExp(`^(${NAME})`))?.[1];
    if (target && id(p, 'receiver')) names.set(target, id(p, 'receiver'));
    if (runner && id(p, 'rusher') && !id(p, 'passer')) names.set(runner, id(p, 'rusher'));
  }
  return names;
}

/** Rebuilds the period splits from a game's plays; null when there are none. */
export function parseSplits(league: string, data: any): PeriodSplits | null {
  const periods = SPLIT_LEAGUES[league];
  const plays: any[] = data?.plays ?? [];
  if (!periods || !plays.length) return null;
  const players: PeriodSplits['players'] = {};
  const margins = new Array<number>(periods).fill(0);
  for (const { play: p, number, period, credits } of creditedPlays(league, plays)) {
    if (number <= periods && Number.isFinite(Number(p.homeScore)) && Number.isFinite(Number(p.awayScore))) margins[period] = Number(p.homeScore) - Number(p.awayScore);
    for (const [id, stat, n] of credits) {
      const row = (players[id] ??= {});
      (row[stat] ??= new Array<number>(periods).fill(0))[period] += n;
    }
  }
  return { periods, margins, players };
}

/**
 * One play: when it happened (wall clock, ms), the share of regulation done
 * by then (overtime counts as all of it), the home-minus-away score after it,
 * and who was credited with what.
 */
export type PlayMoment = { t: number; played: number; margin: number; credits: [string, SplitStat, number][] };

/** A game's plays as moments, in order; plays without a wall-clock time are skipped. */
export function playMoments(league: string, data: any): PlayMoment[] {
  const periods = SPLIT_LEAGUES[league];
  const clock = CLOCK[league];
  const plays: any[] = data?.plays ?? [];
  if (!periods || !clock) return [];
  const out: PlayMoment[] = [];
  let margin = 0;
  let last = -Infinity;
  for (const { play: p, number, credits } of creditedPlays(league, plays)) {
    const at = Date.parse(String(p?.wallclock ?? ''));
    if (!Number.isFinite(at)) continue;
    if (Number.isFinite(Number(p.homeScore)) && Number.isFinite(Number(p.awayScore))) margin = Number(p.homeScore) - Number(p.awayScore);
    const minutes = clockMinutes(p?.clock?.displayValue);
    const into = minutes === null ? 0 : Math.max(0, Math.min(clock.minutes, clock.up ? minutes : clock.minutes - minutes));
    const played = number > periods ? 1 : ((number - 1) * clock.minutes + into) / (periods * clock.minutes);
    // The feed's wall clock can step back a second on a corrected play; keep time moving forward.
    last = Math.max(last, at);
    out.push({ t: last, played: Math.min(1, played), margin, credits });
  }
  return out;
}

async function fetchJson(url: string): Promise<any> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const res = await lane(() => fetch(url, { cache: 'no-store', headers: { accept: 'application/json' }, signal: AbortSignal.timeout(30_000) }));
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`ESPN responded ${res.status}`);
      return await res.json();
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
    }
  }
  throw new Error(`Couldn't load ${url}`);
}

/** A game's plays: basketball and hockey from the summary; football from the core feed, which tags passer, rusher and receiver. */
async function loadPlays(league: LeagueConfig, gameId: string): Promise<any> {
  if (league.id !== 'nfl') return fetchJson(`${BASE}/${league.espnPath}/summary?event=${gameId}`);
  const url = `${CORE}/football/leagues/nfl/events/${gameId}/competitions/${gameId}/plays?limit=400`;
  const first = await fetchJson(url);
  if (!first) return null;
  const plays: any[] = [...(first.items ?? [])];
  for (let page = 2; page <= Number(first.pageCount ?? 1); page += 1) plays.push(...((await fetchJson(`${url}&page=${page}`))?.items ?? []));
  return { plays };
}

/** A game's moments: read again at most every 45 seconds while it's on, kept for good once it's final. */
export function getPlayMoments(league: LeagueConfig, gameId: string, final: boolean): Promise<PlayMoment[]> {
  return cached(
    `espn-${VERSION}-${league.id}-moments-${gameId}-${final ? 'final' : 'live'}`,
    { ttlMs: 45_000, persist: final, isFinal: () => final },
    async () => {
      const moments = playMoments(league.id, await loadPlays(league, gameId));
      // Never keep an empty final for good: the feed can lag the final whistle.
      if (final && !moments.length) throw new Error(`No plays yet for ${gameId}`);
      return moments;
    }
  );
}

/** Period splits for finished games; `fetchUpTo` caps how many missing games are fetched in this call. */
export async function getPlaySplits(league: LeagueConfig, games: Game[], fetchUpTo = Infinity) {
  const result: Record<string, PeriodSplits | null> = {};
  if (!SPLIT_LEAGUES[league.id]) return result;
  const byMonth = new Map<string, Game[]>();
  for (const g of games) {
    if (!g.completed) continue;
    const month = g.date.slice(0, 7).replace('-', '');
    byMonth.set(month, [...(byMonth.get(month) ?? []), g]);
  }
  let budget = fetchUpTo;
  for (const [month, monthGames] of [...byMonth].sort((a, b) => b[0].localeCompare(a[0]))) {
    const key = `espn-${VERSION}-${league.id}-splits-${month}`;
    const store = (await readStore<Record<string, PeriodSplits | null>>(key)) ?? {};
    const missing = monthGames.filter((g) => !(g.id in store)).slice(0, Math.max(0, budget));
    if (missing.length) {
      budget -= missing.length;
      await Promise.all(
        missing.map(async (g) => {
          try {
            store[g.id] = parseSplits(league.id, await loadPlays(league, g.id));
          } catch {
            // Leave it unfetched; the next run retries.
          }
        })
      );
      await writeStore(key, store);
    }
    for (const g of monthGames) if (g.id in store) result[g.id] = store[g.id];
  }
  return result;
}
