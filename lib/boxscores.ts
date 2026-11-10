// Player box scores from ESPN's game summary endpoint, stored compactly per
// league-month. They feed the lineup model (NBA), the goalie model (NHL) and
// the quarterback model (NFL).
import { cached, limiter, readStore, writeStore } from './cache';
import type { Game } from './espn';
import type { LeagueConfig } from './leagues';
import { log } from './log';

const BASE ='https://site.api.espn.com/apis/site/v2/sports';
// Bump a league's version when its stored shape changes so its months are re-read.
const VERSION: Record<string, string> = { nba: 'b1', nfl: 'b1', nhl: 'b2' };
// Summaries are large; their own lane keeps them from starving page data.
const lane = limiter(6);

export type NbaLine = {
  id: string;
  name: string;
  starter: boolean;
  /** Minutes played; 0 for players who didn't play. */
  min: number;
  pts: number;
  fgm: number;
  fga: number;
  ftm: number;
  fta: number;
  oreb: number;
  dreb: number;
  ast: number;
  stl: number;
  blk: number;
  tov: number;
  pf: number;
  pm: number;
  /** Didn't play, with ESPN's reason ("COACH'S DECISION", "LEFT ANKLE SPRAIN"…). */
  dnp: boolean;
  reason: string | null;
};

export type NhlGoalieLine = { id: string; name: string; toi: number; sa: number; ga: number };
/** `sog` is shots on goal; `bs` blocked shots. */
export type NhlSkaterLine = { id: string; name: string; toi: number; g: number; a: number; sog: number; bs: number };

/** One player's passing line, with his own runs (QB scrambles and designed runs) and lost fumbles. */
export type NflPasserLine = {
  id: string;
  name: string;
  att: number;
  cmp: number;
  yds: number;
  td: number;
  int: number;
  sacks: number;
  sackYds: number;
  rushAtt: number;
  rushYds: number;
  rushTd: number;
  fumLost: number;
};
export type NflTeamBox = {
  /** The quarterback who started, from ESPN's game roster (most pass attempts when that's missing). */
  starter: { id: string; name: string } | null;
  passers: NflPasserLine[];
};

export type BoxScore =
  | { league: 'nba'; teams: Record<string, NbaLine[]> }
  | { league: 'nhl'; teams: Record<string, { goalies: NhlGoalieLine[]; skaters: NhlSkaterLine[] }> }
  | { league: 'nfl'; teams: Record<string, NflTeamBox> };

export const BOX_LEAGUES = ['nba', 'nhl', 'nfl'] as const;
export const hasBoxScores = (league: LeagueConfig) => (BOX_LEAGUES as readonly string[]).includes(league.id);

async function fetchJson(url: string): Promise<any> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await lane(async () => {
        const res = await fetch(url, { cache: 'no-store', headers: { accept: 'application/json' }, signal: AbortSignal.timeout(30_000) });
        if (!res.ok) {
          const error = new Error(`ESPN responded ${res.status} for ${url}`) as Error & { fatal?: boolean };
          if (res.status < 500) error.fatal = true;
          throw error;
        }
        return res.json();
      });
    } catch (error) {
      lastError = error;
      if ((error as { fatal?: boolean }).fatal) break;
      await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
    }
  }
  throw lastError;
}

const num = (value: unknown) => {
  const n = typeof value === 'number' ? value : Number.parseFloat(String(value ?? '').replace('+', ''));
  return Number.isFinite(n) ? n : 0;
};
const pair = (value: unknown): [number, number] => {
  const [a, b] = String(value ?? '').split('-');
  return [num(a), num(b)];
};
/** "13:27" → 13.45 minutes. */
const clock = (value: unknown) => {
  const [m, s] = String(value ?? '').split(':');
  return num(m) + num(s) / 60;
};

