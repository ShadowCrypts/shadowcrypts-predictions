import { promises as fs } from 'fs';
import path from 'path';
import { NextResponse } from 'next/server';
import { historyNow } from '../../../lib/model/history';

export const dynamic = 'force-dynamic';

/** GET /api/health — for container health checks: the server is up and its data folder is writable. */
export async function GET() {
  const dir = path.join(process.cwd(), '.cache');
  let writable = false;
  try {
    await fs.mkdir(dir, { recursive: true });
    await fs.access(dir, fs.constants.W_OK);
    writable = true;
  } catch {
    // Reported below; the site still serves, it just can't keep its ledger.
  }
  const history = await historyNow();
  return NextResponse.json({ ok: true, cacheWritable: writable, uptimeSeconds: Math.round(process.uptime()), history: { share: Number(history.share.toFixed(3)), loading: history.loading, forecastsSettled: history.forecastsSettled, kinds: history.kinds }, time: new Date().toISOString() }, { headers: { 'cache-control': 'no-store' } });
}
