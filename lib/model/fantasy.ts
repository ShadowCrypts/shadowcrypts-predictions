import type { BoxScore, NflSkillBox } from '../boxscores';
import type { CompareRow } from './compare';
import type { PlayerProjection } from './propModel';

/** What fantasy scoring reads, for a projection or a real game. `tds` are rushing and receiving touchdowns. */
export type FantasyLine = { passYds: number; passTd: number; passInt: number; rushYds: number; recYds: number; rec: number; tds: number };

export type FantasyScoring = 'ppr' | 'half' | 'standard';
const PER_CATCH: Record<FantasyScoring, number> = { ppr: 1, half: 0.5, standard: 0 };

/** The usual league's points: a point per 25 passing yards and 10 on the ground or through the air, 4 for a passing touchdown, 6 for any other, minus 2 for an interception. Lost fumbles and two-point tries aren't projected. */
export function fantasyPoints(line: FantasyLine, scoring: FantasyScoring = 'ppr') {
  return line.passYds * 0.04 + line.passTd * 4 - line.passInt * 2 + line.rushYds * 0.1 + line.recYds * 0.1 + line.rec * PER_CATCH[scoring] + line.tds * 6;
}

/** A player's projected line, if he plays. */
export function projectedLine(p: Pick<PlayerProjection, 'mean' | 'tds'>): FantasyLine {
  const m = p.mean;
  return { passYds: m.pass_yds ?? 0, passTd: m.pass_td ?? 0, passInt: m.pass_int ?? 0, rushYds: m.rush_yds ?? 0, recYds: m.rec_yds ?? 0, rec: m.rec ?? 0, tds: p.tds ?? 0 };
}

/** What each player really did in a game, for fantasy. */
export function actualLines(box: BoxScore | null | undefined, skill: NflSkillBox | null | undefined) {
  const lines = new Map<string, FantasyLine>();
  if (!skill) return lines;
  for (const team of Object.values(skill.teams)) {
    for (const l of team) lines.set(l.id, { passYds: 0, passTd: 0, passInt: 0, rushYds: l.rushYds, recYds: l.recYds, rec: l.rec, tds: l.rushTd + l.recTd });
  }
  if (box?.league === 'nfl') {
    for (const team of Object.values(box.teams)) {
      for (const p of team.passers) {
        const seen = lines.get(p.id) ?? { passYds: 0, passTd: 0, passInt: 0, rushYds: 0, recYds: 0, rec: 0, tds: 0 };
        lines.set(p.id, { ...seen, passYds: p.yds, passTd: p.td, passInt: p.int });
      }
    }
  }
  return lines;
}

export type FantasyPosition = 'QB' | 'RB' | 'WR' | 'TE';
export const FANTASY_POSITIONS: FantasyPosition[] = ['QB', 'RB', 'WR', 'TE'];
/** Positions that fill a flex spot. */
export const FLEX: FantasyPosition[] = ['RB', 'WR', 'TE'];
export const isFantasyPosition = (value: unknown): value is FantasyPosition => (FANTASY_POSITIONS as unknown[]).includes(value);

/**
 * The model runs high on the best backs and receivers: those projected 20 or more
 * scored about 19. A straight-line correction per position, fitted on PPR points for
 * seasons before 2026, which shrank the miss in 2026 too. Quarterbacks came out right
 * as they were, so they're left alone.
 */
const CORRECTION: Record<FantasyPosition, { a: number; b: number } | null> = { QB: null, RB: { a: 0.8, b: 0.84 }, WR: { a: 0.94, b: 0.84 }, TE: { a: 0.94, b: 0.84 } };

/** Projected points for a line, corrected. Other scoring formats take the same share of the correction as PPR. */
export function projectedPoints(line: FantasyLine, position: FantasyPosition, scoring: FantasyScoring = 'ppr') {
  const points = fantasyPoints(line, scoring);
  const fix = CORRECTION[position];
  const ppr = fantasyPoints(line);
  if (!fix || ppr <= 0) return points;
  return (points * Math.max(0, fix.a + fix.b * ppr)) / ppr;
}

/**
 * Start or sit: how often the player projected more outscored the other, by how far
 * apart they were in PPR. Every pair projected 5 or more in the same week from 2023,
 * same backtest; the 2026 season alone came out within about 3 points at every gap
 * but one (6 to 8: 72%). Both played, by construction.
 */
const START_SIT: [number, number][] = [
  [12, 0.89],
  [8, 0.83],
  [6, 0.77],
  [4, 0.7],
  [3, 0.65],
  [2, 0.61],
  [1, 0.57],
  [0, 0.52]
];

export function startSit(left: FantasyLine, leftPosition: FantasyPosition, right: FantasyLine, rightPosition: FantasyPosition) {
  const a = projectedPoints(left, leftPosition);
  const b = projectedPoints(right, rightPosition);
  const gap = Math.abs(a - b);
  return { favorite: a >= b ? ('left' as const) : ('right' as const), gap, chance: START_SIT.find(([low]) => gap >= low)![1] };
}

/**
 * Where real scores landed around the corrected projection, as a share of it, for
 * players projected 8 or more on every NFL week from 2023 (`npm run backtest -- --fantasy`,
 * Nov 2026). Half of all scores fell inside these; that's how noisy one game is.
 */
export const FANTASY_RANGE: Record<FantasyPosition, [number, number]> = { QB: [0.66, 1.28], RB: [0.59, 1.38], WR: [0.53, 1.4], TE: [0.53, 1.4] };

/**
 * How the projections did, same backtest: in each season the order within a week
 * (1 is perfect) and the average miss, against the player's own season average.
 * The correction was fitted before 2026, so 2026 is the clean test of the misses.
 */
