// ESPN payloads are untyped JSON (`any`); everything is narrowed in the parse* functions below.
import { cached, limiter, readStore, writeStore } from './cache';
import { LeagueConfig, LeagueId, monthsToLoad } from './leagues';
import { etYmd } from './time';

const BASE = 'https://site.api.espn.com/apis/site/v2/sports';
const CORE = 'https://sports.core.api.espn.com/v2/sports';
// Bump when the parsed Game shape changes so cached months are re-read.
const VERSION = 'v3';
const throttle = limiter(4);
// Historical odds are many small requests; they get their own lane so they never block page data.
const oddsThrottle = limiter(6);

export type TeamInfo = {
  id: string;
  abbr: string;
  name: string;
  shortName: string;
  logo: string | null;
  color: string | null;
  altColor?: string | null;
};

export type Leader = { category: string; athleteId: string; name: string; position: string | null; value: string };

/** Announced starting pitcher (MLB) or goalie (NHL). Stats are only published for pitchers. */
export type Probable = {
  athleteId: string;
  name: string;
  role: 'pitcher' | 'goalie';
  era: number | null;
  wins: number | null;
  losses: number | null;
};

export type GameSide = {
  teamId: string;
  abbr: string;
  name: string;
  shortName: string;
  logo: string | null;
  /** The team's colors as ESPN lists them ("#0e2240"); missing from games stored before they were kept. */
  color?: string | null;
  altColor?: string | null;
  score: number | null;
  winner: boolean | null;
  record: string | null;
  leaders: Leader[];
  probable: Probable | null;
  /** Points, goals or runs in each period (quarter, period, inning) played so far. */
  periods: number[];
};

export type MarketOdds = {
  provider: string;
  details: string | null;
  /** Spread from the home team's side: negative means the home team is favored. */
  homeSpread: number | null;
  overUnder: number | null;
  homeMoneyline: number | null;
  awayMoneyline: number | null;
};

export type GameState = 'pre' | 'in' | 'post';

export type Game = {
  id: string;
  league: LeagueId;
  date: string;
  seasonYear: number;
  /** 1 preseason, 2 regular season, 3 postseason. */
  seasonType: number;
  state: GameState;
  completed: boolean;
  statusName: string;
  statusDetail: string;
  /** Current period (quarter, period, inning) and clock while the game is on; null otherwise. */
  period: number | null;
  clock: string | null;
  /** Outs in the current half-inning (MLB, live only). */
  outs: number | null;
  neutral: boolean;
  venue: string | null;
  /** The forecast for an outdoor game still to come; ESPN drops it once a game is played. */
  weather?: { text: string; temperature: number } | null;
  broadcast: string | null;
  note: string | null;
  home: GameSide;
  away: GameSide;
  odds: MarketOdds | null;
};

export type SeasonLeader = { category: string; athleteId: string; value: number; display: string };

export type InjuryEntry = {
  athleteId: string;
  name: string;
  position: string | null;
  status: string;
  comment: string | null;
  date: string | null;
};

