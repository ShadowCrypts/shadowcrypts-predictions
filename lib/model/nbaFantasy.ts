// NBA fantasy points, from the same player projections behind the NBA props.
import type { NbaLine } from '../boxscores';
import type { PlayerProjection } from './propModel';

/** What NBA fantasy scoring reads, for a projection or a real game. */
export type NbaFantasyLine = { pts: number; reb: number; ast: number; stl: number; blk: number; tov: number };

/**
 * The NBA's own fantasy scoring, which FanDuel uses too: a point per point, 1.2 a rebound,
 * 1.5 an assist, 3 for a steal or a block, minus 1 for a turnover. Leagues that score
 * shooting or threes differently can still read the stat line.
 */
export function nbaFantasyPoints(line: NbaFantasyLine) {
  return line.pts + 1.2 * line.reb + 1.5 * line.ast + 3 * line.stl + 3 * line.blk - line.tov;
}

/** A player's projected line, if he plays. */
export function nbaProjectedLine(p: Pick<PlayerProjection, 'mean'>): NbaFantasyLine {
  const m = p.mean;
  return { pts: m.pts ?? 0, reb: m.reb ?? 0, ast: m.ast ?? 0, stl: m.stl ?? 0, blk: m.blk ?? 0, tov: m.tov ?? 0 };
}

/** What a player really did in a game. */
export function nbaActualLine(l: NbaLine): NbaFantasyLine {
  return { pts: l.pts, reb: l.oreb + l.dreb, ast: l.ast, stl: l.stl, blk: l.blk, tov: l.tov };
}

const EMPTY: NbaFantasyLine = { pts: 0, reb: 0, ast: 0, stl: 0, blk: 0, tov: 0 };

/** The average of several games' lines. */
export function averageNbaLine(lines: NbaFantasyLine[]): NbaFantasyLine | null {
  if (!lines.length) return null;
  const sum = lines.reduce((a, b) => ({ pts: a.pts + b.pts, reb: a.reb + b.reb, ast: a.ast + b.ast, stl: a.stl + b.stl, blk: a.blk + b.blk, tov: a.tov + b.tov }), EMPTY);
  const n = lines.length;
  return { pts: sum.pts / n, reb: sum.reb / n, ast: sum.ast / n, stl: sum.stl / n, blk: sum.blk / n, tov: sum.tov / n };
}

/**
 * Where real scores landed around the projection, as a share of it, by how big the
 * projection was: half of all scores fell inside these on every NBA night from 2023-24
 * (`npm run backtest -- --fantasy --league=nba`, Nov 2026). Bigger nights are steadier.
 */
const NBA_RANGES: [number, [number, number]][] = [
  [35, [0.82, 1.2]],
  [25, [0.77, 1.25]],
  [15, [0.68, 1.33]],
  [0, [0.53, 1.63]]
];
export function nbaFantasyRange(points: number): [number, number] {
  const [lo, hi] = NBA_RANGES.find(([low]) => points >= low)![1];
  return [points * lo, points * hi];
}

/**
 * Start or sit: on the same night, how often the player projected more outscored the
 * other, by how far apart they were. Every pair projected 15 or more from 2023-24 on,
 * same backtest; this season alone came out within 2 points at every gap. Both played.
 */
const NBA_START_SIT: [number, number][] = [
  [20, 0.94],
  [15, 0.87],
  [10, 0.8],
  [8, 0.73],
  [6, 0.69],
  [4, 0.64],
  [2, 0.58],
  [0, 0.53]
];
export function nbaStartSit(left: number, right: number) {
  const gap = Math.abs(left - right);
  return { favorite: left >= right ? ('left' as const) : ('right' as const), gap, chance: NBA_START_SIT.find(([low]) => gap >= low)![1] };
}

/**
 * How the projections did, same backtest, every player with five games in that season:
 * the order of a night's players (1 is perfect) and the average miss, against the
 * player's own season average. Seasons are labeled by the year they end.
 */
export const NBA_FANTASY_CHECK = [
  { season: '2023-24', order: 0.756, baseline: 0.72, miss: 7.57, baselineMiss: 8.03 },
  { season: '2024-25', order: 0.742, baseline: 0.705, miss: 7.54, baselineMiss: 8.03 },
  { season: '2025-26', order: 0.734, baseline: 0.694, miss: 7.49, baselineMiss: 7.97 },
  { season: '2026-27 so far', order: 0.699, baseline: 0.683, miss: 7.59, baselineMiss: 7.83 }
];

/** The usual fantasy groups: guards, forwards and centers, from the roster's position. */
export type NbaFantasyGroup = 'G' | 'F' | 'C';
export function nbaFantasyGroup(position: string | undefined): NbaFantasyGroup | null {
  if (!position) return null;
  const p = position.toUpperCase();
  if (p.startsWith('C')) return 'C';
  if (p.includes('G')) return 'G';
  if (p.includes('F')) return 'F';
  return null;
}
