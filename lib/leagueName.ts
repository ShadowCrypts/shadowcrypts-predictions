import type { LeagueId } from './leagues';

/** "NBA": a league's short name, for the browser, without shipping every league's model settings along with it. */
export const leagueName = (id: LeagueId) => id.toUpperCase();

/** Each league's sport, as structured data names it. */
export const SPORT: Record<LeagueId, string> = { nfl: 'American football', nba: 'Basketball', mlb: 'Baseball', nhl: 'Ice hockey' };
