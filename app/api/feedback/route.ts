import { NextResponse } from 'next/server';
import { FEEDBACK_LIMITS } from '../../../lib/feedback';
import { readFeedback } from '../../../lib/feedbackRead';
import { saveFeedback } from '../../../lib/feedbackStore';
import { readCapped } from '../../../lib/http';
import { log } from '../../../lib/log';
import { clientKey, fromOwnPages, proxyHops, RateLimiter } from '../../../lib/security';

export const dynamic = 'force-dynamic';

const HOUR = 3_600_000;
/** Messages per address an hour, in memory only (one counter for the process, however the route is bundled). */
const shared = globalThis as typeof globalThis & { __scFeedback?: RateLimiter };
const perAddress = () => (shared.__scFeedback ??= new RateLimiter(FEEDBACK_LIMITS.perHour, HOUR, 20_000));

const answer = (status: number, body: Record<string, unknown>) => NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });

/**
 * POST /api/feedback — a message from the feedback form (/feedback), kept for the site's owner. JSON from the
 * site's own pages only; a few messages per address an hour; nothing about the sender kept but what they wrote
 * and, if they gave one, a way to reach them.
 */
export async function POST(request: Request) {
  if (!fromOwnPages(request.headers)) return answer(415, { error: 'JSON from this site only' });
  const text = await readCapped(request, FEEDBACK_LIMITS.bytes);
  if (text === null) return answer(413, { error: `Please keep it under ${FEEDBACK_LIMITS.message.toLocaleString('en-US')} characters.` });
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return answer(400, { error: 'That didn’t come through right. Try again.' });
  }
  const read = readFeedback(body);
  if ('error' in read) return answer(422, { error: read.error });
  // The hidden field only programs fill in: told it worked, so they move on, and nothing is kept.
  if ('trap' in read) return answer(201, { ok: true });
  if (!perAddress().take(clientKey(request.headers, proxyHops())).ok) {
    return answer(429, { error: 'That’s a lot of messages for one hour. Thanks! Try again a bit later.' });
  }
  try {
    if ((await saveFeedback(read.entry)) === 'full') return answer(503, { error: 'The feedback box is full for this month. Try again next month.' });
  } catch (error) {
    log('error', 'feedback-not-saved', { reason: error instanceof Error ? error.message.slice(0, 160) : null });
    return answer(500, { error: 'It didn’t save. Try again in a bit.' });
  }
  // One line in the log so the owner can see one arrived (what it says stays in the file).
  log('info', 'feedback', { kind: read.entry.kind });
  return answer(201, { ok: true });
}