function parseNba(data: any): BoxScore | null {
  const teams: Record<string, NbaLine[]> = {};
  for (const side of data?.boxscore?.players ?? []) {
    const group = side?.statistics?.[0];
    const keys: string[] = group?.keys ?? [];
    const at = (stats: string[], key: string) => stats[keys.indexOf(key)];
    teams[String(side.team?.id)] = (group?.athletes ?? [])
      .filter((a: any) => a?.athlete?.id)
      .map((a: any): NbaLine => {
        const s: string[] = a.stats ?? [];
        const played = !a.didNotPlay && s.length > 0;
        const [fgm, fga] = pair(at(s, 'fieldGoalsMade-fieldGoalsAttempted'));
        const [ftm, fta] = pair(at(s, 'freeThrowsMade-freeThrowsAttempted'));
        return {
          id: String(a.athlete.id),
          name: a.athlete.displayName ?? 'Unknown',
          starter: Boolean(a.starter),
          min: played ? num(at(s, 'minutes')) : 0,
          pts: num(at(s, 'points')),
          fgm,
          fga,
          ftm,
          fta,
          oreb: num(at(s, 'offensiveRebounds')),
          dreb: num(at(s, 'defensiveRebounds')),
          ast: num(at(s, 'assists')),
          stl: num(at(s, 'steals')),
          blk: num(at(s, 'blocks')),
          tov: num(at(s, 'turnovers')),
          pf: num(at(s, 'fouls')),
          pm: num(at(s, 'plusMinus')),
          dnp: !played,
          reason: a.reason ?? null
        };
      });
  }
  return Object.keys(teams).length === 2 ? { league: 'nba', teams } : null;
}

function parseNhl(data: any): BoxScore | null {
  const teams: Record<string, { goalies: NhlGoalieLine[]; skaters: NhlSkaterLine[] }> = {};
  for (const side of data?.boxscore?.players ?? []) {
    const goalies: NhlGoalieLine[] = [];
    const skaters: NhlSkaterLine[] = [];
    for (const group of side?.statistics ?? []) {
      // Keys, not labels: the label "SOG" is shootout goals; shots on goal are "S" (shotsTotal).
      const keys: string[] = group?.keys ?? [];
      const at = (stats: string[], key: string) => stats[keys.indexOf(key)];
      for (const a of group?.athletes ?? []) {
        const s: string[] = a?.stats ?? [];
        if (!a?.athlete?.id || !s.length) continue;
        const base = { id: String(a.athlete.id), name: a.athlete.displayName ?? 'Unknown', toi: clock(at(s, 'timeOnIce')) };
        if (group.name === 'goalies') goalies.push({ ...base, sa: num(at(s, 'shotsAgainst')), ga: num(at(s, 'goalsAgainst')) });
        else if (group.name === 'forwards' || group.name === 'defenses')
          skaters.push({ ...base, g: num(at(s, 'goals')), a: num(at(s, 'assists')), sog: num(at(s, 'shotsTotal')), bs: num(at(s, 'blockedShots')) });
      }
    }
    teams[String(side.team?.id)] = { goalies, skaters };
  }
  return Object.keys(teams).length === 2 ? { league: 'nhl', teams } : null;
}

const QB_POSITION = /\/positions\/8\b/;

/** NFL passers from the summary; `starters` maps team id to the starting QB from ESPN's game rosters. */
export function parseNfl(data: any, starters: Record<string, { id: string; name: string } | null> = {}): BoxScore | null {
  const teams: Record<string, NflTeamBox> = {};
  for (const side of data?.boxscore?.players ?? []) {
    const teamId = String(side.team?.id);
    const group = (name: string) => (side?.statistics ?? []).find((g: any) => g?.name === name);
    const rows = (name: string) => {
      const g = group(name);
      const keys: string[] = g?.keys ?? [];
      return new Map<string, { name: string; at: (key: string) => string }>(
        (g?.athletes ?? [])
          .filter((a: any) => a?.athlete?.id)
          .map((a: any) => [String(a.athlete.id), { name: a.athlete.displayName ?? 'Unknown', at: (key: string) => (a.stats ?? [])[keys.indexOf(key)] }])
      );
    };
    const rushing = rows('rushing');
    const fumbles = rows('fumbles');
    const passers = [...rows('passing')].map(([id, p]): NflPasserLine => {
      const [cmp, att] = String(p.at('completions/passingAttempts') ?? '').split('/').map(num);
      const [sacks, sackYds] = pair(p.at('sacks-sackYardsLost'));
      const rush = rushing.get(id);
      return {
        id,
        name: p.name,
        att: att ?? 0,
        cmp: cmp ?? 0,
        yds: num(p.at('passingYards')),
        td: num(p.at('passingTouchdowns')),
        int: num(p.at('interceptions')),
        sacks,
        sackYds,
        rushAtt: rush ? num(rush.at('rushingAttempts')) : 0,
        rushYds: rush ? num(rush.at('rushingYards')) : 0,
        rushTd: rush ? num(rush.at('rushingTouchdowns')) : 0,
        fumLost: num(fumbles.get(id)?.at('fumblesLost'))
      };
    });
    const busiest = [...passers].sort((a, b) => b.att + b.sacks - (a.att + a.sacks))[0];
    const listed = starters[teamId];
    teams[teamId] = {
      starter: listed ? { id: listed.id, name: passers.find((p) => p.id === listed.id)?.name ?? listed.name } : busiest ? { id: busiest.id, name: busiest.name } : null,
      passers
    };
  }
  return Object.keys(teams).length === 2 ? { league: 'nfl', teams } : null;
}

