// Every page address the site serves, by shape, so the proxy can answer
// anything else with a real 404 page of its own before the app runs (turning
// away scanners probing for /wp-admin and the like for free). A test walks the
// app folder to keep this list in step with the pages.

import { LEAGUE_IDS } from './leagues';

/** Single-segment pages and metadata routes at the top level. */
const TOP = new Set(['live', 'props', 'record', 'results', 'plans', 'matchup', 'data', 'privacy', 'icon', 'apple-icon', 'opengraph-image', 'sitemap.xml']);
/** "/parlay/s/<code>" and "/picks/s/<code>", each with a preview image. */
const shared = (rest: string[]) => rest.length === 0 || (rest[0] === 's' && (rest.length === 2 || (rest.length === 3 && rest[2] === 'opengraph-image')));
const ID = /^\d{1,15}$/;

/** Every API address (app/api/.../route.ts; a test keeps this in step with the folder). */
const API = new Set([
  'calendar',
  'cards',
  'csp-report',
  'games',
  'graded',
  'graded-props',
  'health',
  'legs',
  'live',
  'players',
  'players/next',
  'predictions',
  'push/key',
  'push/unwatch',
  'push/watch',
  'rankings',
  'record',
  'sweat',
  'teams'
]);

/** Whether an /api/ path is one of the API's addresses; anything else gets a JSON 404 from the proxy, not the HTML not-found page. */
export const isKnownApi = (pathname: string) => API.has(pathname.replace(/^\/api\//, '').replace(/\/+$/, ''));

/** Whether a page path (no query string) is one the site could serve. Build output, dev tooling and the API are never refused here. */
export function isKnownPage(pathname: string) {
  const parts = pathname.split('/').filter(Boolean);
  if (!parts.length) return true;
  const [first, ...rest] = parts;
  if (first.startsWith('_next') || first.startsWith('__next') || first === 'api' || first === '.well-known') return true;
  if (TOP.has(first)) return rest.length === 0;
  if (first === 'brand-icon') return rest.length === 1;
  // The parlay builder and pick'em, and what's shared from each (with a preview image).
  if (first === 'parlay' || first === 'picks') return shared(rest);
  if (!(LEAGUE_IDS as string[]).includes(first)) return false;
  if (rest.length === 0) return true;
  // (Fantasy is football only; the page itself says so with a 404.)
  if (rest.length === 1) return rest[0] === 'players' || rest[0] === 'compare' || rest[0] === 'playoffs' || rest[0] === 'fantasy' || rest[0] === 'injuries' || rest[0] === 'standings';
  const [kind, id, extra] = rest;
  if ((kind !== 'game' && kind !== 'team' && kind !== 'player') || !ID.test(id)) return false;
  return rest.length === 2 || (rest.length === 3 && extra === 'opengraph-image');
}

