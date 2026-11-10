import type { Game } from '../espn';
import type { EloParams, MovModel } from '../leagues';
import { StarterModel } from './starters';

export const MEAN_RATING = 1500;
const BACK_TO_BACK_HOURS = 30;

export function winProbability(eloDiff: number) {
  return 1 / (1 + 10 ** (-eloDiff / 400));
}

/**
 * Scales an update by margin of victory, damped by how favored the winner was
 * so big favorites don't inflate their rating by running up scores.
 */
export function movMultiplier(model: MovModel, margin: number, winnerEloDiff: number) {
  const m = Math.abs(margin);
  if (m === 0) return 1;
  switch (model) {
    case 'nba':
      return (m + 3) ** 0.8 / (7.5 + 0.006 * winnerEloDiff);
    case 'nhl':
      return (0.6686 * Math.log(m) + 0.8048) * (2.05 / (0.001 * winnerEloDiff + 2.05));
    case 'nfl':
    case 'mlb':
      return Math.log(m + 1) * (2.2 / (0.001 * winnerEloDiff + 2.2));
  }
}

/** Everything the core model knew right before a game started. */
export type PregameContext = {
  homeRating: number;
  awayRating: number;
  hfa: number;
  homeBackToBack: boolean;
  awayBackToBack: boolean;
  homeRest: number;
  awayRest: number;
  /** Starting pitcher/goalie adjustments (0 where not modeled or not announced). */
  homeStarter: number;
  awayStarter: number;
  homeStarterDetail: string | null;
  awayStarterDetail: string | null;
  /** Home-minus-away adjustments supplied from outside the replay (NBA lineups); 0 when none. */
  extra: number;
  /** Home minus away, including home field, rest, starters and extra. */
  diff: number;
  homeProb: number;
};

export type RatingPoint = { date: string; rating: number };

export type ReplayResult = {
  ratings: Map<string, number>;
  /** Post-game ratings, plus a point at each season start showing the offseason regression. */
  history: Map<string, RatingPoint[]>;
  contexts: Map<string, PregameContext>;
  /** Ratings as the latest season began (after regression). */
  seasonStartRatings: Map<string, number>;
  firstSeason: number | null;
  lastSeason: number | null;
};

/**
 * Walks every game in date order. Each game's prediction is captured before
 * its result is applied, so every graded prediction is out-of-sample. `extra`
 * adds known per-game adjustments (home minus away, in Elo) to both the
 * prediction and the update, so a team that loses without its star doesn't
 * lose rating for it.
 */
export function replay(games: Game[], params: EloParams, starterUnit = 'runs', extra?: Map<string, number>): ReplayResult {
  const starters = params.starter ? new StarterModel(params.starter) : null;
  const ratings = new Map<string, number>();
  const history = new Map<string, RatingPoint[]>();
  const contexts = new Map<string, PregameContext>();
  const lastPlayed = new Map<string, number>();
  let seasonStartRatings = new Map<string, number>();
  let season: number | null = null;
  let firstSeason: number | null = null;

  const rating = (teamId: string) => ratings.get(teamId) ?? MEAN_RATING;
  const record = (teamId: string, date: string, value: number) => {
    const points = history.get(teamId) ?? [];
    points.push({ date, rating: value });
    history.set(teamId, points);
  };

  for (const game of games) {
    if (season === null) {
      season = game.seasonYear;
      firstSeason = game.seasonYear;
    } else if (game.seasonYear > season) {
      seasonStartRatings = new Map();
      for (const [teamId, value] of ratings) {
        const regressed = MEAN_RATING + (value - MEAN_RATING) * (1 - params.regress);
        ratings.set(teamId, regressed);
        seasonStartRatings.set(teamId, regressed);
        record(teamId, game.date, regressed);
      }
      season = game.seasonYear;
    }

    const homeId = game.home.teamId;
    const awayId = game.away.teamId;
    const start = Date.parse(game.date);
    const homeBackToBack = start - (lastPlayed.get(homeId) ?? -Infinity) < BACK_TO_BACK_HOURS * 3_600_000;
    const awayBackToBack = start - (lastPlayed.get(awayId) ?? -Infinity) < BACK_TO_BACK_HOURS * 3_600_000;
    lastPlayed.set(homeId, start);
    lastPlayed.set(awayId, start);

    const homeRating = rating(homeId);
    const awayRating = rating(awayId);
    const hfa = game.neutral ? 0 : params.hfa;
    const homeRest = homeBackToBack ? -params.backToBack : 0;
    const awayRest = awayBackToBack ? -params.backToBack : 0;
    const homeStarter = starters?.adjustment(homeId, game.home.probable) ?? 0;
    const awayStarter = starters?.adjustment(awayId, game.away.probable) ?? 0;
    const adjustment = extra?.get(game.id) ?? 0;
    const diff = homeRating + hfa + homeRest + homeStarter - (awayRating + awayRest + awayStarter) + adjustment;
    const homeProb = winProbability(diff);
    contexts.set(game.id, {
      homeRating,
      awayRating,
      hfa,
      homeBackToBack,
      awayBackToBack,
      homeRest,
      awayRest,
      homeStarter,
      awayStarter,
      homeStarterDetail: starters ? starters.describe(homeId, game.home.probable, starterUnit) : null,
      awayStarterDetail: starters ? starters.describe(awayId, game.away.probable, starterUnit) : null,
      extra: adjustment,
      diff,
      homeProb
    });

    if (!game.completed || game.home.score === null || game.away.score === null) continue;

    starters?.record(homeId, game.home.probable, game.away.score);
    starters?.record(awayId, game.away.probable, game.home.score);

    const margin = game.home.score - game.away.score;
    const outcome = margin > 0 ? 1 : margin < 0 ? 0 : 0.5;
    const winnerDiff = margin >= 0 ? diff : -diff;
    const shift = params.k * movMultiplier(params.mov, margin, winnerDiff) * (outcome - homeProb);
    ratings.set(homeId, homeRating + shift);
    ratings.set(awayId, awayRating - shift);
    record(homeId, game.date, homeRating + shift);
    record(awayId, game.date, awayRating - shift);
  }

  return { ratings, history, contexts, seasonStartRatings, firstSeason, lastSeason: season };
}
