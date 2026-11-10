import { isLeagueId, LEAGUES } from '../leagues';
import { ParsedLeg, parseLegId } from '../legs';
import { getPlayMoments, MARKET_PARTS } from '../playSplits';
import { getLeagueModel } from './index';

/**
 * One game a tracked parlay has legs in, play by play: enough to replay every
 * leg's chance through it. Columns line up by moment.
 */
export type SweatGame = {
  league: string;
  /** The home team, to read the score from either side. */
  home: string;
  final: boolean;
  /** Wall-clock time (ms), share of regulation played and the home-minus-away score at each moment. */
  t: number[];
  played: number[];
  margin: number[];
  /** Each prop leg's stat at every moment, by leg id. */
  stats: Record<string, number[]>;
};

/** A moment is kept when a leg's stat or the score moves, and at least once a minute in between, so time running out shows. */
const EVERY_MS = 60_000;

/**
 * The games behind a parlay's legs, rebuilt from play-by-play for games under
 * way or over (games not started have nothing to show yet).
 */
export async function parlaySweat(ids: string[]): Promise<Record<string, SweatGame>> {
  const parsed = ids.map((id) => [id, parseLegId(id)] as const).filter((x): x is readonly [string, ParsedLeg] => !!x[1] && isLeagueId(x[1].league));
  const out: Record<string, SweatGame> = {};
  for (const leagueId of new Set(parsed.map(([, l]) => l.league))) {
    if (!isLeagueId(leagueId)) continue;
    const league = LEAGUES[leagueId];
    const model = await getLeagueModel(leagueId).catch(() => null);
    if (!model) continue;
    const legs = parsed.filter(([, l]) => l.league === leagueId);
    await Promise.all(
      [...new Set(legs.map(([, l]) => l.gameId))].map(async (gameId) => {
        const game = model.predictions[gameId]?.game;
        if (!game || game.state === 'pre' || (game.state === 'post' && !game.completed)) return;
        const moments = await getPlayMoments(league, gameId, game.completed).catch(() => null);
        if (!moments?.length) return;
        const props = legs.flatMap(([id, l]) => (l.gameId === gameId && l.kind === 'prop' ? [{ id, leg: l, parts: new Set(MARKET_PARTS[leagueId]?.[l.market] ?? []), total: 0 }] : []));
        const g: SweatGame = { league: leagueId, home: game.home.teamId, final: game.completed, t: [], played: [], margin: [], stats: Object.fromEntries(props.map((p) => [p.id, []])) };
        let kept = -Infinity;
        moments.forEach((m, i) => {
          let moved = false;
          for (const [playerId, stat, n] of m.credits) {
            for (const p of props) {
              if (p.leg.playerId === playerId && p.parts.has(stat)) {
                p.total += n;
                moved = true;
              }
            }
          }
          if (!(i === 0 || i === moments.length - 1 || moved || m.margin !== g.margin.at(-1) || m.t - kept >= EVERY_MS)) return;
          kept = m.t;
          g.t.push(m.t);
          g.played.push(Math.round(m.played * 10_000) / 10_000);
          g.margin.push(m.margin);
          for (const p of props) g.stats[p.id].push(p.total);
        });
        out[gameId] = g;
      })
    );
  }
  return out;
}
