import { NextRequest, NextResponse } from 'next/server';
import { log } from './lib/log';
import { notFoundPage } from './lib/notFoundPage';
import { isKnownApi, isKnownPage } from './lib/routes';
import { pageKind, referrerHost, visitor } from './lib/visits';
import { recordRobot, recordVisit } from './lib/visitsStore';
import { clientKey, contentSecurityPolicy, EXPENSIVE_API, isCostlyImage, LIMITS, makeNonce, proxyHops, RateLimiter, REPORTING_ENDPOINTS, SECURITY_HEADERS, Verdict } from './lib/security';

// Runs before every request but build output and the site's fixed files:
// rate limits per client, a cap for everyone on each costly endpoint, pages
// only by GET, and for pages a fresh nonce and the Content Security Policy
// that names it, which Next.js puts on its own scripts and the layout on the
// theme script. Addresses that can't be pages get the not-found page.

const MINUTE = 60_000;
const limiters = {
  expensive: new RateLimiter(LIMITS.expensive, MINUTE),
  /** Keyed by endpoint, not client: each costly endpoint has its own cap for everyone together. */
  everyone: new RateLimiter(LIMITS.expensiveAll, MINUTE),
  api: new RateLimiter(LIMITS.api, MINUTE),
  pages: new RateLimiter(LIMITS.pages, MINUTE),
  prefetch: new RateLimiter(LIMITS.prefetch, MINUTE)
};
const hops = proxyHops();
const dev = process.env.NODE_ENV === 'development';

const limitHeaders = (v: Verdict) => ({ 'ratelimit-limit': String(v.limit), 'ratelimit-remaining': String(v.remaining), 'ratelimit-reset': String(v.resetSeconds) });

function tooMany(v: Verdict, api: boolean, bucket: string, request: NextRequest) {
  // One line per refusal (no address): a burst of these is either an attack or a limit set too low.
  const h = request.headers;
  log('warn', 'rate-limited', { bucket, path: request.nextUrl.pathname, limit: v.limit, dest: h.get('sec-fetch-dest'), mode: h.get('sec-fetch-mode'), purpose: h.get('sec-purpose') ?? h.get('purpose') });
  const headers = { ...limitHeaders(v), 'retry-after': String(v.resetSeconds), 'cache-control': 'no-store' };
  return secured(
    api
      ? NextResponse.json({ error: 'Too many requests. Try again in a minute.' }, { status: 429, headers })
      : new NextResponse('Too many requests. Try again in a minute.', { status: 429, headers: { ...headers, 'content-type': 'text/plain; charset=utf-8' } })
  );
}

