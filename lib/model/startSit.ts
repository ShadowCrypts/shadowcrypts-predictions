// Weekly start 'em, sit 'em, from the fantasy projections: where a player's projection this week sits against his
// own season average, for the players whose start is actually in question. Pure, so the same picks can be made
// for this week's board and, after the games, for last week's locked projections, and graded.
import { weekEnd, type FantasyPosition } from './fantasy';

/** One player as the picks read him: PPR points projected if he plays, the chance he plays, his season average so far. */
export type StartSitCandidate = { id: string; position: FantasyPosition; points: number; available: number; average: number | null; games: number; status?: string | null };

/**
 * Where a start is a real question, by his season-average rank at his position (a 12-team league starts 12 QBs,
 * about 24 backs, 30 receivers with flex, 12 tight ends). Studs above these bands start every week whatever we say;
 * those far below don't belong in a lineup. "Start" looks at fringe starters and the bench just past them; "sit"
 * at regular starters through the fringe.
 */
export const START_BANDS: Record<FantasyPosition, { start: [number, number]; sit: [number, number] }> = {
  QB: { start: [8, 26], sit: [6, 18] },
  RB: { start: [14, 45], sit: [10, 34] },
  WR: { start: [18, 55], sit: [12, 42] },
  TE: { start: [6, 22], sit: [5, 16] }
};

/** How far from his average counts: 2 points, or 15% of his average if that's more. */
export const meaningfulGap = (average: number) => Math.max(2, 0.15 * average);
/** His first three games leave too little to compare with (the fantasy backtest's own bar). */
export const MIN_GAMES = 3;
/** Players with a real doubt about playing go under injuries, not start or sit. */
export const PLAYS = 0.75;

export type StartSitPick = StartSitCandidate & { rank: number; gap: number };
export type StartSitPicks = Record<FantasyPosition, { start: StartSitPick[]; sit: StartSitPick[] }>;

/** The week's starts and sits by position, strongest first: `perPosition` of each at most. */
export function pickStartSit(candidates: StartSitCandidate[], perPosition = 5): StartSitPicks {
  const out = {} as StartSitPicks;
  for (const position of ['QB', 'RB', 'WR', 'TE'] as FantasyPosition[]) {
    const ranked = candidates
      .filter((c): c is StartSitCandidate & { average: number } => c.position === position && c.average !== null && c.games >= MIN_GAMES)
      .sort((a, b) => b.average - a.average || a.id.localeCompare(b.id))
      .map((c, i) => ({ ...c, rank: i + 1, gap: c.points - c.average }));
    const { start, sit } = START_BANDS[position];
    const inBand = (r: StartSitPick, [lo, hi]: [number, number]) => r.rank >= lo && r.rank <= hi && r.available >= PLAYS;
    out[position] = {
      // Nobody on the injury report is a start: telling someone to start a player who may not play isn't advice.
      start: ranked
        .filter((r) => inBand(r, start) && !r.status && r.gap >= meaningfulGap(r.average!))
        .sort((a, b) => b.gap - a.gap)
        .slice(0, perPosition),
      sit: ranked
        .filter((r) => inBand(r, sit) && r.gap <= -meaningfulGap(r.average!))
        .sort((a, b) => a.gap - b.gap)
        .slice(0, perPosition)
    };
  }
  return out;
}

export type StartSitGrade = { starts: number; startsBeat: number; sits: number; sitsShort: number; sat: number };

/**
 * How a week's calls did, against what they claimed: a start beats his season average, a sit falls short of it.
 * A start who didn't play counts as a miss (he scored nothing for you); a sit who didn't play isn't counted
 * either way, since falling short by not playing proves nothing about the call.
 */
export function gradeStartSit(picks: StartSitPicks, actual: (id: string) => number | null): StartSitGrade {
  const grade: StartSitGrade = { starts: 0, startsBeat: 0, sits: 0, sitsShort: 0, sat: 0 };
  for (const { start, sit } of Object.values(picks)) {
    for (const p of start) {
      const points = actual(p.id);
      grade.starts += 1;
      if (points === null) grade.sat += 1;
      else if (points > p.average!) grade.startsBeat += 1;
    }
    for (const p of sit) {
      const points = actual(p.id);
      if (points === null) continue;
      grade.sits += 1;
      if (points < p.average!) grade.sitsShort += 1;
    }
  }
  return grade;
}

/** The regular-season week number of a week (by the Tuesday it ends), counting the season's weeks from the first. */
export function nflWeekNumber(seasonGameDates: string[], end: string) {
  const weeks = [...new Set(seasonGameDates.map(weekEnd))].sort();
  const i = weeks.indexOf(end);
  return i >= 0 ? i + 1 : null;
}
