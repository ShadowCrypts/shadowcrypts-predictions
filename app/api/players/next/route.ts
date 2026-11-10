import { json } from '../../../../lib/http';
import { followedPlayers, parseFollowed } from '../../../../lib/model/followedPlayers';

export const dynamic = 'force-dynamic';

/**
 * GET /api/players/next?ids=nba:3112335,nfl:3918298 — players' next games and
 * main lines (the home page's followed players). `&lines=all` gives every
 * market (the parlay builder's quick add).
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const keys = parseFollowed(params.get('ids'));
  return json(request, { players: await followedPlayers(keys, params.get('lines') === 'all') }, { headers: { 'cache-control': 'no-store' } });
}
