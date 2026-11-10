import type { Game } from '../espn';
import { MEAN_RATING, PregameContext, winProbability } from './elo';

export type MarketRatingParams = {
  /** Share of the gap between a closing line and the current ratings closed after each game. */
  lineStep: number;
  /** Elo-style step on results; small, because the lines carry most of the signal. */
  resultK: number;
  /** Fraction of each rating's distance from 1500 removed between seasons. */
  regress: number;
  /** How fast the home edge itself is learned from the lines (0 keeps the Elo model's). */
  hfaStep: number;
  /**
   * 'model' reuses the rating model's starter adjustments; 'market' learns each
   * starting pitcher's or goalie's value from how the lines priced their starts.
   */
  starters: 'model' | 'market';
  starterStep: number;
  /** Elo ratings' weight when blended with these for games without a line (logit space). */
  ratingsShare: number;
};

export type MarketRatingResult = {
  /** Home-minus-away rating gap before each game, including home edge, rest and starters. */
  diffs: Map<string, number>;
  ratings: Map<string, number>;
  /** Starter value in Elo points (MLB pitchers, NHL goalies) when learned from the lines. */
  starters: Map<string, number>;
};

const STARTER_CARRYOVER = 0.7;
const toElo = (p: number) => 400 * Math.log10(p / (1 - p));
const clamp = (p: number) => Math.min(0.995, Math.max(0.005, p));

/**
 * Ratings that track how the betting market priced each team. After every
 * finished game the two teams move toward the gap its closing line implied,
 * so the ratings absorb roster news, injuries and form the results alone are
 * slow to show. They forecast games before a line is posted. Like the Elo
 * replay, each game's number is captured before that game updates anything.
 */
export function marketRatings(
  games: Game[],
  lineProbs: Map<string, number>,
  contexts: Map<string, PregameContext>,
  baseHfa: number,
  params: MarketRatingParams
): MarketRatingResult {
  const ratings = new Map<string, number>();
  const starters = new Map<string, number>();
  const diffs = new Map<string, number>();
  let season: number | null = null;
  let hfa = baseHfa;

  for (const game of games) {
    if (season !== null && game.seasonYear > season) {
      for (const [id, value] of ratings) ratings.set(id, MEAN_RATING + (value - MEAN_RATING) * (1 - params.regress));
      for (const [id, value] of starters) starters.set(id, value * STARTER_CARRYOVER);
    }
    season = game.seasonYear;

    const ctx = contexts.get(game.id)!;
    const homeStarterId = game.home.probable?.athleteId;
    const awayStarterId = game.away.probable?.athleteId;
    const starterGap =
      params.starters === 'model'
        ? ctx.homeStarter - ctx.awayStarter
        : (homeStarterId ? starters.get(homeStarterId) ?? 0 : 0) - (awayStarterId ? starters.get(awayStarterId) ?? 0 : 0);
    const home = ratings.get(game.home.teamId) ?? MEAN_RATING;
    const away = ratings.get(game.away.teamId) ?? MEAN_RATING;
    const diff = home - away + (game.neutral ? 0 : hfa) + ctx.homeRest - ctx.awayRest + starterGap + ctx.extra;
    diffs.set(game.id, diff);

    if (!game.completed || game.home.score === null || game.away.score === null) continue;

    let nextHome = home;
    let nextAway = away;
    const line = lineProbs.get(game.id);
    if (line !== undefined) {
      const error = toElo(clamp(line)) - diff;
      nextHome += params.lineStep * error;
      nextAway -= params.lineStep * error;
      if (!game.neutral) hfa += params.hfaStep * error;
      if (params.starters === 'market') {
        if (homeStarterId) starters.set(homeStarterId, (starters.get(homeStarterId) ?? 0) + params.starterStep * error);
        if (awayStarterId) starters.set(awayStarterId, (starters.get(awayStarterId) ?? 0) - params.starterStep * error);
      }
    }
    const outcome = game.home.score > game.away.score ? 1 : game.home.score < game.away.score ? 0 : 0.5;
    const shift = params.resultK * (outcome - winProbability(diff));
    ratings.set(game.home.teamId, nextHome + shift);
    ratings.set(game.away.teamId, nextAway - shift);
  }

  return { diffs, ratings, starters };
}
