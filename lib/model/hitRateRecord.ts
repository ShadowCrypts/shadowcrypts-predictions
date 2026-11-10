import type { LeagueId } from '../leagues';

/** Games counted in a hit rate on the site. */
export const HIT_GAMES = 10;

/**
 * How lines went where the player had cleared that line in 8 or more of his
 * last 10 games: the book's average chance of the over against how often it
 * went over, on every graded main line (`npm run backtest -- --hit-rates`,
 * November 2026). Re-run and update these if the prop history grows a lot.
 */
export const HOT_STREAKS: Partial<Record<LeagueId, { lines: number; book: number; over: number }>> = {
  nba: { lines: 6961, book: 0.532, over: 0.528 },
  nhl: { lines: 4114, book: 0.562, over: 0.553 },
  nfl: { lines: 1071, book: 0.519, over: 0.503 }
};
