// The model's forecasts with the latest scores laid over them. A model is
// rebuilt in the background every minute or two, so a game under way could
// show a score a couple of minutes old; anything showing games that are on
// (the ticker, live mode, game pages, parlay grading, alerts) reads the
// scoreboard again (at most every 15 seconds) and takes its status, clock and
// scores from there. The forecast itself, made before the game, is untouched.

import { Game, getLiveScores } from '../espn';
import { LEAGUES, LeagueId } from '../leagues';
import type { Prediction } from './index';

/** Games starting within this long, or that started within the last half day, can have moved since the model was built. */
const AHEAD_MS = 2 * 3_600_000;
const BEHIND_MS = 12 * 3_600_000;

/** The prediction with the scoreboard's latest status, clock and scores (and its grade, once that's final). */
export function overlay(p: Prediction, latest: Game | undefined): Prediction {
  if (!latest) return p;
  const g = p.game;
  if (
    latest.state === g.state &&
    latest.statusDetail === g.statusDetail &&
    latest.home.score === g.home.score &&
    latest.away.score === g.away.score &&
    latest.clock === g.clock
  )
    return p;
  const game: Game = {
    ...g,
    state: latest.state,
    completed: latest.completed,
    statusName: latest.statusName,
    statusDetail: latest.statusDetail,
    period: latest.period,
    clock: latest.clock,
    outs: latest.outs,
    home: { ...g.home, score: latest.home.score, winner: latest.home.winner, periods: latest.home.periods },
    away: { ...g.away, score: latest.away.score, winner: latest.away.winner, periods: latest.away.periods }
  };
  const graded =
    game.completed && game.home.score !== null && game.away.score !== null && game.home.score !== game.away.score
      ? (game.home.score > game.away.score) === (p.pick === 'home')
      : p.correct;
  return { ...p, game, correct: graded };
}

/** These predictions with the latest scores, for the ones whose games could have moved; the rest as they are. A feed hiccup changes nothing. */
export async function freshen(league: LeagueId, predictions: Prediction[], now = Date.now()): Promise<Prediction[]> {
  const near = predictions.some((p) => {
    const start = Date.parse(p.game.date);
    return p.game.state === 'in' || (start <= now + AHEAD_MS && start >= now - BEHIND_MS && !p.game.completed);
  });
  if (!near) return predictions;
  const latest = await getLiveScores(LEAGUES[league]).catch(() => null);
  if (!latest) return predictions;
  const byId = new Map(latest.map((g) => [g.id, g]));
  return predictions.map((p) => overlay(p, byId.get(p.game.id)));
}
