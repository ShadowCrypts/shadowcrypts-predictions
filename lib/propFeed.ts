// Sportsbook player props from ESPN's odds feed: DraftKings now, ESPN BET for
// most of 2025. Finished games keep their lines, stored per league-month and
// filled incrementally like closing lines; upcoming games are re-read every few
// minutes.
import { cached, limiter, readStore, writeStore } from './cache';
import type { Game } from './espn';
import type { LeagueConfig } from './leagues';
import { BOOKS, parseProps, PropLine } from './props';

// Bump a league's version when its stored lines change so its months are re-read.
const VERSION: Record<string, string> = { nba: 'p3', nhl: 'p4', nfl: 'p3' };
const lane = limiter(4);

async function fetchJson(url: string): Promise<any | null> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const res = await lane(() => fetch(url, { cache: 'no-store', headers: { accept: 'application/json' }, signal: AbortSignal.timeout(30_000) }));
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`ESPN responded ${res.status}`);
      return await res.json();
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
    }
  }
  throw new Error(`Couldn't load ${url}`);
}

/** Every over/under prop for one game from the first book that has any; null when none does. */
async function fetchGameProps(league: LeagueConfig, gameId: string): Promise<PropLine[] | null> {
  const [sport, slug] = league.espnPath.split('/');
  for (const book of BOOKS) {
    const base = `https://sports.core.api.espn.com/v2/sports/${sport}/leagues/${slug}/events/${gameId}/competitions/${gameId}/odds/${book.id}/propBets?lang=en&region=us&limit=1000`;
    const first = await fetchJson(base);
    if (!first?.items?.length) continue;
    const items = [...first.items];
    for (let page = 2; page <= Math.min(first.pageCount ?? 1, 4); page += 1) items.push(...((await fetchJson(`${base}&page=${page}`))?.items ?? []));
    const lines = parseProps(items, book, league.id);
    if (lines.length) return lines;
  }
  return null;
}

/** Current props for a game that hasn't started, re-read every 10 minutes. */
export function getUpcomingProps(league: LeagueConfig, gameId: string) {
  return cached(`espn-${league.id}-props-live-${gameId}`, { ttlMs: 10 * 60_000, persist: true }, () => fetchGameProps(league, gameId));
}

/**
 * Props for finished games, stored per month like closing lines. `fetchUpTo`
 * caps how many missing games are fetched in this call; null means no book
 * had props for that game, a missing key means "not fetched yet".
 */
export async function getPropHistory(league: LeagueConfig, games: Game[], fetchUpTo = Infinity) {
  const byMonth = new Map<string, Game[]>();
  for (const g of games) {
    if (!g.completed) continue;
    const month = g.date.slice(0, 7).replace('-', '');
    byMonth.set(month, [...(byMonth.get(month) ?? []), g]);
  }
  const result: Record<string, PropLine[] | null> = {};
  let budget = fetchUpTo;
  for (const [month, monthGames] of [...byMonth].sort((a, b) => b[0].localeCompare(a[0]))) {
    const key = `espn-${VERSION[league.id] ?? 'p3'}-${league.id}-props-${month}`;
    const store = (await readStore<Record<string, PropLine[] | null>>(key)) ?? {};
    const missing = monthGames.filter((g) => !(g.id in store)).slice(0, Math.max(0, budget));
    if (missing.length) {
      budget -= missing.length;
      await Promise.all(
        missing.map(async (g) => {
          try {
            store[g.id] = await fetchGameProps(league, g.id);
          } catch {
            // Leave it unfetched; the next run retries.
          }
        })
      );
      await writeStore(key, store);
    }
    for (const g of monthGames) if (g.id in store) result[g.id] = store[g.id];
  }
  return result;
}
