import type { Game } from '../espn';
import type { MarketView } from './market';

export type ScoringParams = {
  /** Share of each scoring surprise credited to the offense and charged to the defense it came against. */
  k: number;
  /** Fraction of each team's offense and defense rating removed between seasons. */
  regress: number;
  /** Learning rate for the league's average score and its home edge. */
  leagueStep: number;
  /** Learning rate for each home venue's effect on both teams' scoring (ballparks); 0 leaves it out. */
  venueK: number;
  /** Home margin per unit of the forecast's log-odds, for games without a usable spread. */
  marginPerLogit: number;
};

export type ScoreLine = { home: number; away: number };

/** Where the ratings stand after the last finished game. */
export type ScoringState = {
  /** League average score per team. */
  average: number;
  /** Home team's scoring edge over the visitor, split between the two. */
  homeEdge: number;
  /** Points (goals, runs) a team scores above the league average. */
  offense: Map<string, number>;
  /** Points a team allows above the league average: positive is a weak defense. */
  defense: Map<string, number>;
  /** A home venue's effect on the game's total, keyed by the home team. */
  venue: Map<string, number>;
};

export type ScoringPass = {
  /** Each game's expected score before it was played (upcoming games: from the latest ratings). */
  expected: Map<string, ScoreLine>;
  /** The league's average score per team going into each game, the naive baseline. */
  averageBefore: Map<string, number>;
  state: ScoringState;
};

/**
 * A team's expected score: the league average, plus half the home edge at
 * home, half the venue's effect, its offense, and the defense rating of the
 * team it faces.
 */
export function expectedScore(state: ScoringState, homeId: string, awayId: string, neutral: boolean): ScoreLine {
  const edge = neutral ? 0 : state.homeEdge;
  const park = neutral ? 0 : state.venue.get(homeId) ?? 0;
  const off = (id: string) => state.offense.get(id) ?? 0;
  const def = (id: string) => state.defense.get(id) ?? 0;
  return {
    home: state.average + edge / 2 + park / 2 + off(homeId) + def(awayId),
    away: state.average - edge / 2 + park / 2 + off(awayId) + def(homeId)
  };
}

/**
 * Team offense and defense ratings in points (goals, runs) above the league
 * average, walked through every game in date order like the Elo replay, so
 * each game's expectation only uses earlier results.
 */
export function scoringPass(games: Game[], params: Omit<ScoringParams, 'marginPerLogit'>): ScoringPass {
  const firstSeason = games[0]?.seasonYear;
  // Start the league average from the first season's scoring. That season is burn-in only and never graded.
  const opening = games.filter((g) => g.completed && g.seasonYear === firstSeason && g.home.score !== null && g.away.score !== null);
  const state: ScoringState = {
    average: opening.length ? opening.reduce((s, g) => s + g.home.score! + g.away.score!, 0) / (2 * opening.length) : 0,
    homeEdge: 0,
    offense: new Map(),
    defense: new Map(),
    venue: new Map()
  };
  const expected = new Map<string, ScoreLine>();
  const averageBefore = new Map<string, number>();
  const bump = (ratings: Map<string, number>, id: string, by: number) => ratings.set(id, (ratings.get(id) ?? 0) + by);
  let season = firstSeason;

  for (const game of games) {
    if (game.seasonYear !== season) {
      for (const ratings of [state.offense, state.defense]) for (const [id, v] of ratings) ratings.set(id, v * (1 - params.regress));
      season = game.seasonYear;
    }
    const h = game.home.teamId;
    const a = game.away.teamId;
    const line = expectedScore(state, h, a, game.neutral);
    expected.set(game.id, line);
    averageBefore.set(game.id, state.average);
    if (!game.completed || game.home.score === null || game.away.score === null) continue;

    const homeMiss = game.home.score - line.home;
    const awayMiss = game.away.score - line.away;
    bump(state.offense, h, params.k * homeMiss);
    bump(state.defense, a, params.k * homeMiss);
    bump(state.offense, a, params.k * awayMiss);
    bump(state.defense, h, params.k * awayMiss);
    state.average += params.leagueStep * ((homeMiss + awayMiss) / 2);
    if (!game.neutral) {
      state.homeEdge += params.leagueStep * (homeMiss - awayMiss);
      if (params.venueK) bump(state.venue, h, params.venueK * (homeMiss + awayMiss));
    }
  }
  return { expected, averageBefore, state };
}

export type ProjectedScore = {
  home: number;
  away: number;
  /** Where the total came from: the posted over/under or the scoring model. */
  totalFrom: 'market' | 'model';
  /** Where the margin came from: the posted point spread, or the win probability. */
  marginFrom: 'spread' | 'forecast';
};

const logit = (p: number) => Math.log(p / (1 - p));

/**
 * A projected final score that agrees with the forecast: the margin is the
 * posted spread when there is one (football and basketball), otherwise the
 * win probability turned into points; the total is the posted over/under when
 * there is one, otherwise the scoring model's.
 */
export function projectScore(
  homeProb: number,
  expected: ScoreLine,
  market: Pick<MarketView, 'homeSpread' | 'overUnder'> | null,
  params: Pick<ScoringParams, 'marginPerLogit'>,
  useSpread: boolean
): ProjectedScore {
  const p = Math.min(0.99, Math.max(0.01, homeProb));
  const spread = useSpread ? market?.homeSpread ?? null : null;
  const margin = spread !== null ? -spread : params.marginPerLogit * logit(p);
  const marketTotal = market?.overUnder ?? null;
  const total = marketTotal ?? expected.home + expected.away;
  return {
    home: (total + margin) / 2,
    away: (total - margin) / 2,
    totalFrom: marketTotal !== null ? 'market' : 'model',
    marginFrom: spread !== null ? 'spread' : 'forecast'
  };
}