export const FANTASY_CHECK = [
  { season: 2023, order: 0.501, baseline: 0.506, miss: 4.7, baselineMiss: 4.81 },
  { season: 2024, order: 0.521, baseline: 0.483, miss: 4.86, baselineMiss: 4.98 },
  { season: 2025, order: 0.471, baseline: 0.427, miss: 4.85, baselineMiss: 5.04 },
  { season: 2026, order: 0.496, baseline: 0.435, miss: 5.08, baselineMiss: 5.55 }
];

/** A roster's position as fantasy reads it, or the model's own read of his role when the roster has none. Anyone else isn't scored. */
export function fantasyPosition(rosterPosition: string | undefined, detail: string): FantasyPosition | null {
  const pos = rosterPosition === 'FB' ? 'RB' : rosterPosition;
  if (isFantasyPosition(pos)) return pos;
  if (pos) return null;
  return detail.startsWith('QB') ? 'QB' : detail.startsWith('RB') ? 'RB' : 'WR';
}

const addLines = (a: FantasyLine, b: FantasyLine): FantasyLine => ({
  passYds: a.passYds + b.passYds,
  passTd: a.passTd + b.passTd,
  passInt: a.passInt + b.passInt,
  rushYds: a.rushYds + b.rushYds,
  recYds: a.recYds + b.recYds,
  rec: a.rec + b.rec,
  tds: a.tds + b.tds
});
const EMPTY_LINE: FantasyLine = { passYds: 0, passTd: 0, passInt: 0, rushYds: 0, recYds: 0, rec: 0, tds: 0 };

/** The average of several games' lines. */
export function averageLine(lines: FantasyLine[]): FantasyLine | null {
  if (!lines.length) return null;
  const sum = lines.reduce(addLines, EMPTY_LINE);
  return { passYds: sum.passYds / lines.length, passTd: sum.passTd / lines.length, passInt: sum.passInt / lines.length, rushYds: sum.rushYds / lines.length, recYds: sum.recYds / lines.length, rec: sum.rec / lines.length, tds: sum.tds / lines.length };
}

/** The end of the NFL week a game falls in: the Tuesday morning after it. */
export function weekEnd(gameDate: string) {
  const d = new Date(gameDate);
  // Past midnight in New York a Monday night game is still Monday's, so count from five hours earlier.
  const et = new Date(d.getTime() - 5 * 3_600_000);
  const toTuesday = (9 - et.getUTCDay()) % 7 || 7;
  return new Date(Date.UTC(et.getUTCFullYear(), et.getUTCMonth(), et.getUTCDate() + toTuesday, 10)).toISOString();
}

/** What the comparison page's fantasy card shows of a player. */
export type FantasyCompareSide = { position: FantasyPosition; projected: FantasyLine; recent: FantasyLine | null; season: FantasyLine | null; games: number };

/** The two players' PPR points as comparison rows: this week, the last three, this season. */
export function fantasyCompareRows(left: FantasyCompareSide | null, right: FantasyCompareSide | null): CompareRow[] {
  const row = (id: string, label: string, pick: (s: FantasyCompareSide) => { value: number; note?: string } | null): CompareRow | null => {
    const l = left && pick(left);
    const r = right && pick(right);
    if (!l && !r) return null;
    const top = Math.max(l?.value ?? 0, r?.value ?? 0);
    const side = (v: typeof l) => (v ? { value: v.value.toFixed(1), note: v.note, bar: top > 0 ? v.value / top : 0 } : { value: '—', bar: 0 });
    return { id, label, left: side(l), right: side(r), edge: !l || !r || l.value === r.value ? null : l.value > r.value ? 'left' : 'right' };
  };
  const rows = [
    row('week', 'This week', (s) => {
      const half = projectedPoints(s.projected, s.position, 'half');
      const standard = projectedPoints(s.projected, s.position, 'standard');
      return { value: projectedPoints(s.projected, s.position), note: `Half ${half.toFixed(1)} · Std ${standard.toFixed(1)}` };
    }),
    row('last3', 'Last 3', (s) => (s.recent ? { value: fantasyPoints(s.recent), note: s.games < 3 ? `${s.games} ${s.games === 1 ? 'game' : 'games'}` : undefined } : null)),
    row('season', 'This season', (s) => (s.season ? { value: fantasyPoints(s.season), note: `${s.games} ${s.games === 1 ? 'game' : 'games'}` } : null))
  ];
  return rows.filter((r): r is CompareRow => r !== null);
}

/** Spearman's rank correlation: how well one list puts players in the order the other does. */
export function rankCorrelation(a: number[], b: number[]) {
  const ranks = (xs: number[]) => {
    const order = xs.map((x, i) => [x, i] as const).sort((p, q) => p[0] - q[0]);
    const out = new Array<number>(xs.length);
    for (let i = 0; i < order.length; ) {
      let j = i;
      while (j + 1 < order.length && order[j + 1][0] === order[i][0]) j += 1;
      for (let k = i; k <= j; k += 1) out[order[k][1]] = (i + j) / 2;
      i = j + 1;
    }
    return out;
  };
  const x = ranks(a);
  const y = ranks(b);
  const n = x.length;
  if (n < 2) return 0;
  const mean = (n - 1) / 2;
  let top = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i += 1) {
    top += (x[i] - mean) * (y[i] - mean);
    dx += (x[i] - mean) ** 2;
    dy += (y[i] - mean) ** 2;
  }
  return dx && dy ? top / Math.sqrt(dx * dy) : 0;
}
