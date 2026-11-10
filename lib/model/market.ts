import type { MarketOdds } from '../espn';
import type { LeagueConfig } from '../leagues';
import { winProbability } from './elo';

export type MarketView = MarketOdds & {
  /** Home win probability implied by the line, with the bookmaker's margin removed. */
  homeProb: number;
  source: 'moneyline' | 'spread';
};

export function impliedProbability(american: number) {
  return american < 0 ? -american / (-american + 100) : 100 / (american + 100);
}

export function marketView(odds: MarketOdds | null, league: LeagueConfig): MarketView | null {
  if (!odds) return null;
  if (odds.homeMoneyline !== null && odds.awayMoneyline !== null) {
    const home = impliedProbability(odds.homeMoneyline);
    const away = impliedProbability(odds.awayMoneyline);
    return { ...odds, homeProb: home / (home + away), source: 'moneyline' };
  }
  // Run lines and puck lines are always ±1.5, so only football and basketball spreads carry a price.
  if (odds.homeSpread !== null && league.elo.eloPerPoint) {
    return { ...odds, homeProb: winProbability(-odds.homeSpread * league.elo.eloPerPoint), source: 'spread' };
  }
  return null;
}

const logit = (p: number) => Math.log(p / (1 - p));

/** Combines the rating model and the market in logit space; `modelShare` 0 means "follow the market". */
export function blendProbability(modelProb: number, marketProb: number, modelShare: number) {
  const clamp = (p: number) => Math.min(0.995, Math.max(0.005, p));
  const z = modelShare * logit(clamp(modelProb)) + (1 - modelShare) * logit(clamp(marketProb));
  return 1 / (1 + Math.exp(-z));
}

/**
 * The American odds a probability is worth with no bookmaker margin: what a
 * fair price on that side would be. Favorites are negative, underdogs positive.
 */
export function fairAmerican(probability: number) {
  const p = Math.min(0.999, Math.max(0.001, probability));
  return p >= 0.5 ? -Math.round((100 * p) / (1 - p)) : Math.round((100 * (1 - p)) / p);
}

export function formatAmerican(value: number | null) {
  if (value === null) return '—';
  return value > 0 ? `+${value}` : String(value);
}
