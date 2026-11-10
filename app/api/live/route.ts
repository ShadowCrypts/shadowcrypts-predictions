import { json } from '../../../lib/http';
import { liveBoard } from '../../../lib/model/liveBoard';

export const dynamic = 'force-dynamic';

/** GET /api/live — every league's games on now, starting soon and just finished (the ticker and live mode use it). */
export async function GET(request: Request) {
  return json(request, await liveBoard(), { headers: { 'cache-control': 'no-store' } });
}
