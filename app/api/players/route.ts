import { json } from '../../../lib/http';
import { LEAGUE_IDS, LEAGUES } from '../../../lib/leagues';
import { getLeagueModel } from '../../../lib/model';
import { playerDirectory } from '../../../lib/model/playerIndex';
import { propEngine } from '../../../lib/model/propEngines';
import type { PlayerHit } from '../../../lib/search';
import { getUfcModel } from '../../../lib/ufc/model';

export const dynamic = 'force-dynamic';

/** Active UFC fighters for search, their division as the "team"; ranked fighters first among equal names. */
async function fighters(): Promise<PlayerHit[]> {
  const model = await getUfcModel();
  return [...model.fighters.values()]
    .filter((f) => f.active)
    .map((f) => ({ league: 'ufc' as const, id: f.profile.id, name: f.profile.name, team: f.division ?? 'UFC', usage: f.rank ? 1 - f.rank / 1000 : 0.5 }));
}

/** GET /api/players — every player with a page (NBA, NHL and NFL) and every active UFC fighter, for search: league, id, name, team, how much they've played lately. */
export async function GET(request: Request) {
  const leagues = LEAGUE_IDS.filter((id) => propEngine(LEAGUES[id]));
  const results = await Promise.allSettled([...leagues.map(async (id) => playerDirectory(LEAGUES[id], await getLeagueModel(id))), fighters()]);
  const players = results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
  return json(request, { players }, { headers: { 'cache-control': 'public, max-age=3600' } });
}
