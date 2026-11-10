import { json } from '../../../lib/http';
import { LEAGUE_IDS, LEAGUES } from '../../../lib/leagues';
import { getLeagueModel } from '../../../lib/model';
import { playerDirectory } from '../../../lib/model/playerIndex';
import { propEngine } from '../../../lib/model/propEngines';

export const dynamic = 'force-dynamic';

/** GET /api/players — every player with a page (NBA, NHL and NFL), for search: league, id, name, team, games in the last two months. */
export async function GET(request: Request) {
  const leagues = LEAGUE_IDS.filter((id) => propEngine(LEAGUES[id]));
  const results = await Promise.allSettled(leagues.map(async (id) => playerDirectory(LEAGUES[id], await getLeagueModel(id))));
  const players = results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
  return json(request, { players }, { headers: { 'cache-control': 'public, max-age=3600' } });
}
