import { BoxScore, getBoxScores, getNflSkillBoxes, NflSkillBox } from '../boxscores';
import type { Game } from '../espn';
import type { LeagueConfig } from '../leagues';
import { getPropHistory, getUpcomingProps } from '../propFeed';
import type { PropLine } from '../props';
import type { LeagueModel } from './index';
import { propBoard } from './propBoard';
import { propEngine } from './propEngines';
import type { Actuals } from './propModel';

/**
 * One game's player projections next to the books' props: the posted lines
 * before and during it, the closing lines and results once it's final. Null
 * where the league has no player model or the game no projection. Shared by
 * the game page and a player's page while his game is on.
 */
export async function gamePropBoard(league: LeagueConfig, model: LeagueModel, game: Game) {
  const projection = model.playerProjections[game.id];
  const engine = propEngine(league);
  if (!engine || !projection) return null;
  const lines = game.completed
    ? ((await getPropHistory(league, [game], 1).catch(() => ({}) as Record<string, PropLine[] | null>))[game.id] ?? null)
    : await getUpcomingProps(league, game.id).catch(() => null);
  let actuals: Actuals | null = null;
  if (game.completed) {
    const [box, skill] = await Promise.all([
      getBoxScores(league, [game], 1).catch(() => ({}) as Record<string, BoxScore | null>),
      getNflSkillBoxes(league, [game], 1).catch(() => ({}) as Record<string, NflSkillBox | null>)
    ]);
    actuals = engine.actuals(game.id, {
      games: [game],
      box,
      skill,
      context: { teamPoints: new Map(), leaguePoints: new Map() },
      live: { rosters: {}, injuries: {}, starters: new Map() }
    });
  }
  return propBoard(engine.params, engine.markets, projection, lines, actuals);
}