export async function fetchJson(url: string, lane = throttle): Promise<any> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await lane(async () => {
        const res = await fetch(url, {
          cache: 'no-store',
          headers: { accept: 'application/json' },
          signal: AbortSignal.timeout(30_000)
        });
        if (!res.ok) {
          const error = new Error(`ESPN responded ${res.status} for ${url}`);
          if (res.status < 500) (error as Error & { fatal?: boolean }).fatal = true;
          throw error;
        }
        return res.json();
      });
    } catch (error) {
      lastError = error;
      if ((error as { fatal?: boolean }).fatal) break;
      await new Promise((resolve) => setTimeout(resolve, 400 * 2 ** attempt));
    }
  }
  throw lastError;
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  if (value.trim().toUpperCase() === 'EVEN') return 100;
  const parsed = Number.parseFloat(value.replace(/^[ou]/i, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function athleteIdFrom(athlete: any): string | null {
  if (athlete?.id) return String(athlete.id);
  const sources = [...(athlete?.links ?? []).map((l: any) => l?.href), athlete?.headshot?.href];
  for (const href of sources) {
    const match = typeof href === 'string' ? href.match(/\/id\/(\d+)|\/full\/(\d+)\.png/) : null;
    if (match) return match[1] ?? match[2];
  }
  return null;
}

function parseLeaders(raw: any[] | undefined): Leader[] {
  const leaders: Leader[] = [];
  for (const category of raw ?? []) {
    const top = category?.leaders?.[0];
    const athleteId = athleteIdFrom(top?.athlete);
    if (!category?.name || !athleteId || /rating/i.test(category.name)) continue;
    leaders.push({
      category: String(category.name),
      athleteId,
      name: top.athlete.displayName ?? top.athlete.shortName ?? 'Unknown',
      position: top.athlete.position?.abbreviation ?? null,
      value: top.displayValue ?? ''
    });
  }
  return leaders;
}

function parseProbable(raw: any[] | undefined): Probable | null {
  const probable = raw?.find((p: any) => /pitcher|goalie/i.test(p?.name ?? '')) ?? null;
  const athleteId = athleteIdFrom(probable?.athlete);
  if (!probable || !athleteId) return null;
  const stat = (abbr: string) => toNumber(probable.statistics?.find((s: any) => s?.abbreviation === abbr)?.displayValue);
  return {
    athleteId,
    name: probable.athlete.displayName ?? 'TBD',
    role: /goalie/i.test(probable.name) ? 'goalie' : 'pitcher',
    era: stat('ERA'),
    wins: stat('W'),
    losses: stat('L')
  };
}

/** ESPN's "0e2240" as "#0e2240"; anything else is null. */
const hexColor = (value: unknown) => (typeof value === 'string' && /^[0-9a-f]{6}$/i.test(value) ? `#${value.toLowerCase()}` : null);

function parseSide(raw: any, state: GameState): GameSide {
  const team = raw?.team ?? {};
  const record = raw?.records?.find((r: any) => ['total', 'ytd'].includes(r?.type))?.summary ?? raw?.records?.[0]?.summary ?? raw?.record ?? null;
  return {
    teamId: String(team.id ?? raw?.id),
    abbr: team.abbreviation ?? '???',
    name: team.displayName ?? team.name ?? 'Unknown',
    shortName: team.shortDisplayName ?? team.name ?? team.abbreviation ?? 'Unknown',
    logo: team.logo ?? null,
    color: hexColor(team.color),
    altColor: hexColor(team.alternateColor),
    score: state === 'pre' ? null : toNumber(raw?.score),
    winner: typeof raw?.winner === 'boolean' ? raw.winner : null,
    record: typeof record === 'string' ? record : null,
    leaders: parseLeaders(raw?.leaders),
    probable: parseProbable(raw?.probables),
    periods: state === 'pre' ? [] : (raw?.linescores ?? []).map((l: any) => toNumber(l?.value) ?? 0)
  };
}

function parseOdds(raw: any): MarketOdds | null {
  if (!raw) return null;
  let homeSpread = toNumber(raw.pointSpread?.home?.close?.line) ?? toNumber(raw.spread);
  if (homeSpread !== null && raw.homeTeamOdds?.favorite === true && homeSpread > 0) homeSpread = -homeSpread;
  const homeMoneyline = toNumber(raw.moneyline?.home?.close?.odds) ?? toNumber(raw.homeTeamOdds?.moneyLine);
  const awayMoneyline = toNumber(raw.moneyline?.away?.close?.odds) ?? toNumber(raw.awayTeamOdds?.moneyLine);
  if (homeSpread === null && homeMoneyline === null) return null;
  return {
    provider: raw.provider?.displayName ?? raw.provider?.name ?? 'Sportsbook',
    details: raw.details ?? null,
    homeSpread,
    overUnder: toNumber(raw.overUnder),
    homeMoneyline,
    awayMoneyline
  };
}

/** Domes and closed roofs have none worth showing. */
export function parseWeather(raw: any, venue: any): Game['weather'] {
  const temperature = toNumber(raw?.temperature);
  if (venue?.indoor === true || !raw?.displayValue || temperature === null) return null;
  return { text: String(raw.displayValue), temperature };
}

function parseEvent(league: LeagueId, event: any): Game | null {
  const comp = event?.competitions?.[0];
  const home = comp?.competitors?.find((c: any) => c?.homeAway === 'home');
  const away = comp?.competitors?.find((c: any) => c?.homeAway === 'away');
  if (!comp || !home || !away || !event.date) return null;
  const status = comp.status?.type ?? event.status?.type ?? {};
  const state: GameState = status.state === 'in' || status.state === 'post' ? status.state : 'pre';
  return {
    id: String(event.id),
    league,
    date: event.date,
    seasonYear: Number(event.season?.year),
    seasonType: Number(event.season?.type),
    state,
    completed: Boolean(status.completed),
    statusName: status.name ?? '',
    statusDetail: status.shortDetail ?? status.detail ?? '',
    period: state === 'pre' ? null : toNumber(comp.status?.period),
    clock: state === 'in' ? comp.status?.displayClock ?? null : null,
    outs: state === 'in' ? toNumber(comp.situation?.outs) : null,
    neutral: Boolean(comp.neutralSite),
    venue: comp.venue?.fullName ?? null,
    weather: parseWeather(event.weather, comp.venue),
    broadcast: (comp.broadcasts ?? []).flatMap((b: any) => b?.names ?? []).join(', ') || null,
    note: comp.series?.summary ?? comp.notes?.[0]?.headline ?? null,
    home: parseSide(home, state),
    away: parseSide(away, state),
    odds: parseOdds(comp.odds?.[0])
  };
}

function parseEvents(league: LeagueId, data: any): Game[] {
  return (data?.events ?? []).map((e: any) => parseEvent(league, e)).filter((g: Game | null): g is Game => g !== null);
}

function monthIsOver(month: string) {
  const year = Number(month.slice(0, 4));
  const monthIndex = Number(month.slice(4, 6));
  // First day of the next month, plus a few days of slack for late stat corrections.
  return Date.UTC(year, monthIndex, 1) + 3 * 86_400_000 < Date.now();
}

/** `ttlMs` can be longer for months that haven't started, whose schedule rarely changes. */
export function getMonthGames(league: LeagueConfig, month: string, ttlMs = 10 * 60_000) {
  return cached(
    `espn-${VERSION}-${league.id}-month-${month}`,
    {
      ttlMs,
      persist: true,
      isFinal: (games: Game[]) => monthIsOver(month) && games.every((g) => g.state === 'post')
    },
    async () => parseEvents(league.id, await fetchJson(`${BASE}/${league.espnPath}/scoreboard?dates=${month}&limit=1000`))
  );
}

/** Single-day scoreboard with a short TTL, used to keep live scores fresh. */
export function getDayGames(league: LeagueConfig, ymd: string) {
  return cached(`espn-${VERSION}-${league.id}-day-${ymd}`, { ttlMs: 60_000 }, async () =>
    parseEvents(league.id, await fetchJson(`${BASE}/${league.espnPath}/scoreboard?dates=${ymd}&limit=1000`))
  );
}

/**
 * Yesterday's and today's scoreboards (Eastern dates, so late games past
 * midnight are covered), read again at most every 15 seconds: the freshest
 * scores, clocks and statuses for games under way. Never stored on disk.
 */
export function getLiveScores(league: LeagueConfig, now = new Date()) {
  // Yesterday's games can only still be on in the small hours (a late West Coast game, extra innings).
  const smallHours = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hourCycle: 'h23' }).format(now)) < 6;
  const days = (smallHours ? [new Date(now.getTime() - 86_400_000), now] : [now]).map(etYmd);
  return cached(`espn-${VERSION}-${league.id}-live-${days.join('-')}`, { ttlMs: 15_000 }, async () => {
    const lists = await Promise.all(days.map(async (d) => parseEvents(league.id, await fetchJson(`${BASE}/${league.espnPath}/scoreboard?dates=${d}&limit=1000`))));
    return lists.flat();
  });
}

