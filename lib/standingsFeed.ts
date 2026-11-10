import { cached } from './cache';
import type { LeagueConfig } from './leagues';
import { parseStandings } from './standings';

/** ESPN's standings, by conference and division. Kept on disk, so a feed hiccup shows the last good copy. */
export function getStandings(league: LeagueConfig) {
  return cached(`espn-${league.id}-standings`, { ttlMs: 10 * 60_000, persist: true }, async () => {
    const res = await fetch(`https://site.api.espn.com/apis/v2/sports/${league.espnPath}/standings?level=3`, { cache: 'no-store', headers: { accept: 'application/json' }, signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`standings ${res.status}`);
    return parseStandings(league.id, await res.json());
  });
}
