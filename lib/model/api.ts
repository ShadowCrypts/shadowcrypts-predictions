import type { GameSide } from '../espn';
import { LEAGUE_IDS, LeagueId, isLeagueId } from '../leagues';
import type { Prediction } from './index';
import { liveNow } from './live';
import { fairAmerican } from './market';

/** Reads ?league=; omitted means every league, undefined means an invalid value. */
export function leaguesFromQuery(url: string): LeagueId[] | undefined {
  const value = new URL(url).searchParams.get('league');
  if (!value) return LEAGUE_IDS;
  return isLeagueId(value) ? [value] : undefined;
}

function side(s: GameSide) {
  return { id: s.teamId, abbr: s.abbr, name: s.name, record: s.record, score: s.score };
}

/**
 * A CSV field: quoted when it holds a comma, quote or line break, quotes
 * doubled, and text a spreadsheet would read as a formula (=, +, @) prefixed
 * with an apostrophe so it stays text.
 */
const csvField = (value: string | number | boolean | null) => {
  let text = value === null ? '' : String(value);
  if (typeof value === 'string' && /^[=+@\t]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

export const GRADED_COLUMNS = [
  'league',
  'game_id',
  'start_utc',
  'season',
  'away',
  'home',
  'away_score',
  'home_score',
  'home_win_probability',
  'pick',
  'pick_probability',
  'correct',
  'line_posted',
  'logged_home_win_probability'
] as const;

/**
 * The games the track record grades, as CSV, oldest first (pass only the
 * graded seasons' predictions): the forecast the backtest grades every game on
 * (the closing line where one was posted, otherwise the pre-line forecast),
 * its pick (home at 50% or more) and whether it won; ties are left out, as
 * the record leaves them out. Where a forecast was also locked before the
 * game, `logged_home_win_probability` has it: the forward-tested record grades
 * those.
 */
export function gradedCsv(predictions: Prediction[]) {
  const rows = predictions
    .filter((p) => p.game.completed && p.game.home.score !== null && p.game.away.score !== null && p.game.home.score !== p.game.away.score)
    .sort((a, b) => a.game.date.localeCompare(b.game.date))
    .map((p) => {
      const homeProb = p.gradedHomeProb ?? p.homeProb;
      const pickHome = homeProb >= 0.5;
      const homeWon = p.game.home.score! > p.game.away.score!;
      return [
        p.game.league,
        p.game.id,
        p.game.date,
        p.game.seasonYear,
        p.game.away.abbr,
        p.game.home.abbr,
        p.game.away.score,
        p.game.home.score,
        Number(homeProb.toFixed(4)),
        pickHome ? p.game.home.abbr : p.game.away.abbr,
        Number((pickHome ? homeProb : 1 - homeProb).toFixed(4)),
        pickHome === homeWon,
        p.market !== null,
        p.source === 'logged' ? Number(p.homeProb.toFixed(4)) : null
      ]
        .map(csvField)
        .join(',');
    });
  return [GRADED_COLUMNS.join(','), ...rows].join('\r\n') + '\r\n';
}

/** Public JSON shape for a prediction: stable, flat, without internal fields. */
export function predictionJson(p: Prediction) {
  const { game } = p;
  const live = liveNow(game.league, game, p.homeProb);
  return {
    id: game.id,
    league: game.league,
    start: game.date,
    state: game.state,
    status: game.statusDetail,
    live: live ? { homeWinProbability: Number(live.homeProb.toFixed(4)), remaining: Number(live.remaining.toFixed(3)) } : null,
    neutralSite: game.neutral,
    away: side(game.away),
    home: side(game.home),
    homeWinProbability: Number(p.homeProb.toFixed(4)),
    pick: p.pick === 'home' ? game.home.abbr : game.away.abbr,
    pickProbability: Number(p.pickProb.toFixed(4)),
    fairMoneyline: { home: fairAmerican(p.homeProb), away: fairAmerican(1 - p.homeProb) },
    confidence: p.band,
    basis: p.basis,
    ratingModel: {
      homeWinProbability: Number(p.modelHomeProb.toFixed(4)),
      homeSpread: p.modelSpread
    },
    marketImpliedRatings: { homeWinProbability: Number(p.marketRatingHomeProb.toFixed(4)) },
    preLine: { homeWinProbability: Number(p.preLineHomeProb.toFixed(4)) },
    market: p.market
      ? {
          provider: p.market.provider,
          homeWinProbability: Number(p.market.homeProb.toFixed(4)),
          homeSpread: p.market.homeSpread,
          homeMoneyline: p.market.homeMoneyline,
          awayMoneyline: p.market.awayMoneyline,
          total: p.market.overUnder
        }
      : null,
    ratingsMinusMarket: p.disagreement === null ? null : Number(p.disagreement.toFixed(4)),
    projectedScore: p.projected
      ? {
          home: Number(p.projected.home.toFixed(1)),
          away: Number(p.projected.away.toFixed(1)),
          totalFrom: p.projected.totalFrom,
          marginFrom: p.projected.marginFrom
        }
      : null,
    factors: p.factors,
    source: p.source,
    correct: p.correct
  };
}
