import { getLiveBox, LiveBox } from '../boxscores';
import type { Game } from '../espn';
import type { LeagueConfig } from '../leagues';
import { liveDecision } from '../legs';
import type { PropMarket } from '../props';
import { remainingNow } from './live';
import { liveOverChance } from './liveProps';
import type { PropBoard } from './propBoard';
import { propEngine } from './propEngines';

/** One player's prop while his game is on: the stat so far, and the chance the over hits from here (1 once it has). */
export type LiveCell = { current: number | null; over: number | null };
export type LiveProps = { status: string; cells: Record<string, Partial<Record<PropMarket, LiveCell>>> };

/**
 * Every line on a game's prop board, live: each player's stat so far from
 * ESPN's live box score (read at most every 30 seconds, shared with parlay
 * tracking) and the live chance of the over, from the same model tracked
 * parlays use: the pregame line and chance, the time left, the pace so far
 * and the score. Null when the game isn't on or the feed has nothing yet.
 */
export async function gameLiveProps(league: LeagueConfig, game: Game, board: PropBoard): Promise<LiveProps | null> {
  if (!propEngine(league) || game.state !== 'in') return null;
  const read = await getLiveBox(league, game.id).catch(() => null);
  return read ? livePropsFrom(league, game, board, read) : null;
}

/** The same, from one read of the live box score. */
export function livePropsFrom(league: LeagueConfig, game: Game, board: PropBoard, read: LiveBox): LiveProps | null {
  const engine = propEngine(league);
  if (!engine || (!read.box && !read.skill)) return null;
  const stats = engine.actuals(game.id, {
    games: [game],
    box: { [game.id]: read.box },
    skill: { [game.id]: read.skill },
    context: { teamPoints: new Map(), leaguePoints: new Map() },
    live: { rosters: {}, injuries: {}, starters: new Map() }
  });
  const status = read.status ?? game.statusDetail;
  const left = remainingNow(league.id, { period: read.period ?? game.period ?? 0, clock: read.clock ?? game.clock, outs: null, statusDetail: status });
  const played = left === null ? null : 1 - left;
  const margin = read.margin ?? (game.home.score !== null && game.away.score !== null ? game.home.score - game.away.score : null);
  const live = engine.params.live;

  const cells: LiveProps['cells'] = {};
  for (const row of board.rows) {
    const mine = stats?.get(row.id);
    const edge = margin === null ? null : row.teamId === game.home.teamId ? margin : -margin;
    for (const [market, cell] of Object.entries(row.cells) as [PropMarket, NonNullable<(typeof row.cells)[PropMarket]>][]) {
      // Not in the box score yet: he hasn't played, and books void a player who never does.
      const current = mine ? (mine[market] ?? 0) : null;
      let over: number | null = null;
      if (current !== null && cell.line) {
        if (liveDecision(current, cell.line.line, 'over', market) === 'won') over = 1;
        else if (live && played !== null) {
          over = liveOverChance(engine.params, live, market, cell.line.line, cell.line.forecastOver, { current, played, lead: Math.abs(margin ?? 0), edge });
        }
      }
      (cells[row.id] ??= {})[market] = { current, over };
    }
  }
  return { status, cells };
}