export function getTeams(league: LeagueConfig) {
  // v2: with each team's alternate color.
  return cached(`espn-${league.id}-teams2`, { ttlMs: 24 * 60 * 60_000, persist: true }, async () => {
    const data = await fetchJson(`${BASE}/${league.espnPath}/teams`);
    const teams: any[] = data?.sports?.[0]?.leagues?.[0]?.teams ?? [];
    return teams.map(({ team }): TeamInfo => ({
      id: String(team.id),
      abbr: team.abbreviation,
      name: team.displayName,
      shortName: team.shortDisplayName ?? team.name,
      logo: team.logos?.[0]?.href ?? null,
      color: hexColor(team.color),
      altColor: hexColor(team.alternateColor)
    }));
  });
}

export type LeagueGroup = { name: string; abbr: string; divisions: { name: string; abbr: string; teamIds: string[] }[] };

/** Conferences (leagues, in MLB) and their divisions, for standings and playoff seeding. */
export function getLeagueGroups(league: LeagueConfig) {
  return cached(`espn-${league.id}-groups`, { ttlMs: 24 * 60 * 60_000, persist: true }, async (): Promise<LeagueGroup[]> => {
    const data = await fetchJson(`${BASE}/${league.espnPath}/groups`);
    return (data?.groups ?? [])
      .map(
        (group: any): LeagueGroup => ({
          name: group?.name ?? '',
          abbr: group?.abbreviation ?? group?.name ?? '',
          divisions: (group?.children ?? []).map((division: any) => ({
            name: division?.name ?? '',
            abbr: division?.abbreviation ?? '',
            teamIds: (division?.teams ?? []).map((t: any) => String(t?.id))
          }))
        })
      )
      .filter((g: LeagueGroup) => g.divisions.length > 0);
  });
}

