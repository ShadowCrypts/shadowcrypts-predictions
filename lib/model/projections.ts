import { cached } from '../cache';
import { Game, getLeagueGames, getLeagueGroups, getMonthGames, getPlayoffSeeds, LeagueGroup } from '../espn';
import { currentSeasonStart, LEAGUES, LeagueConfig, LeagueId, monthsToLoad, seasonLabel } from '../leagues';
import { BracketInput, BracketOutlook, simulateBracketInBackground } from './bracket';
import { MEAN_RATING } from './elo';
import { getLeagueModel, LeagueModel } from './index';
import { liveNow } from './live';
import { recordOdds } from './oddsHistory';
import { etDateKey } from '../time';
import { FORMAT_RULES, GameStakes, SeasonGameInput, SeasonInput, SeasonRecord, SeasonTeamInput, simulateSeasonInBackground, TeamOutlook } from './season';

// Bump when SeasonProjection changes shape so persisted projections are rebuilt.
const VERSION = 'v6';
const SIMS = 10_000;
/** A bracket simulation draws once per series, so more runs cost little and steady the odds. */
const PLAYOFF_SIMS = 20_000;
/** Recent seasons' share of NHL games decided in overtime or a shootout, if too few games are on file. */
const FALLBACK_OT_RATE = 0.23;

export type SeasonProjection = {
  league: LeagueId;
  season: string;
  generatedAt: string;
} & (
  | {
      status: 'ready';
      sims: number;
      /** SD of the random rating shift in each simulation, in Elo. */
      drift: number;
      /** Regular-season games left on the schedule. */
      remaining: number;
      /** Team-games not on the schedule yet, simulated against a league-average opponent. */
      unscheduled: number;
      /** NHL: share of games that went past regulation in the seasons on file. */
      otRate: number | null;
      conferences: { abbr: string; name: string }[];
      teams: TeamOutlook[];
      /** Each upcoming game's playoff stakes for both teams, by game id. */
      stakes: Record<string, GameStakes>;
    }
  /** The postseason is underway (or about to be): the rest of the bracket, simulated. */
  | ({ status: 'playoffs'; conferences: { abbr: string; name: string }[] } & BracketOutlook)
  /**
   * The regular season is over and there's nothing to simulate: the season is
   * done (`champion` when known), or the postseason couldn't be projected and
   * `playoffs` says whether games are still to come.
   */
  | { status: 'complete'; playoffs: boolean; champion: string | null }
  /** No regular-season schedule for the current season yet. */
  | { status: 'unscheduled' }
);

export type ProjectionView = SeasonProjection | { league: LeagueId; status: 'pending' | 'unavailable' };

const toElo = (p: number) => 400 * Math.log10(p / (1 - p));
const clamp = (p: number) => Math.min(0.995, Math.max(0.005, p));

/** ESPN's year label for the season in progress (or most recently finished) at `now`. */
function currentSeasonYear(league: LeagueConfig, now: Date) {
  const start = currentSeasonStart(league, now);
  return league.seasonYearIsEndYear ? start.year + 1 : start.year;
}

