// What the site sends to keep browsers and the server safe: the Content
// Security Policy for pages (scripts only from this site, each page's own
// inline scripts by a one-time nonce), the headers every response carries, and
// rate limits on requests. Pure, so it's tested like the models.

/** The one other place pages load anything from: ESPN's image service, for team logos and player photos. */
const IMAGES = 'https://a.espncdn.com';

/**
 * The policy for a page. Scripts run only from this site or with this
 * request's nonce ('strict-dynamic' lets those load the code-split rest);
 * styles the same, except the style attributes charts and meters set
 * inline. Nothing may frame the site, and forms, plugins and <base> are off.
 * In development, React needs eval for its error overlays and the dev server
 * injects unnonced styles. Over HTTPS, stray http:// subresources upgrade.
 */
export function contentSecurityPolicy({ nonce, dev = false, https = false }: { nonce: string; dev?: boolean; https?: boolean }) {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ''}`,
    dev ? "style-src 'self' 'unsafe-inline'" : `style-src 'self' 'nonce-${nonce}'`,
    "style-src-attr 'unsafe-inline'",
    `img-src 'self' data: blob: ${IMAGES}`,
    "font-src 'self'",
    "connect-src 'self'",
    "manifest-src 'self'",
    "worker-src 'self'",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(https ? ['upgrade-insecure-requests'] : []),
    // Anything blocked is reported (the Reporting API where browsers have it, the older form otherwise) and logged.
    `report-uri ${REPORT_PATH}`,
    `report-to ${REPORT_GROUP}`
  ].join('; ');
}

/** Where browsers send Content Security Policy reports (`app/api/csp-report`), and the reporting group naming it. */
export const REPORT_PATH = '/api/csp-report';
export const REPORT_GROUP = 'csp';
/** The Reporting-Endpoints header that goes with the policy. */
export const REPORTING_ENDPOINTS = `${REPORT_GROUP}="${REPORT_PATH}"`;

/** The self-contained offline page (inline styles, the app icon, nothing else). */
export const OFFLINE_POLICY = "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

/**
 * Headers on every response. HTTPS is pinned for a year (browsers ignore it
 * over plain HTTP, so local and Tailscale use are unaffected); MIME types are
 * never guessed; no framing; only the origin goes to other sites; the
 * browser features the site has no use for are switched off; and the window
 * isn't shared with pages that open it or that it opens.
 */
export const SECURITY_HEADERS: { key: string; value: string }[] = [
  // HTTPS only for a year, for every name under the domain too (all of them are HTTPS: the site and www's
  // redirect), and eligible for browsers' built-in HTTPS-only list (hstspreload.org).
  { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains; preload' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  {
    key: 'Permissions-Policy',
    value: 'accelerometer=(), autoplay=(), camera=(), display-capture=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), midi=(), payment=(), usb=(), browsing-topics=()'
  },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  { key: 'Origin-Agent-Cluster', value: '?1' },
  { key: 'X-DNS-Prefetch-Control', value: 'off' },
  // No Flash/PDF-era cross-domain policy files honored.
  { key: 'X-Permitted-Cross-Domain-Policies', value: 'none' }
];

/** A fresh nonce: 128 random bits, base64. */
export function makeNonce() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let text = '';
  for (const b of bytes) text += String.fromCharCode(b);
  return btoa(text);
}

/**
 * Who's asking, for rate limits. Behind a reverse proxy, set
 * TRUST_PROXY_HOPS to how many proxies append to X-Forwarded-For (1 for one
 * proxy in front): the address that many places from the right is the
 * client's, which a client can't forge. With no proxy, the server fills the
 * header from the connection, but only when the request didn't bring one, so
 * a client can pose as many; the global caps below hold however many it
 * claims to be.
 */
/** TRUST_PROXY_HOPS as a whole number (0 when unset or nonsense). */
export const proxyHops = () => Math.max(0, Math.floor(Number(process.env.TRUST_PROXY_HOPS ?? 0) || 0));

export function clientKey(headers: Headers, trustHops = 0) {
  const chain = (headers.get('x-forwarded-for') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (!chain.length) return 'unknown';
  if (trustHops > 0) return chain[Math.max(0, chain.length - trustHops)];
  return chain[0];
}

export type Verdict = { ok: boolean; limit: number; remaining: number; resetSeconds: number };

/**
 * Fixed-window counters: at most `limit` hits per key in each `windowMs`.
 * Old windows are swept as it goes, and past `maxKeys` the table is cleared
 * rather than allowed to grow without bound (failing open, not closed).
 */
export class RateLimiter {
  private hits = new Map<string, { start: number; count: number }>();
  private sweptAt = 0;

  constructor(
    readonly limit: number,
    readonly windowMs: number,
    private readonly maxKeys = 50_000
  ) {}

  take(key: string, now = Date.now()): Verdict {
    if (now - this.sweptAt > this.windowMs) {
      for (const [k, w] of this.hits) if (now - w.start >= this.windowMs) this.hits.delete(k);
      this.sweptAt = now;
    }
    if (this.hits.size >= this.maxKeys && !this.hits.has(key)) this.hits.clear();
    let w = this.hits.get(key);
    if (!w || now - w.start >= this.windowMs) {
      w = { start: now, count: 0 };
      this.hits.set(key, w);
    }
    w.count += 1;
    return { ok: w.count <= this.limit, limit: this.limit, remaining: Math.max(0, this.limit - w.count), resetSeconds: Math.max(1, Math.ceil((w.start + this.windowMs - now) / 1000)) };
  }
}

/**
 * Whether a state-changing request comes from the site's own pages: JSON only
 * (another site can't send that without a preflight the server never grants),
 * and when the browser names an origin, ours. Programs that send no Origin
 * header pass on the content type alone.
 */
export function fromOwnPages(headers: Headers, siteUrl = process.env.SITE_URL) {
  if (!/^application\/json\b/i.test(headers.get('content-type') ?? '')) return false;
  const origin = headers.get('origin');
  if (!origin) return true;
  try {
    const from = new URL(origin);
    // The public address (behind a reverse proxy the Host header may name the server instead), or this host.
    if (siteUrl && from.origin === new URL(siteUrl).origin) return true;
    return from.host === (headers.get('x-forwarded-host') ?? headers.get('host'));
  } catch {
    return false;
  }
}

/**
 * The API calls that cost the most (reaching ESPN for games in progress,
 * writing to disk, sending push alerts, logging): tighter limits per client,
 * plus a cap per endpoint for everyone together.
 */
export const EXPENSIVE_API = ['/api/legs', '/api/sweat', '/api/cards', '/api/calendar', '/api/push/watch', '/api/push/unwatch', '/api/csp-report', '/api/feedback'];

/** Images drawn on request (share previews, app icons in any size): the costly allowance too. */
export const isCostlyImage = (pathname: string) => pathname.endsWith('/opengraph-image') || pathname.startsWith('/brand-icon/');

/**
 * Requests a minute: per client and, for the expensive calls, for all clients
 * together. Generous next to what the pages ask for (every minute or so); the
 * router's prefetches run to dozens a page, one per link segment in view.
 */
export const LIMITS = {
  expensive: 40,
  expensiveAll: 1_200,
  api: 120,
  pages: 300,
  prefetch: 3_000
};
