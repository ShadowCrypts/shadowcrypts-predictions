import { json } from '../../../lib/http';
import { isLeagueId, LeagueId } from '../../../lib/leagues';
import { getLeagueModel } from '../../../lib/model';
import { toCard } from '../../../lib/model/card';

export const dynamic = 'force-dynamic';

const MAX_IDS = 300;

/** GET /api/cards?ids=nba:401909095,nfl:401873011 — game cards for specific games (the picks page uses it). */
export async function GET(request: Request) {
  const raw = new URL(request.url).searchParams.get('ids') ?? '';
  const ids = raw
    .split(',')
    .map((s) => s.trim().split(':'))
    .filter((parts): parts is [LeagueId, string] => parts.length === 2 && isLeagueId(parts[0]) && /^\d+$/.test(parts[1]))
    .slice(0, MAX_IDS);
  const leagues = [...new Set(ids.map(([league]) => league))];
  const models = new Map(await Promise.all(leagues.map(async (id) => [id, await getLeagueModel(id)] as const)));
  const cards = ids.map(([league, id]) => models.get(league)?.predictions[id]).filter((p) => p !== undefined).map((p) => toCard(p!));
  return json(request, { cards }, { headers: { 'cache-control': 'public, max-age=60' } });
}
