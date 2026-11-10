import { promisify } from 'node:util';
import { brotliCompress, constants, gzip } from 'node:zlib';

const brotli = promisify(brotliCompress);
const gzipped = promisify(gzip);

/** Below this, compressing costs more than it saves. */
const MIN_COMPRESS_BYTES = 1024;

/** The best encoding the client accepts: brotli, then gzip, else none (an encoding with q=0 is refused). */
export function pickEncoding(accept: string | null): 'br' | 'gzip' | null {
  const offered = new Map<string, number>();
  for (const part of (accept ?? '').toLowerCase().split(',')) {
    const [name, ...params] = part.trim().split(';');
    if (!name) continue;
    const q = params.map((p) => p.trim()).find((p) => p.startsWith('q='));
    offered.set(name.trim(), q ? Number(q.slice(2)) || 0 : 1);
  }
  const ok = (name: string) => (offered.get(name) ?? offered.get('*') ?? 0) > 0;
  if (ok('br')) return 'br';
  if (ok('gzip')) return 'gzip';
  return null;
}

/**
 * A text response, compressed when the client accepts it. Next.js compresses
 * pages but sends route handlers' bodies as they are, so without this the API
 * (the live board polled every 15 seconds, the player list for search) goes out
 * at full size.
 */
export async function send(request: Request, body: string, init: ResponseInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.append('vary', 'accept-encoding');
  const size = Buffer.byteLength(body);
  const encoding = size >= MIN_COMPRESS_BYTES ? pickEncoding(request.headers.get('accept-encoding')) : null;
  if (!encoding) return new Response(body, { ...init, headers });
  const packed =
    encoding === 'br'
      ? await brotli(body, { params: { [constants.BROTLI_PARAM_QUALITY]: 5, [constants.BROTLI_PARAM_SIZE_HINT]: size } })
      : await gzipped(body, { level: 6 });
  headers.set('content-encoding', encoding);
  return new Response(new Uint8Array(packed), { ...init, headers });
}

/** JSON, compressed when the client accepts it (see `send`). */
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
