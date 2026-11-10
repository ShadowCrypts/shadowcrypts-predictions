import { json } from '../../../lib/http';
import { parlaySweat } from '../../../lib/model/sweat';

export const dynamic = 'force-dynamic';

const MAX_IDS = 40;

/** GET /api/sweat?ids=p~nba~401809839~3112335~pts~24.5~over,w~nba~401809839~27 — a tracked parlay's games, play by play. */
export async function GET(request: Request) {
  const raw = new URL(request.url).searchParams.get('ids') ?? '';
  const ids = [...new Set(raw.split(',').map((s) => s.trim()))].filter(Boolean).slice(0, MAX_IDS);
  return json(request, { games: await parlaySweat(ids) }, { headers: { 'cache-control': 'no-store' } });
}