/**
 * Official playoff seeds by team id (conference seeds, with the leagues' real
 * tiebreakers), from the standings feed. Final once the regular season ends.
 */
export function getPlayoffSeeds(league: LeagueConfig, seasonYear: number) {
  return cached(`espn-${league.id}-seeds-${seasonYear}`, { ttlMs: 60 * 60_000, persist: true }, async (): Promise<Record<string, number>> => {
    const data = await fetchJson(`https://site.api.espn.com/apis/v2/sports/${league.espnPath}/standings?season=${seasonYear}`);
    const seeds: Record<string, number> = {};
    for (const conference of data?.children ?? []) {
      for (const entry of conference?.standings?.entries ?? []) {
        const seed = toNumber(entry?.stats?.find((s: any) => s?.name === 'playoffSeed')?.value);
        if (entry?.team?.id && seed !== null && seed > 0) seeds[String(entry.team.id)] = seed;
      }
    }
    return seeds;
  });
}

/** Current injury report, keyed by team id. */
export function getInjuries(league: LeagueConfig) {
  return cached(`espn-${league.id}-injuries`, { ttlMs: 10 * 60_000, persist: true }, async () => {
    const data = await fetchJson(`${BASE}/${league.espnPath}/injuries`);
    const byTeam: Record<string, InjuryEntry[]> = {};
    for (const team of data?.injuries ?? []) {
      byTeam[String(team.id)] = (team.injuries ?? [])
        .map((injury: any): InjuryEntry | null => {
          const athleteId = athleteIdFrom(injury?.athlete);
          if (!athleteId) return null;
          return {
            athleteId,
            name: injury.athlete.displayName ?? 'Unknown',
            position: injury.athlete.position?.abbreviation ?? null,
            status: injury.status ?? 'Unknown',
            comment: injury.shortComment ?? null,
            date: injury.date ?? null
          };
        })
        .filter((i: InjuryEntry | null): i is InjuryEntry => i !== null);
    }
    return byTeam;
  });
}

/**
 * A team's regular-season statistical leaders, top three per category. The
 * scoreboard's pregame "leaders" show ESPN's projected starters instead, which
 * hides a starter who just got hurt, so injury weighting uses these.
 */
export function getTeamSeasonLeaders(league: LeagueConfig, seasonYear: number, teamId: string) {
  const [sport, leagueSlug] = league.espnPath.split('/');
  return cached(`espn-${league.id}-leaders-${seasonYear}-${teamId}`, { ttlMs: 3 * 60 * 60_000, persist: true }, async () => {
    const data = await fetchJson(
      `https://sports.core.api.espn.com/v2/sports/${sport}/leagues/${leagueSlug}/seasons/${seasonYear}/types/2/teams/${teamId}/leaders`
    );
    const leaders: SeasonLeader[] = [];
    for (const category of data?.categories ?? []) {
      for (const entry of (category?.leaders ?? []).slice(0, 3)) {
        const athleteId = String(entry?.athlete?.$ref ?? '').match(/athletes\/(\d+)/)?.[1];
        if (!athleteId || typeof entry.value !== 'number') continue;
        leaders.push({ category: String(category.name), athleteId, value: entry.value, display: entry.displayValue ?? '' });
      }
    }
    return leaders;
  });
}

