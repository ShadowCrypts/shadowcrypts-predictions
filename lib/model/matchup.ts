import { winProbability } from './elo';
import { blendProbability } from './market';
import type { LeagueSheet } from './tape';

/** What the matchup machine needs per team: both ratings on the Elo scale, and the scoring model's. */
export type MatchupTeam = {
  id: string;
  abbr: string;
  name: string;
  shortName: string;
  logo: string | null;
  /** Team colors as ESPN lists them (drawn through lib/teamColor). */
  color?: string | null;
  altColor?: string | null;
  elo: number;
  market: number;
  offense: number;
  defense: number;
  venue: number;
};

export type MatchupLeague = {
  id: string;
  name: string;
  hfa: number;
  /** Elo's weight next to market-implied ratings, as in the pre-line forecast. */
  ratingsShare: number;
  /** Elo per point of spread (football, basketball); null where there's no spread. */
  eloPerPoint: number | null;
  /** Home pattern of a best-of-7 for the team with home advantage (1 = home); null where series aren't played. */
  series: number[] | null;
  /** League scoring average and margin per log-odds, for a projected score. */
  scoring: { average: number; marginPerLogit: number };
  teams: MatchupTeam[];
  /** Every team's numbers for the tale of the tape, the season they're from ("This season", "Last season (2025)"), and the score's name ("Points"). */
  tape: { sheet: LeagueSheet; when: string; unit: string };
};

export type Venue = 'a' | 'b' | 'neutral';

/** Chance team A beats team B, using the pre-line blend at full strength. */
export function matchupProbability(league: Pick<MatchupLeague, 'hfa' | 'ratingsShare'>, a: MatchupTeam, b: MatchupTeam, venue: Venue) {
  const edge = venue === 'a' ? league.hfa : venue === 'b' ? -league.hfa : 0;
  const elo = winProbability(a.elo - b.elo + edge);
  const market = winProbability(a.market - b.market + edge);
  return { probability: blendProbability(elo, market, league.ratingsShare), elo, market };
}

/**
 * Projected score for team A and team B: the total from the scoring model,
 * split by the margin the win probability implies, as on game pages before a
 * line is posted.
 */
export function matchupScore(league: Pick<MatchupLeague, 'scoring'>, a: MatchupTeam, b: MatchupTeam, venue: Venue, probability: number) {
  const { average, marginPerLogit } = league.scoring;
  // Home edge shifts points between the teams, not the total; the win probability already carries it.
  const park = venue === 'a' ? a.venue : venue === 'b' ? b.venue : 0;
  const total = 2 * average + park + a.offense + b.defense + b.offense + a.defense;
  const p = Math.min(0.99, Math.max(0.01, probability));
  const margin = marginPerLogit * Math.log(p / (1 - p));
  return { a: (total + margin) / 2, b: (total - margin) / 2 };
}

/** Chance of winning a best-of series given per-game chances at home and away and who hosts each game. */
export function seriesProbability(homeGame: number, awayGame: number, pattern: number[]) {
  const need = Math.ceil(pattern.length / 2);
  // dp[w][l]: chance of reaching w wins and l losses.
  let states = new Map<string, number>([['0,0', 1]]);
  let won = 0;
  for (let game = 0; game < pattern.length; game += 1) {
    const next = new Map<string, number>();
    for (const [key, chance] of states) {
      const [w, l] = key.split(',').map(Number);
      const p = pattern[game] === 1 ? homeGame : awayGame;
      const add = (k: string, v: number) => next.set(k, (next.get(k) ?? 0) + v);
      if (w + 1 === need) won += chance * p;
      else add(`${w + 1},${l}`, chance * p);
      if (l + 1 < need) add(`${w},${l + 1}`, chance * (1 - p));
    }
    states = next;
  }
  return won;
}
