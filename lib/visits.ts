// Counting visitors without tracking them: how many times someone opened the site, which kind of
// page they landed on, and which website sent them. No IP addresses, no cookies, no fingerprints and
// no record of anyone one by one: just totals per day. Pure, so the rules are tested on their own.

/** One day's totals. `arrivals` is every page load a real browser made: opening the site, following a link to it, reloading. */
export type DayCounts = { arrivals: number; pages: Record<string, number>; from: Record<string, number> };

/** Past this many different pages or sites in a day, the rest add up under "other", so a flood of odd addresses can't grow a file without end. */
export const MAX_KEYS = 300;

export const emptyDay = (): DayCounts => ({ arrivals: 0, pages: {}, from: {} });

const bump = (counts: Record<string, number>, key: string, by = 1) => {
  const at = key in counts || Object.keys(counts).length < MAX_KEYS ? key : 'other';
  counts[at] = (counts[at] ?? 0) + by;
};

export function addVisit(day: DayCounts, page: string, from: string | null) {
  day.arrivals += 1;
  bump(day.pages, page);
  bump(day.from, from ?? 'direct');
}

export function mergeDays(a: DayCounts, b: DayCounts): DayCounts {
  const out: DayCounts = { arrivals: a.arrivals + b.arrivals, pages: { ...a.pages }, from: { ...a.from } };
  for (const [k, v] of Object.entries(b.pages)) bump(out.pages, k, v);
  for (const [k, v] of Object.entries(b.from)) bump(out.from, k, v);
  return out;
}

/** Robots, link previews and test tools: not people. */
const NOT_PEOPLE =
  /bot\b|bot\/|crawl|spider|slurp|archiver|preview|facebookexternalhit|whatsapp|telegram|discord|slack|embedly|lighthouse|headless|puppeteer|playwright|selenium|phantom|curl|wget|python|httpclient|axios|node-fetch|undici|^node$|go-http-client|java\/|okhttp|libwww/i;

/**
 * Whether a request is a person opening a page: a navigation (not the app's own background fetches, an
 * image, or a prefetch or prerender a browser made in case), from a browser that isn't a robot. Moving
 * between pages inside the site happens in the background, so it isn't counted: an arrival is someone
 * coming to the site, or reloading.
 *
 * The fetch mode decides, not the destination: once a visitor has the site's offline service worker, it
 * passes each page load on itself, and Chrome sends those with destination "empty" but mode "navigate"
 * (measured on Nov 10, 2026). Going by the destination missed every page load after a first visit.
 */
export function countable(method: string, header: (name: string) => string | null) {
  if (method !== 'GET') return false;
  const mode = header('sec-fetch-mode');
  const dest = header('sec-fetch-dest');
  if (mode || dest) {
    // "document" from the browser itself, "empty" when the service worker passes it on; never a frame.
    if (mode !== 'navigate' || (dest !== null && dest !== 'document' && dest !== 'empty')) return false;
  } else if (!(header('accept') ?? '').includes('text/html')) {
    // A browser too old to say what it's fetching: a page is what asks for HTML.
    return false;
  }
  if (/prefetch|prerender/i.test(`${header('purpose') ?? ''} ${header('sec-purpose') ?? ''}`)) return false;
  const agent = header('user-agent') ?? '';
  return agent.length > 0 && !NOT_PEOPLE.test(agent);
}

/** The kind of page, so every game page counts together: "/nba/game/*", not one line per game. */
export function pageKind(pathname: string) {
  const parts = pathname
    .split('/')
    .filter(Boolean)
    .map((p) => p.toLowerCase());
  if (!parts.length) return '/';
  if (parts.length >= 3 && /^\d+$/.test(parts[2])) return `/${parts[0]}/${parts[1]}/*`;
  if ((parts[0] === 'parlay' || parts[0] === 'picks') && parts[1] === 's') return `/${parts[0]}/s/*`;
  return `/${parts.slice(0, 2).join('/')}`;
}

const bare = (host: string) => host.toLowerCase().replace(/:\d+$/, '').replace(/^www\./, '');

/** The website a visitor came from (just its name, like "google.com"), or null for typing the address, a bookmark, or a link within the site. */
export function referrerHost(referer: string | null, ownHosts: (string | null | undefined)[]) {
  if (!referer) return null;
  try {
    const url = new URL(referer);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    const host = bare(url.hostname);
    const own = new Set(ownHosts.filter((h): h is string => !!h).map(bare));
    return host && !own.has(host) ? host.slice(0, 80) : null;
  } catch {
    return null;
  }
}