function parseCoreOdds(data: any): MarketOdds | null {
  // Skip in-game ("live") books; the pregame line closest to kickoff is what we grade against.
  const items = (data?.items ?? [])
    .filter((item: any) => !/live/i.test(item?.provider?.name ?? ''))
    .sort((a: any, b: any) => (a?.provider?.priority ?? 99) - (b?.provider?.priority ?? 99));
  const item = items[0];
  if (!item) return null;
  const homeMoneyline = toNumber(item.homeTeamOdds?.close?.moneyLine?.american) ?? toNumber(item.homeTeamOdds?.moneyLine);
  const awayMoneyline = toNumber(item.awayTeamOdds?.close?.moneyLine?.american) ?? toNumber(item.awayTeamOdds?.moneyLine);
  let homeSpread = toNumber(item.spread);
  if (homeSpread !== null && item.homeTeamOdds?.favorite === true && homeSpread > 0) homeSpread = -homeSpread;
  if (homeMoneyline === null && homeSpread === null) return null;
  return {
    provider: item.provider?.name ?? 'Sportsbook',
    details: item.details ?? null,
    homeSpread,
    overUnder: toNumber(item.overUnder),
    homeMoneyline,
    awayMoneyline
  };
}

/**
 * Closing lines for finished games, which the scoreboard drops once a game ends.
 * Stored one file per league-month and filled incrementally. `fetchUpTo` caps
 * how many missing games are fetched in this call; the rest stay missing (null
 * means "no line was posted", undefined means "not fetched yet").
 */
export async function getClosingOdds(league: LeagueConfig, games: Game[], fetchUpTo = Infinity) {
  const byMonth = new Map<string, Game[]>();
  for (const g of games) {
    if (!g.completed) continue;
    const month = g.date.slice(0, 7).replace('-', '');
    byMonth.set(month, [...(byMonth.get(month) ?? []), g]);
  }

  const result: Record<string, MarketOdds | null> = {};
  let budget = fetchUpTo;
  // Newest months first, so a capped run fills what matters most.
  for (const [month, monthGames] of [...byMonth].sort((a, b) => b[0].localeCompare(a[0]))) {
    const key = `espn-${league.id}-odds-${month}`;
    const store = (await readStore<Record<string, MarketOdds | null>>(key)) ?? {};
    const missing = monthGames.filter((g) => !(g.id in store)).slice(0, Math.max(0, budget));
    if (missing.length) {
      budget -= missing.length;
      const [sport, slug] = league.espnPath.split('/');
      await Promise.all(
        missing.map(async (g) => {
          try {
            store[g.id] = parseCoreOdds(await fetchJson(`${CORE}/${sport}/leagues/${slug}/events/${g.id}/competitions/${g.id}/odds`, oddsThrottle));
          } catch {
            // Leave it unfetched; the next build retries.
          }
        })
      );
      await writeStore(key, store);
    }
    for (const g of monthGames) if (g.id in store) result[g.id] = store[g.id];
  }
  return result;
}

/**
 * Every game for the replay window: cached months for history, plus fresh
 * single-day pulls for yesterday and today so live scores stay current.
 */
export async function getLeagueGames(league: LeagueConfig, now = new Date()): Promise<Game[]> {
  const months = monthsToLoad(league, now);
  const days = [new Date(now.getTime() - 86_400_000), now].map(etYmd);
  const [monthGames, dayGames] = await Promise.all([
    Promise.all(months.map((m) => getMonthGames(league, m))),
    Promise.all(days.map((d) => getDayGames(league, d).catch(() => [] as Game[])))
  ]);
  const byId = new Map<string, Game>();
  for (const game of monthGames.flat()) byId.set(game.id, game);
  for (const game of dayGames.flat()) byId.set(game.id, game);
  return [...byId.values()].sort((a, b) => a.date.localeCompare(b.date));
}
