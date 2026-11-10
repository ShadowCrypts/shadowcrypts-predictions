import { readCapped } from '../../../../lib/http';
import { isPushEndpoint } from '../../../../lib/push';
import { removeWatch } from '../../../../lib/push-server';
import { fromOwnPages } from '../../../../lib/security';

export const dynamic = 'force-dynamic';

/** POST /api/push/unwatch — `{ endpoint }`: forget this browser's push address and everything it was watching. */
export async function POST(request: Request) {
  if (!fromOwnPages(request.headers)) return new Response(null, { status: 415 });
  const text = await readCapped(request, 2_048);
  if (text === null) return new Response(null, { status: 413 });
  let endpoint: unknown;
  try {
    endpoint = (JSON.parse(text) as { endpoint?: unknown }).endpoint;
  } catch {
    return new Response(null, { status: 400 });
  }
  if (!isPushEndpoint(endpoint)) return new Response(null, { status: 422 });
  await removeWatch(endpoint as string);
  return new Response(null, { status: 204 });
}