/** The starting quarterback in ESPN's roster for one team in one game. */
async function nflStarter(league: LeagueConfig, gameId: string, teamId: string) {
  const [sport, slug] = league.espnPath.split('/');
  const data = await fetchJson(`https://sports.core.api.espn.com/v2/sports/${sport}/leagues/${slug}/events/${gameId}/competitions/${gameId}/competitors/${teamId}/roster`);
  const entry = (data?.entries ?? []).find((e: any) => e?.starter && QB_POSITION.test(String(e?.position?.$ref ?? '')));
  return entry ? { id: String(entry.playerId), name: String(entry.displayName ?? 'Unknown') } : null;
}

async function fetchNfl(league: LeagueConfig, game: Game) {
  const [data, ...starters] = await Promise.all([
    fetchJson(`${BASE}/${league.espnPath}/summary?event=${game.id}`),
    // The roster flag survives a starter hurt on the first drive; without it, most attempts stands in.
    ...[game.home.teamId, game.away.teamId].map((teamId) => nflStarter(league, game.id, teamId).catch(() => null))
  ]);
  return parseNfl(data, { [game.home.teamId]: starters[0], [game.away.teamId]: starters[1] });
}

/** One NFL player's rushing and receiving line. */
export type NflSkillLine = { id: string; name: string; rushAtt: number; rushYds: number; rushTd: number; tgt: number; rec: number; recYds: number; recTd: number };
export type NflSkillBox = { teams: Record<string, NflSkillLine[]> };

/** Every rusher and receiver from an NFL summary, merged per player. */
export function parseNflSkill(data: any): NflSkillBox | null {
  const teams: Record<string, NflSkillLine[]> = {};
  for (const side of data?.boxscore?.players ?? []) {
    const lines = new Map<string, NflSkillLine>();
    const lineFor = (a: any) => {
      const id = String(a.athlete.id);
      const line = lines.get(id) ?? { id, name: a.athlete.displayName ?? 'Unknown', rushAtt: 0, rushYds: 0, rushTd: 0, tgt: 0, rec: 0, recYds: 0, recTd: 0 };
      lines.set(id, line);
      return line;
    };
    for (const group of side?.statistics ?? []) {
      if (group?.name !== 'rushing' && group?.name !== 'receiving') continue;
      const keys: string[] = group.keys ?? [];
      for (const a of group.athletes ?? []) {
        if (!a?.athlete?.id) continue;
        const at = (key: string) => num((a.stats ?? [])[keys.indexOf(key)]);
        const line = lineFor(a);
        if (group.name === 'rushing') {
          line.rushAtt = at('rushingAttempts');
          line.rushYds = at('rushingYards');
          line.rushTd = at('rushingTouchdowns');
        } else {
          line.rec = at('receptions');
          line.recYds = at('receivingYards');
          line.recTd = at('receivingTouchdowns');
          line.tgt = at('receivingTargets');
        }
      }
    }
    teams[String(side.team?.id)] = [...lines.values()];
  }
  return Object.keys(teams).length === 2 ? { teams } : null;
}

const SKILL_VERSION = 's1';

export type LiveBox = {
  box: BoxScore | null;
  skill: NflSkillBox | null;
  /** "5:18 - 3rd" */
  status: string | null;
  period: number | null;
  /** The game clock as shown, "5:18". */
  clock: string | null;
  /** Home minus away right now. */
  margin: number | null;
};

