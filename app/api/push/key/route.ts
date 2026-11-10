import { NextResponse } from 'next/server';
import { vapidKeys } from '../../../../lib/push-server';

export const dynamic = 'force-dynamic';

/** GET /api/push/key — the public key browsers subscribe with, so alerts can be checked as coming from this site. */
export async function GET() {
  const { publicKey } = await vapidKeys();
  return NextResponse.json({ publicKey }, { headers: { 'cache-control': 'public, max-age=3600' } });
}
