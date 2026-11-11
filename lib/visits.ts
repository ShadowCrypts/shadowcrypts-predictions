// Counting visitors without tracking them: how many times someone opened the site, which kind of
// page they landed on, and which website sent them. No IP addresses, no cookies, no fingerprints and
// no record of anyone one by one: just totals per day. Pure, so the rules are tested on their own.

/** Page loads set aside as robots and scripts: how many, which kind of page, and why each was set aside. */
export type RobotCounts = { arrivals: number; pages: Record<string, number>; why: Record<string, number> };

/**
 * One day's totals. `arrivals` is every page load a person's browser made: opening the site, following a
 * link to it, reloading. `robots`, kept apart, is the page loads that weren't people.
 */
export type DayCounts = { arrivals: number; pages: Record<string, number>; from: Record<string, number>; robots?: RobotCounts };

/** Past this many different pages or sites in a day, the rest add up under "other", so a flood of odd addresses can't grow a file without end. */
export const MAX_KEYS = 300;

export const emptyDay = (): DayCounts => ({ arrivals: 0, pages: {}, from: {} });
const emptyRobots = (): RobotCounts => ({ arrivals: 0, pages: {}, why: {} });

const bump = (counts: Record<string, number>, key: string, by = 1) => {
  const at = key in counts || Object.keys(counts).length < MAX_KEYS ? key : 'other';
  counts[at] = (counts[at] ?? 0) + by;
};

export function addVisit(day: DayCounts, page: string, from: string | null) {
  day.arrivals += 1;
  bump(day.pages, page);
  bump(day.from, from ?? 'direct');
}

export function addRobot(day: DayCounts, page: string, why: RobotReason) {
  const robots = (day.robots ??= emptyRobots());
  robots.arrivals += 1;
  bump(robots.pages, page);
  bump(robots.why, why);
}

export function mergeDays(a: DayCounts, b: DayCounts): DayCounts {
  const out: DayCounts = { arrivals: a.arrivals + b.arrivals, pages: { ...a.pages }, from: { ...a.from } };
  for (const [k, v] of Object.entries(b.pages)) bump(out.pages, k, v);
  for (const [k, v] of Object.entries(b.from)) bump(out.from, k, v);
  if (a.robots || b.robots) {
    const ra = a.robots ?? emptyRobots();
    const rb = b.robots ?? emptyRobots();
    const robots: RobotCounts = { arrivals: ra.arrivals + rb.arrivals, pages: { ...ra.pages }, why: { ...ra.why } };
    for (const [k, v] of Object.entries(rb.pages)) bump(robots.pages, k, v);
    for (const [k, v] of Object.entries(rb.why)) bump(robots.why, k, v);
    out.robots = robots;
  }
  return out;
}

/** Robots, link previews, test tools and code libraries, by the name they give. */
const NOT_PEOPLE =
  /bot\b|bot\/|crawl|spider|slurp|archiver|preview|facebookexternalhit|whatsapp|telegram|discord|slack|embedly|lighthouse|headless|puppeteer|playwright|selenium|phantom|curl|wget|python|httpclient|axios|node-fetch|undici|^node$|go-http-client|java\/|okhttp|libwww|scrapy|zgrab|censys|masscan|nmap/i;

/**
 * Why a page load was set aside:
 * - `named`: it says it's a robot, a test tool or a code library, or gives no name at all.
 * - `no-fetch-metadata`: no Sec-Fetch-Mode. Every browser has sent it on page loads since 2023 (Chrome 76,
 *   Firefox 90, Safari 16.4); programs dressed up with a browser's name mostly don't. A phone stuck on an
 *   older system (an iPhone 7 on iOS 15) lands here too: a few people missed, against robots counted as crowds.
 * - `no-language`: no Accept-Language, which every browser sends with every page load.
 */
export type RobotReason = 'named' | 'no-fetch-metadata' | 'no-language';

/**
 * Who opened a page: `'person'`, a reason it was set aside as a robot, or null when it wasn't someone
 * opening a page at all (the app's own background fetches, an image, a frame, a prefetch or prerender a
 * browser made in case). Moving between pages inside the site happens in the background, so it isn't an
 * arrival: an arrival is someone coming to the site, or reloading.
 *
 * The fetch mode decides, not the destination: once a visitor has the site's offline service worker, it
 * passes each page load on itself, and Chrome sends those with destination "empty" but mode "navigate"
 * (measured on Nov 10, 2026). Going by the destination missed every page load after a first visit.
 *
 * Why the headers as well as the name: on the site's first day, 2,255 of the 2,721 arrivals then counted
 * landed on NBA game pages and all but 3 came from no other website, while the sitemap search engines read is
 * mostly player pages. Most likely programs giving a browser's name, which rarely send what a browser does.
 */
export function visitor(method: string, header: (name: string) => string | null): 'person' | RobotReason | null {
  if (method !== 'GET') return null;
  const mode = header('sec-fetch-mode');
  const dest = header('sec-fetch-dest');
  // "document" from the browser itself, "empty" when the service worker passes it on; never a frame.
  if (mode !== null && mode !== 'navigate') return null;
  if (dest !== null && dest !== 'document' && dest !== 'empty') return null;
  if (/prefetch|prerender/i.test(`${header('purpose') ?? ''} ${header('sec-purpose') ?? ''}`)) return null;
  const agent = header('user-agent') ?? '';
  // A headless Chrome renamed to look like a normal one still lists itself in its brands.
  if (!agent || NOT_PEOPLE.test(agent) || /headless/i.test(header('sec-ch-ua') ?? '')) return 'named';
  if (mode === null) return 'no-fetch-metadata';
  if (!header('accept-language')) return 'no-language';
  return 'person';
}

/** Whether a request is a person opening a page (see `visitor`). */
export const countable = (method: string, header: (name: string) => string | null) => visitor(method, header) === 'person';

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