/** The box score so far for a game in progress, with its clock and score, re-read at most every 30 seconds and never stored. */
export function getLiveBox(league: LeagueConfig, gameId: string): Promise<LiveBox> {
  return cached(`espn-${league.id}-livebox-${gameId}`, { ttlMs: 30_000 }, async () => {
    if (!hasBoxScores(league)) return { box: null, skill: null, status: null, period: null, clock: null, margin: null };
    const data = await fetchJson(`${BASE}/${league.espnPath}/summary?event=${gameId}`);
    const competition = data?.header?.competitions?.[0];
    const score = (side: string) => Number(competition?.competitors?.find((c: any) => c?.homeAway === side)?.score);
    const margin = score('home') - score('away');
    const clockState = {
      status: competition?.status?.type?.shortDetail ?? null,
      period: Number.isFinite(Number(competition?.status?.period)) ? Number(competition.status.period) : null,
      clock: competition?.status?.displayClock ?? null,
      margin: Number.isFinite(margin) ? margin : null
    };
    if (league.id === 'nfl') return { box: parseNfl(data), skill: parseNflSkill(data), ...clockState };
    return { box: (league.id === 'nba' ? parseNba : parseNhl)(data), skill: null, ...clockState };
  });
}

/**
 * Official scorers correct stats after a game: on a November 2026 check, 19 of
 * 84 NBA box scores stored at the final whistle had since changed (an assist or
 * a steal moved to a teammate), and a prop can turn on one of those. So a box
 * score only counts as settled once it has been read this long after the start.
 */
export const SETTLE_MS = 72 * 3_600_000;
/** Older games needn't be read again: everything stored at the whistle is younger than this by the time it matters, and older months were filled long after they finished. */
export const REREAD_WINDOW_MS = 60 * 86_400_000;

/** Which games to fetch out of a budget: the ones never stored first, then the stored ones not yet read since they settled. */
export function boxesToFetch<G extends Pick<Game, 'id' | 'date'>>(games: G[], store: Record<string, unknown>, settled: Record<string, true>, budget: number, now: number) {
  const room = Math.max(0, budget);
  const missing = games.filter((g) => !(g.id in store)).slice(0, room);
  const unsettled = games
    .filter((g) => {
      const age = now - Date.parse(g.date);
      return g.id in store && !settled[g.id] && age >= SETTLE_MS && age <= REREAD_WINDOW_MS;
    })
    .slice(0, room - missing.length);
  return { missing, unsettled };
}

/** One month's stored box scores, with what a budget allows fetched or read again. */
export async function fillMonth<T>(
  key: string,
  games: Game[],
  budget: number,
  load: (g: Game) => Promise<T | null>,
  now = Date.now(),
  io: { read: <V>(k: string) => Promise<V | null>; write: <V>(k: string, v: V) => Promise<unknown> } = { read: readStore, write: writeStore }
) {
  const store = (await io.read<Record<string, T | null>>(key)) ?? {};
  const settledKey = `${key}-settled`;
  const settled = (await io.read<Record<string, true>>(settledKey)) ?? {};
  const { missing, unsettled } = boxesToFetch(games, store, settled, budget, now);
  const wanted = [...missing, ...unsettled];
  if (wanted.length) {
    let changed = 0;
    await Promise.all(
      wanted.map(async (g) => {
        try {
          const before = store[g.id];
          const fresh = await load(g);
          // A hiccup on a second read never wipes a good copy; it stays unsettled and the next run tries again.
          if (fresh === null && before) return;
          if (before && JSON.stringify(before) !== JSON.stringify(fresh)) changed += 1;
          store[g.id] = fresh;
          if (now - Date.parse(g.date) >= SETTLE_MS) settled[g.id] = true;
        } catch {
          // Leave it as it was; the next run retries.
        }
      })
    );
    await io.write(key, store);
    await io.write(settledKey, settled);
    if (unsettled.length) log('info', 'box-scores-reread', { key, reread: unsettled.length, changed });
  }
  return { store, spent: wanted.length };
}

