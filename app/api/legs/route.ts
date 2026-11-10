import { json } from '../../../lib/http';
import { legResults } from '../../../lib/model/legResults';

export const dynamic = 'force-dynamic';

const MAX_IDS = 200;

/** GET /api/legs?ids=p~nba~401809839~3112335~pts~24.5~over,w~nba~401809839~27 — results for parlay legs (tracked parlays use it). */
export async function GET(request: Request) {
  const raw = new URL(request.url).searchParams.get('ids') ?? '';
  const ids = [...new Set(raw.split(',').map((s) => s.trim()))].filter(Boolean).slice(0, MAX_IDS);
  return json(request, { results: await legResults(ids) }, { headers: { 'cache-control': 'no-store' } });
}
