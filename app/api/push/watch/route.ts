import { NextResponse } from 'next/server';
import { readCapped } from '../../../../lib/http';
import { PUSH_LIMITS, readWatchRequest } from '../../../../lib/push';
import { isWatched, sendFirst, upsertWatch } from '../../../../lib/push-server';
import { fromOwnPages } from '../../../../lib/security';

export const dynamic = 'force-dynamic';

/**
 * POST /api/push/watch — a browser's push address and what it wants watched
 * (its open parlays' legs, its followed teams), replacing whatever it sent
 * before. A browser new to the server is only kept once its push service has
 * taken the "alerts are on" alert, so the list holds real, working
 * subscriptions made with this site's key, never junk that could crowd them out.
 */
export async function POST(request: Request) {
  if (!fromOwnPages(request.headers)) return NextResponse.json({ error: 'JSON from this site only' }, { status: 415 });
  const text = await readCapped(request, PUSH_LIMITS.bytes);
  if (text === null) return new Response(null, { status: 413 });
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: 'Not JSON' }, { status: 400 });
  }
  const watch = readWatchRequest(body);
  if (!watch) return NextResponse.json({ error: 'Not a push subscription from a browser push service' }, { status: 422 });
  if (!(await isWatched(watch.subscription.endpoint))) {
    const outcome = await sendFirst(watch, {
      title: 'Alerts are on',
      body: 'You’ll hear when your parlay legs hit or miss and when your teams’ games start and finish, even with the site closed.',
      tag: 'welcome',
      url: '/live'
    });
    if (outcome !== 'ok') return NextResponse.json({ ok: false, error: 'The push service didn’t accept the alert' }, { status: 502 });
  }
  await upsertWatch(watch);
  return NextResponse.json({ ok: true, parlays: watch.parlays.length, teams: watch.teams.length }, { headers: { 'cache-control': 'no-store' } });
}
