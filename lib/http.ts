/**
 * A text response from a route handler. Compressing it is left to Next.js: since 16.4.5 it drops a route
 * handler's own Content-Encoding (part of a security fix for forwarded responses), and since 16.4.6 it gzips
 * route handlers' answers itself, so a body compressed here would go out compressed twice under one label,
 * unreadable. (Until then the API compressed its own answers with brotli, as Next.js left them at full size.)
 * The request stays in the signature for the routes that call it.
 */
export async function send(_request: Request, body: string, init: ResponseInit = {}): Promise<Response> {
  return new Response(body, { ...init, headers: new Headers(init.headers) });
}

/** JSON (see `send`). */
export function json(request: Request, data: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set('content-type', 'application/json');
  return send(request, JSON.stringify(data), { ...init, headers });
}

/**
 * A request body as text, read only up to `max` bytes: null once it's longer
 * (by its declared length, or as it streams in without one), and the rest is
 * never held in memory. `request.text()` would buffer a body of any size.
 */
export async function readCapped(request: Request, max: number): Promise<string | null> {
  if (Number(request.headers.get('content-length') ?? 0) > max) return null;
  const reader = request.body?.getReader();
  if (!reader) return '';
  const parts: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    parts.push(value);
  }
  const all = new Uint8Array(size);
  let at = 0;
  for (const p of parts) {
    all.set(p, at);
    at += p.byteLength;
  }
  return new TextDecoder().decode(all);
}