/** Rushing and receiving box scores for finished NFL games, stored and filled like the other box scores. */
export async function getNflSkillBoxes(league: LeagueConfig, games: Game[], fetchUpTo = Infinity) {
  const result: Record<string, NflSkillBox | null> = {};
  if (league.id !== 'nfl') return result;
  const byMonth = new Map<string, Game[]>();
  for (const g of games) {
    if (!g.completed) continue;
    const month = g.date.slice(0, 7).replace('-', '');
    byMonth.set(month, [...(byMonth.get(month) ?? []), g]);
  }
  let budget = fetchUpTo;
  for (const [month, monthGames] of [...byMonth].sort((a, b) => b[0].localeCompare(a[0]))) {
    const key = `espn-${SKILL_VERSION}-nfl-skill-${month}`;
    const { store, spent } = await fillMonth<NflSkillBox>(key, monthGames, budget, async (g) => parseNflSkill(await fetchJson(`${BASE}/${league.espnPath}/summary?event=${g.id}`)));
    budget -= spent;
    for (const g of monthGames) if (g.id in store) result[g.id] = store[g.id];
  }
  return result;
}

export type RosterEntry = { id: string; name: string; position?: string };

/** A team's quarterbacks in depth-chart order (NFL), for who starts an upcoming game. */
export function getQbDepthChart(league: LeagueConfig, teamId: string) {
  return cached(`espn-${league.id}-qbdepth-${teamId}`, { ttlMs: 3 * 60 * 60_000, persist: true }, async () => {
    const data = await fetchJson(`${BASE}/${league.espnPath}/teams/${teamId}/depthcharts`);
    const chart = (data?.depthchart ?? []).find((c: any) => c?.positions?.qb);
    return (chart?.positions?.qb?.athletes ?? [])
      .filter((a: any) => a?.id)
      .map((a: any): RosterEntry => ({ id: String(a.id), name: a.displayName ?? 'Unknown' }));
  });
}

/**
 * Everyone on a roster from ESPN's answer: the NBA's is a flat list of players,
 * the NFL's and NHL's are grouped by position, with the players under `items`.
 */
export function parseRoster(data: any): RosterEntry[] {
  return (data?.athletes ?? [])
    .flatMap((a: any) => (Array.isArray(a?.items) ? a.items : [a]))
    .filter((a: any) => a?.id)
    .map((a: any): RosterEntry => ({ id: String(a.id), name: a.displayName ?? a.fullName ?? 'Unknown', ...(a.position?.abbreviation ? { position: String(a.position.abbreviation) } : {}) }));
}

/** A team's current roster, which catches trades, signings and demotions before the next game shows them. */
export function getTeamRoster(league: LeagueConfig, teamId: string) {
  // `roster3` has positions; before `roster2`, files held empty lists for the leagues that group by position.
  return cached(`espn-${league.id}-roster3-${teamId}`, { ttlMs: 6 * 60 * 60_000, persist: true }, async () => parseRoster(await fetchJson(`${BASE}/${league.espnPath}/teams/${teamId}/roster`)));
}

/**
 * Box scores for finished games, filled incrementally like closing lines.
 * `fetchUpTo` caps how many games are fetched in this call, new or read again
 * once settled. null means ESPN had no usable box score; a missing key means
 * "not fetched yet".
 */
export async function getBoxScores(league: LeagueConfig, games: Game[], fetchUpTo = Infinity) {
  if (!hasBoxScores(league)) return {} as Record<string, BoxScore | null>;
  const load =
    league.id === 'nfl'
      ? (g: Game) => fetchNfl(league, g)
      : async (g: Game) => (league.id === 'nba' ? parseNba : parseNhl)(await fetchJson(`${BASE}/${league.espnPath}/summary?event=${g.id}`));
  const byMonth = new Map<string, Game[]>();
  for (const g of games) {
    if (!g.completed) continue;
    const month = g.date.slice(0, 7).replace('-', '');
    byMonth.set(month, [...(byMonth.get(month) ?? []), g]);
  }
  const result: Record<string, BoxScore | null> = {};
  let budget = fetchUpTo;
  for (const [month, monthGames] of [...byMonth].sort((a, b) => b[0].localeCompare(a[0]))) {
    const key = `espn-${VERSION[league.id] ?? 'b1'}-${league.id}-box-${month}`;
    const { store, spent } = await fillMonth<BoxScore>(key, monthGames, budget, load);
    budget -= spent;
    for (const g of monthGames) if (g.id in store) result[g.id] = store[g.id];
  }
  return result;
}