/** The per-client allowance for a costly call, then the cap for everyone on that endpoint. */
function costly(who: string, group: string, api: boolean, request: NextRequest) {
  const mine = limiters.expensive.take(who);
  if (!mine.ok) return { mine, refused: tooMany(mine, api, 'expensive', request) };
  const everyone = limiters.everyone.take(group);
  if (!everyone.ok) return { mine, refused: tooMany(everyone, api, `everyone:${group}`, request) };
  return { mine, refused: null };
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const who = clientKey(request.headers, hops);

  if (pathname.startsWith('/api/')) {
    let mine: Verdict;
    if (EXPENSIVE_API.includes(pathname)) {
      const verdict = costly(who, pathname, true, request);
      if (verdict.refused) return verdict.refused;
      mine = verdict.mine;
    } else {
      mine = limiters.api.take(who);
      if (!mine.ok) return tooMany(mine, true, 'api', request);
    }
    // Not an API address: a JSON 404 from here, not the app's HTML not-found page (which outside the page
    // branch would go out without the nonce policy pages carry).
    if (!isKnownApi(pathname)) {
      return secured(
        NextResponse.json(
          { error: 'No such API address. The list is at /data.' },
          { status: 404, headers: { ...limitHeaders(mine), 'cache-control': 'no-store', 'cross-origin-resource-policy': 'same-origin' } }
        )
      );
    }
    const response = NextResponse.next();
    for (const [key, value] of Object.entries(limitHeaders(mine))) response.headers.set(key, value);
    response.headers.set('cross-origin-resource-policy', 'same-origin');
    return response;
  }

  // Pages are only ever read: the site has no forms or server actions, so nothing else is taken.
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return secured(new NextResponse('Method not allowed', { status: 405, headers: { allow: 'GET, HEAD', 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } }));
  }

  let mine: Verdict;
  if (isCostlyImage(pathname)) {
    // Share images are drawn on request: the costly allowance, and a cap for everyone.
    const verdict = costly(who, 'images', false, request);
    if (verdict.refused) return verdict.refused;
    mine = verdict.mine;
  } else {
    // The router's own requests (link prefetches, one per segment, and in-app navigations) come many to a page:
    // they get the larger allowance, and full page loads the stricter one. Next.js strips its router headers
    // before the proxy sees a request, so tell them apart the way the browser labels them: a page load is a
    // "document" fetch, the router's are script fetches ("empty"). Anything unlabeled counts as a page load.
    const routerRequest =
      request.headers.get('sec-fetch-dest') === 'empty' ||
      request.headers.get('purpose') === 'prefetch' ||
      request.headers.get('sec-purpose')?.includes('prefetch') === true;
    mine = (routerRequest ? limiters.prefetch : limiters.pages).take(who);
    if (!mine.ok) return tooMany(mine, false, routerRequest ? 'router' : 'pages', request);
  }

  const nonce = makeNonce();
  const https = request.nextUrl.protocol === 'https:' || request.headers.get('x-forwarded-proto') === 'https';
  const policy = contentSecurityPolicy({ nonce, dev, https });
  // Not an address the site has: the not-found page, straight from here with a 404, before the app runs. (Not a
  // rewrite: Next.js only keeps a rewrite in-process when its target names the exact origin the server started on,
  // which behind a proxy or on another bind address it doesn't, and then the request loops back through here.)
  if (!isKnownPage(pathname)) {
    return withHeaders(new NextResponse(notFoundPage(nonce), { status: 404, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } }), policy, mine);
  }
  countArrival(request);
  const forward = new Headers(request.headers);
  forward.set('x-nonce', nonce);
  forward.set('content-security-policy', policy);
  return withHeaders(NextResponse.next({ request: { headers: forward } }), policy, mine);
}

/** A person opening one of the site's pages: counted as a total for the day, with nothing about who they are; robots in a total of their own (lib/visits.ts). */
function countArrival(request: NextRequest) {
  try {
    const header = (name: string) => request.headers.get(name);
    const who = visitor(request.method, header);
    if (!who) return;
    const page = pageKind(request.nextUrl.pathname);
    if (who !== 'person') return recordRobot(page, who);
    const siteHost = process.env.SITE_URL ? new URL(process.env.SITE_URL).host : null;
    recordVisit(page, referrerHost(header('referer'), [header('host'), header('x-forwarded-host'), siteHost]));
  } catch {
    // Counting never gets in the way of a page.
  }
}

/** Every response the proxy answers itself carries the site's security headers too (next.config.ts adds them to the app's). */
function secured(response: NextResponse) {
  for (const { key, value } of SECURITY_HEADERS) response.headers.set(key, value);
  return response;
}

/** The page's policy, the reporting endpoint and the client's remaining allowance, on a page response. */
function withHeaders(response: NextResponse, policy: string, mine: Verdict) {
  secured(response);
  response.headers.set('content-security-policy', policy);
  response.headers.set('reporting-endpoints', REPORTING_ENDPOINTS);
  for (const [key, value] of Object.entries(limitHeaders(mine))) response.headers.set(key, value);
  return response;
}

export const config = {
  // Everything but build output and the files that really are files: the service worker, the offline page, the
  // signature and backdrop images and the fixed metadata files. Any other address with a dot in it (/wp-login.php,
  // /.env) is still checked here, and so is the sitemap, which is built per request.
  matcher: ['/((?!_next/static/|_next/image|sw\\.js$|offline\\.html$|signature-(?:360|720)\\.webp$|backdrop-(?:wide|tall)-(?:dark|light)\\.webp$|robots\\.txt$|manifest\\.webmanifest$).*)']
};
