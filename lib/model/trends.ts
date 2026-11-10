import type { LeagueId } from '../leagues';
import type { Prediction } from './index';

/** Wins, losses and pushes against a line. */
export type Tally = { w: number; l: number; p: number };

export type TeamTrends = {
  /** Against the closing spread (puck line, run line), all games then the last ten. */
  ats: Tally;
  atsLast10: Tally;
  /** The game total against the closing over/under. */
  ou: Tally;
  ouLast10: Tally;
  /** As the favorite and as the underdog on the spread. */
  atsFavorite: Tally;
  atsUnderdog: Tally;
};

/** What the spread is called in each league. */
export const SPREAD_NAME: Record<LeagueId, string> = { nfl: 'Against the spread', nba: 'Against the spread', mlb: 'Run line', nhl: 'Puck line' };

const empty = (): Tally => ({ w: 0, l: 0, p: 0 });
const add = (t: Tally, result: number) => (result > 0 ? (t.w += 1) : result < 0 ? (t.l += 1) : (t.p += 1));

/**
 * A team's record against the closing lines in these games (finished ones
 * with a posted spread or total count), newest last ten separately. Books set
 * each line knowing all of this, so it describes the past, nothing more.
 */
export function teamTrends(predictions: Pick<Prediction, 'game' | 'market'>[], teamId: string): TeamTrends {
  const out: TeamTrends = { ats: empty(), atsLast10: empty(), ou: empty(), ouLast10: empty(), atsFavorite: empty(), atsUnderdog: empty() };
  const finished = predictions
    .filter((p) => p.game.completed && p.game.home.score !== null && p.game.away.score !== null && p.market && (p.game.home.teamId === teamId || p.game.away.teamId === teamId))
    .sort((a, b) => b.game.date.localeCompare(a.game.date));
  let atsSeen = 0;
  let ouSeen = 0;
  for (const p of finished) {
    const home = p.game.home.teamId === teamId;
    const us = (home ? p.game.home.score : p.game.away.score)!;
    const them = (home ? p.game.away.score : p.game.home.score)!;
    const spread = p.market!.homeSpread;
    if (spread !== null && spread !== undefined) {
      const ours = home ? spread : -spread;
      const result = us - them + ours;
      add(out.ats, result);
      if (atsSeen < 10) add(out.atsLast10, result);
      atsSeen += 1;
      if (ours < 0) add(out.atsFavorite, result);
      else if (ours > 0) add(out.atsUnderdog, result);
    }
    const total = p.market!.overUnder;
    if (total !== null && total !== undefined) {
      const result = us + them - total;
      add(out.ou, result);
      if (ouSeen < 10) add(out.ouLast10, result);
      ouSeen += 1;
    }
  }
  return out;
}

/**
 * Whether these records predict anything, on every graded game in the four
 * leagues (Nov 2026): when both teams had 10+ games against the spread that
 * season and records 10+ points apart, the better one covered 1,997 of 3,901
 * (51.2%, short of the 52.4% a −110 bet needs); when both teams' games had
 * leaned over or under, the next one followed the lean 365 of 760 (48.0%).
 */
export const TREND_CHECK = { games: 3901, covered: 1997, totals: 760, held: 365 };

/**
 * The season to show trends from: this one once a team has a few lined games
 * in it, otherwise last season (early on, a 2–1 record says even less).
 */
export function trendSeason(predictions: Pick<Prediction, 'game' | 'market'>[], teamIds: string[], seasonYear: number) {
  const lined = (year: number, teamId: string) =>
    predictions.filter((p) => p.game.seasonYear === year && p.game.completed && p.market?.homeSpread != null && (p.game.home.teamId === teamId || p.game.away.teamId === teamId)).length;
  return teamIds.every((t) => lined(seasonYear, t) >= 5) ? seasonYear : seasonYear - 1;
}

/** "6–4" or "6–4–1" with pushes. */
export const tallyText = (t: Tally) => `${t.w}–${t.l}${t.p ? `–${t.p}` : ''}`;
