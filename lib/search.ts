// Matching for the search box, shared by the server (which builds the player
// list) and the browser (which filters it as you type).

import type { LeagueId } from './leagues';

/**
 * One player for search: where his page is, his current team, and how much
 * he's played in the last two months (minutes, ice time, or NFL throws,
 * carries and targets) as a percentile of his league, so regulars rank above
 * backups with the same name.
 */
export type PlayerHit = { league: LeagueId; id: string; name: string; team: string; usage: number };

/** Lowercase, accents off (Jokić finds Jokic), punctuation to spaces: what search compares. */
export function searchable(text: string) {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Where search loads the player list; the version changes with its shape, so a browser's cached copy of an older one isn't used. */
export const PLAYERS_URL = '/api/players?v=2';

export const queryTerms =(query: string) => searchable(query).split(' ').filter(Boolean);

/**
 * How well a name fits the query, 0 when it doesn't: every query word has to
 * start a word of the name (or of the extra words, like a team or league).
 * Whole words and words of the name itself count for more.
 */
export function nameScore(terms: string[], name: string, extra = '') {
  if (!terms.length) return 0;
  const own = searchable(name).split(' ');
  const more = searchable(extra).split(' ');
  let score = 0;
  for (const t of terms) {
    const word = own.find((w) => w === t) ?? own.find((w) => w.startsWith(t));
    if (word) score += word === t ? 3 : 2;
    else if (more.some((w) => w.startsWith(t))) score += 1;
    else return 0;
  }
  return score;
}

/** The players that fit a query, best first: closest name, then who's played the most lately. Needs two letters to start. */
export function findPlayers(players: PlayerHit[], query: string, limit = 8) {
  const terms = queryTerms(query);
  if (terms.join('').length < 2) return [];
  return players
    .map((p) => ({ p, score: nameScore(terms, p.name, `${p.team} ${p.league}`) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || (b.p.usage ?? 0) - (a.p.usage ?? 0) || a.p.name.localeCompare(b.p.name))
    .slice(0, limit)
    .map((x) => x.p);
}

type GameTeam = { abbr: string; name: string; shortName: string };
/** A game on the board, for search: who's playing and when. */
export type GameHit = { league: LeagueId; id: string; date: string; state: 'pre' | 'in' | 'post'; away: GameTeam; home: GameTeam };

/**
 * Games a query names: every word has to start a word of either team (city,
 * nickname or abbreviation) or be the league. Games naming both teams come
 * first, then the soonest.
 */
export function findGames(games: GameHit[], query: string, limit = 3) {
  const terms = queryTerms(query);
  if (terms.join('').length < 2) return [];
  const words = (t: GameTeam, league: string) => searchable(`${t.name} ${t.shortName} ${t.abbr} ${league}`).split(' ');
  return games
    .flatMap((g) => {
      const away = words(g.away, g.league);
      const home = words(g.home, g.league);
      let awayHits = 0;
      let homeHits = 0;
      for (const t of terms) {
        const inAway = away.some((w) => w.startsWith(t));
        const inHome = home.some((w) => w.startsWith(t));
        if (!inAway && !inHome) return [];
        if (inAway && !inHome) awayHits += 1;
        if (inHome && !inAway) homeHits += 1;
      }
      // A word both teams share (the league, "Los Angeles") names neither on its own.
      if (!awayHits && !homeHits) return [];
      return [{ g, both: awayHits > 0 && homeHits > 0 }];
    })
    .sort((a, b) => Number(b.both) - Number(a.both) || a.g.date.localeCompare(b.g.date))
    .slice(0, limit)
    .map((x) => x.g);
}

/** ESPN's headshot for a player, if it has one (the page falls back to initials when it doesn't). */
export const headshotUrl = (league: string, id: string) =>`https://a.espncdn.com/i/headshots/${league}/players/full/${id}.png`;

/** "LeBron James" → "LJ". */
export function initials(name: string) {
  const words = name.replace(/\b(Jr|Sr|II|III|IV)\.?$/i, '').trim().split(/\s+/);
  return ((words[0]?.[0] ?? '') + (words.length > 1 ? (words[words.length - 1][0] ?? '') : '')).toUpperCase();
}