/** Every month of the current season, from its first through the last one games can fall in. */
function seasonMonths(league: LeagueConfig, now: Date) {
  const start = currentSeasonStart(league, now);
  const months: string[] = [];
  let y = start.year;
  let m = start.month;
  while (league.activeMonths.includes(m) && months.length < 12) {
    months.push(`${y}${String(m).padStart(2, '0')}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return months;
}

type Placement = Map<string, { conference: string; division: string }>;

function placementFrom(groups: LeagueGroup[]): Placement {
  const placement: Placement = new Map();
  for (const group of groups) for (const division of group.divisions) for (const teamId of division.teamIds) placement.set(teamId, { conference: group.abbr, division: division.name });
  return placement;
}

/** Records from finished regular-season games; an NHL game that needed more than three periods gives the loser a point. */
function seasonRecords(id: LeagueId, placement: Placement, games: Game[]) {
  const records = new Map<string, SeasonRecord>([...placement.keys()].map((teamId) => [teamId, { wins: 0, losses: 0, ties: 0, otLosses: 0 }]));
  for (const game of games) {
    if (!game.completed || game.seasonType !== 2) continue;
    const home = records.get(game.home.teamId);
    const away = records.get(game.away.teamId);
    if (!home || !away) continue;
    const margin = game.home.score! - game.away.score!;
    if (margin === 0) {
      home.ties += 1;
      away.ties += 1;
      continue;
    }
    const [winner, loser] = margin > 0 ? [home, away] : [away, home];
    winner.wins += 1;
    if (id === 'nhl' && game.home.periods.length > 3) loser.otLosses += 1;
    else loser.losses += 1;
  }
  return records;
}

/**
 * Each team's pre-line rating. A pre-line forecast blends Elo and market-implied
 * ratings in logit space, which on the Elo scale is a weighted average of the
 * two. Before the new season reaches the model, ratings are regressed as the
 * replay would.
 */
function preLineRatings(league: LeagueConfig, model: LeagueModel, seasonYear: number) {
  const share = league.preLine.ratingsShare;
  const regress = (rating: number, by: number) => (model.season.year < seasonYear ? MEAN_RATING + (rating - MEAN_RATING) * (1 - by) : rating);
  const ratings = new Map(
    model.rankings.map((r) => [r.team.id, share * regress(r.rating, league.elo.regress) + (1 - share) * regress(r.marketRating, league.preLine.regress)])
  );
  return (teamId: string) => ratings.get(teamId) ?? MEAN_RATING;
}

type PreparedSeason =
  | { status: 'ready'; input: SeasonInput; remaining: number; otRate: number | null }
  | { status: 'complete'; playoffs: boolean }
  | { status: 'unscheduled' };

/**
 * The simulation's inputs for the season in progress at `now`: each team's
 * record and pre-line rating, and the remaining schedule with a pre-line
 * forecast for every game. `later` holds schedule months past the model's window.
 */
export function prepareSeason(league: LeagueConfig, model: LeagueModel, groups: LeagueGroup[], later: Game[], now: Date): PreparedSeason {
  const id = league.id;
  const seasonYear = currentSeasonYear(league, now);
  const placement = placementFrom(groups);

  // The model's games run through the slate window, each with its pre-line forecast; later months come from the schedule.
  const known = new Map<string, { game: Game; preLine: number | null }>();
  for (const p of Object.values(model.predictions)) if (p.game.seasonYear === seasonYear) known.set(p.game.id, { game: p.game, preLine: p.preLineHomeProb });
  for (const g of later) {
    if (g.seasonYear === seasonYear && !known.has(g.id) && !(g.state === 'post' && !g.completed)) known.set(g.id, { game: g, preLine: null });
  }
  const games = [...known.values()].filter(({ game }) => placement.has(game.home.teamId) && placement.has(game.away.teamId));
  const regular = games.filter(({ game }) => game.seasonType === 2);
  const remaining = regular.filter(({ game }) => !game.completed);
  if (!remaining.length) {
    return regular.length ? { status: 'complete', playoffs: games.some(({ game }) => game.seasonType === 3 && !game.completed) } : { status: 'unscheduled' };
  }

  const records = seasonRecords(id, placement, regular.map(({ game }) => game));
  const rating = preLineRatings(league, model, seasonYear);
  // Both rating sides use the Elo home field; the market side's learned edge differs by a few points at most (about 1 Elo blended).
  const homeEdge = league.elo.hfa;

  const teams: SeasonTeamInput[] = [...placement].map(([teamId, p]) => ({ id: teamId, ...p, record: records.get(teamId)!, rating: rating(teamId) }));
  // Games in the model's window keep their full pre-line forecast (rest, travel, starters, and
  // injuries for the next few days); later games use ratings and home field only.
  const schedule: SeasonGameInput[] = remaining.map(({ game, preLine }) => ({
    homeId: game.home.teamId,
    awayId: game.away.teamId,
    diff: preLine !== null ? toElo(clamp(preLine)) : rating(game.home.teamId) - rating(game.away.teamId) + (game.neutral ? 0 : homeEdge),
    key: game.id,
    date: game.date,
    // Games on the board get their playoff stakes reported, for their game pages.
    ...(preLine !== null ? { id: game.id } : {})
  }));

  let otRate: number | null = null;
  if (id === 'nhl') {
    const finals = Object.values(model.predictions).filter((p) => p.game.completed && p.game.seasonType === 2 && p.game.home.periods.length > 0);
    otRate = finals.length >= 200 ? finals.filter((p) => p.game.home.periods.length > 3).length / finals.length : FALLBACK_OT_RATE;
  }

  return { status: 'ready', input: { format: id, teams, games: schedule, homeEdge }, remaining: schedule.length, otRate };
}

/** The NBA's play-in games name the 7-10 seeds they're between, in case the standings feed reshuffles them afterwards. */
const PLAY_IN_SEEDS = /(7th|9th) Place vs\.? (8th|10th) Place/i;

/**
 * The bracket simulation's inputs once the regular season is over: official
 * seeds, final standings, pre-line ratings, and every postseason game played
 * or scheduled. A game still to play carries the app's forecast when the model
 * has one: the line or pre-line forecast, or the live win probability while
 * it's on.
 */
export function preparePlayoffs(league: LeagueConfig, model: LeagueModel, groups: LeagueGroup[], seeds: Record<string, number>, games: Game[], now: Date): BracketInput {
  const seasonYear = currentSeasonYear(league, now);
  const placement = placementFrom(groups);
  const regular = Object.values(model.predictions)
    .map((p) => p.game)
    .filter((g) => g.seasonYear === seasonYear);
  const records = seasonRecords(league.id, placement, regular);
  const rating = preLineRatings(league, model, seasonYear);

  const byId = new Map<string, Game>();
  for (const g of games) {
    const postseason = g.seasonType === 3 || (league.id === 'nba' && g.seasonType === 5);
    const tied = g.completed && g.home.score === g.away.score;
    const called = g.state === 'post' && !g.completed;
    if (g.seasonYear === seasonYear && postseason && !tied && !called && placement.has(g.home.teamId) && placement.has(g.away.teamId) && !byId.has(g.id)) {
      byId.set(g.id, g);
    }
  }
  const postseason = [...byId.values()].sort((a, b) => a.date.localeCompare(b.date));

  const official = { ...seeds };
  for (const g of postseason) {
    const named = g.seasonType === 5 ? g.note?.match(PLAY_IN_SEEDS) : null;
    if (!named) continue;
    official[g.home.teamId] = Number.parseInt(named[1], 10);
    official[g.away.teamId] = Number.parseInt(named[2], 10);
  }

  const standing = (r: SeasonRecord) => {
    const played = r.wins + r.losses + r.ties + r.otLosses;
    return league.id === 'nhl' ? 2 * r.wins + r.otLosses : played ? (r.wins + r.ties / 2) / played : 0.5;
  };
  return {
    format: league.id,
    teams: [...placement]
      .filter(([teamId]) => official[teamId] !== undefined && official[teamId] <= FORMAT_RULES[league.id].field)
      .map(([teamId, p]) => ({ id: teamId, ...p, seed: official[teamId], standing: standing(records.get(teamId)!), rating: rating(teamId) })),
    games: postseason.map((g) => {
      const forecast = model.predictions[g.id]?.homeProb ?? null;
      const live = forecast !== null && g.state === 'in' ? liveNow(league.id, g, forecast) : null;
      return {
        homeId: g.home.teamId,
        awayId: g.away.teamId,
        stage: g.seasonType === 5 ? 'play-in' : 'playoffs',
        winnerId: g.completed ? (g.home.score! > g.away.score! ? g.home.teamId : g.away.teamId) : null,
        homeProb: g.completed ? null : live?.homeProb ?? forecast,
        live: live !== null,
        neutral: g.neutral
      };
    }),
    homeEdge: league.elo.hfa
  };
}

async function projectPostseason(league: LeagueConfig, model: LeagueModel, groups: LeagueGroup[], later: Game[], now: Date, playoffsAhead: boolean) {
  const seasonYear = currentSeasonYear(league, now);
  try {
    const [seeds, games] = await Promise.all([getPlayoffSeeds(league, seasonYear), getLeagueGames(league, now)]);
    const input = preparePlayoffs(league, model, groups, seeds, [...games, ...later], now);
    const outlook = await simulateBracketInBackground(input, { sims: PLAYOFF_SIMS });
    if (outlook.champion) return { status: 'complete', playoffs: false, champion: outlook.champion } as const;
    return { status: 'playoffs', conferences: groups.map((g) => ({ abbr: g.abbr, name: g.name })), ...outlook } as const;
  } catch (error) {
    // Seeds missing or results that don't fit the bracket: say the regular season is over rather than guess.
    console.warn(`Postseason projection for ${league.id} unavailable:`, error instanceof Error ? error.message : error);
    return { status: 'complete', playoffs: playoffsAhead, champion: null } as const;
  }
}

async function buildSeasonProjection(id: LeagueId): Promise<SeasonProjection> {
  const league = LEAGUES[id];
  const now = new Date();
  const base = { league: id, season: seasonLabel(league, currentSeasonYear(league, now)), generatedAt: now.toISOString() };
  const loaded = new Set(monthsToLoad(league, now));
  const [model, groups, later] = await Promise.all([
    getLeagueModel(id),
    getLeagueGroups(league),
    // Months past the model's window, cached longer because the schedule rarely changes.
    Promise.all(seasonMonths(league, now).filter((m) => !loaded.has(m)).map((m) => getMonthGames(league, m, 6 * 60 * 60_000)))
  ]);
  const season = prepareSeason(league, model, groups, later.flat(), now);
  if (season.status === 'complete') {
    const postseason = await projectPostseason(league, model, groups, later.flat(), now, season.playoffs);
    return { ...base, ...postseason };
  }
  if (season.status !== 'ready') return { ...base, ...season };

  const outlook = await simulateSeasonInBackground(season.input, { sims: SIMS, otRate: season.otRate ?? undefined });
  // Today's odds join the season's history, for the team pages' charts.
  await recordOdds(id, base.season, etDateKey(now), outlook.teams);
  return {
    ...base,
    status: 'ready',
    sims: outlook.sims,
    drift: outlook.drift,
    remaining: season.remaining,
    unscheduled: outlook.unscheduled,
    otRate: season.otRate,
    conferences: groups.map((g) => ({ abbr: g.abbr, name: g.name })),
    teams: outlook.teams,
    stakes: outlook.stakes
  };
}

/** One game still to play, for picking a winner: its forecast as an Elo gap, home field in. */
export type MachineGame = { id: string; date: string; homeId: string; awayId: string; diff: number };

export type MachineInput = {
  season: string;
  conferences: { abbr: string; name: string }[];
  input: Omit<SeasonInput, 'games'>;
  otRate: number | null;
  games: MachineGame[];
};

/**
 * What the playoff machine needs to re-run a season in the browser: the same
 * teams, records and forecasts the projection above simulates, every game with
 * its id. Null once the regular season is over or before there's a schedule.
 */
export function getMachineInput(id: LeagueId): Promise<MachineInput | null> {
  return cached(`machine-${VERSION}-${id}`, { ttlMs: 15 * 60_000, staleWhileRevalidate: true }, async () => {
    const league = LEAGUES[id];
    const now = new Date();
    const loaded = new Set(monthsToLoad(league, now));
    const [model, groups, later] = await Promise.all([
      getLeagueModel(id),
      getLeagueGroups(league),
      Promise.all(seasonMonths(league, now).filter((m) => !loaded.has(m)).map((m) => getMonthGames(league, m, 6 * 60 * 60_000)))
    ]);
    const season = prepareSeason(league, model, groups, later.flat(), now);
    if (season.status !== 'ready') return null;
    const { games, ...input } = season.input;
    return {
      season: seasonLabel(league, currentSeasonYear(league, now)),
      conferences: groups.map((g) => ({ abbr: g.abbr, name: g.name })),
      input,
      otRate: season.otRate,
      games: games
        .flatMap((g) => (g.key && g.date ? [{ id: g.key, date: g.date, homeId: g.homeId, awayId: g.awayId, diff: Math.round(g.diff * 10) / 10 }] : []))
        .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))
    };
  });
}

/** A league's season projection, re-simulated at most every 15 minutes in the background. */
export function getSeasonProjection(id: LeagueId) {
  return cached(`season-${VERSION}-${id}`, { ttlMs: 15 * 60_000, persist: true, staleWhileRevalidate: true }, () => buildSeasonProjection(id));
}

const failed = new Set<LeagueId>();

/**
 * For pages: the latest projection if it's on hand within `waitMs`; otherwise
 * 'pending' while the simulation runs in the background, or 'unavailable' if
 * the last attempt failed. A page load never waits on a simulation.
 */
export async function peekSeasonProjection(id: LeagueId, waitMs = 50): Promise<ProjectionView> {
  const run = getSeasonProjection(id).then(
    (value) => {
      failed.delete(id);
      return value;
    },
    () => {
      failed.add(id);
      return null;
    }
  );
  const value = await Promise.race([run, new Promise<undefined>((resolve) => setTimeout(resolve, waitMs))]);
  if (value) return value;
  return { league: id, status: value === null || failed.has(id) ? 'unavailable' : 'pending' };
}
