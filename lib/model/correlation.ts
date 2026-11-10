// Same-game parlays: legs from one game move together. A player's points and
// his points + rebounds + assists rise and fall as one, and a big night for a
// scorer tends to come with his team winning. Each leg is decided by a hidden
// bell-curve score, and the scores of two legs in one game are correlated by
// how the legs relate (same player, teammates, opponents, a player and his
// team's result), fitted on past games: a Gaussian copula. Legs from different
// games stay independent. Safe to use in the browser.

import type { PropMarket } from '../props';

/** How one leg ties to the game, enough to pair it with the others. */
export type LegLink =
  | { kind: 'prop'; playerId: string; teamId: string; market: PropMarket; side: 'over' | 'under' }
  | { kind: 'win'; teamId: string };

/**
 * Correlations between the "over" scores of two props, keyed by the two
 * markets in alphabetical order ("pts|reb"), and between an over and the
 * player's own team winning, keyed by market. A pair the table doesn't list
 * counts as independent.
 */
export type CorrelationTable = {
  same: Record<string, number>;
  teammate: Record<string, number>;
  opponent: Record<string, number>;
  win: Record<string, number>;
  /** What the table was fitted on. */
  meta: { games: number; pairs: number; from: string; to: string };
};

export const marketPair = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

// --- Normal distribution ---------------------------------------------------

function erfc(x: number) {
  // Numerical Recipes' erfcc: fractional error below 1.2e-7 everywhere.
  const z = Math.abs(x);
  const t = 1 / (1 + 0.5 * z);
  const r =
    t *
    Math.exp(
      -z * z -
        1.26551223 +
        t * (1.00002368 + t * (0.37409196 + t * (0.09678418 + t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277))))))))
    );
  return x >= 0 ? r : 2 - r;
}

export const normalCdf = (x: number) => 0.5 * erfc(-x / Math.SQRT2);

const A = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
const B = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
const C = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
const D = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];

/** Inverse of the normal CDF (Acklam's approximation, relative error about 1e-9). */
export function normalQuantile(p: number) {
  const q = Math.min(1 - 1e-12, Math.max(1e-12, p));
  if (q < 0.02425 || q > 0.97575) {
    const t = Math.sqrt(-2 * Math.log(q < 0.5 ? q : 1 - q));
    const x = (((((C[0] * t + C[1]) * t + C[2]) * t + C[3]) * t + C[4]) * t + C[5]) / ((((D[0] * t + D[1]) * t + D[2]) * t + D[3]) * t + 1);
    return q < 0.5 ? x : -x;
  }
  const u = q - 0.5;
  const r = u * u;
  return ((((((A[0] * r + A[1]) * r + A[2]) * r + A[3]) * r + A[4]) * r + A[5]) * u) / (((((B[0] * r + B[1]) * r + B[2]) * r + B[3]) * r + B[4]) * r + 1);
}

// Gauss–Legendre nodes and weights (half of each symmetric set) for Genz's bivariate normal.
const GL6 = { w: [0.1713244923791705, 0.3607615730481384, 0.4679139345726904], x: [0.9324695142031522, 0.6612093864662647, 0.238619186083197] };
const GL12 = {
  w: [0.04717533638651177, 0.1069393259953183, 0.1600783285433464, 0.2031674267230659, 0.2334925365383547, 0.2491470458134029],
  x: [0.9815606342467191, 0.904117256370475, 0.769902674194305, 0.5873179542866171, 0.3678314989981802, 0.1252334085114692]
};
const GL20 = {
  w: [
    0.01761400713915212, 0.04060142980038694, 0.06267204833410906, 0.08327674157670475, 0.1019301198172404, 0.1181945319615184, 0.1316886384491766,
    0.1420961093183821, 0.1491729864726037, 0.1527533871307259
  ],
  x: [
    0.9931285991850949, 0.9639719272779138, 0.9122344282513259, 0.8391169718222188, 0.7463319064601508, 0.636053680726515, 0.5108670019508271,
    0.3737060887154196, 0.2277858511416451, 0.07652652113349733
  ]
};

/** P(X > h, Y > k) for standard normals with correlation r (Genz's port of Drezner and Wesolowsky). */
function bvnUpper(h: number, k: number, r: number) {
  if (r === 0) return normalCdf(-h) * normalCdf(-k);
  const tp = 2 * Math.PI;
  const { w, x } = Math.abs(r) < 0.3 ? GL6 : Math.abs(r) < 0.75 ? GL12 : GL20;
  let hk = h * k;
  let bvn = 0;
  if (Math.abs(r) < 0.925) {
    const hs = (h * h + k * k) / 2;
    const asr = Math.asin(r) / 2;
    for (let i = 0; i < w.length; i += 1) {
      for (const s of [-1, 1]) {
        const sn = Math.sin(asr * (1 + s * x[i]));
        bvn += w[i] * Math.exp((sn * hk - hs) / (1 - sn * sn));
      }
    }
    return Math.min(1, Math.max(0, (bvn * asr) / tp + normalCdf(-h) * normalCdf(-k)));
  }
  if (r < 0) {
    k = -k;
    hk = -hk;
  }
  if (Math.abs(r) < 1) {
    const as = 1 - r * r;
    let a = Math.sqrt(as);
    const bs = (h - k) ** 2;
    const c = (4 - hk) / 8;
    const d = (12 - hk) / 80;
    const asr = -(bs / as + hk) / 2;
    if (asr > -100) bvn = a * Math.exp(asr) * (1 - (c * (bs - as) * (1 - d * bs)) / 3 + c * d * as * as);
    if (hk > -100) {
      const b = Math.sqrt(bs);
      const sp = Math.sqrt(tp) * normalCdf(-b / a);
      bvn -= Math.exp(-hk / 2) * sp * b * (1 - (c * bs * (1 - d * bs)) / 3);
    }
    a /= 2;
    let sum = 0;
    for (let i = 0; i < w.length; i += 1) {
      for (const s of [-1, 1]) {
        const xs = (a * (1 + s * x[i])) ** 2;
        const asr2 = -(bs / xs + hk) / 2;
        if (asr2 <= -100) continue;
        const sp = 1 + c * xs * (1 + 5 * d * xs);
        const rs = Math.sqrt(1 - xs);
        const ep = Math.exp((-(hk / 2) * xs) / (1 + rs) ** 2) / rs;
        sum += w[i] * Math.exp(asr2) * (sp - ep);
      }
    }
    bvn = (a * sum - bvn) / tp;
  }
  if (r > 0) bvn += normalCdf(-Math.max(h, k));
  else if (h >= k) bvn = -bvn;
  else bvn = (h < 0 ? normalCdf(k) - normalCdf(h) : normalCdf(-h) - normalCdf(-k)) - bvn;
  return Math.min(1, Math.max(0, bvn));
}

/** P(X < a, Y < b) for standard normals with correlation r. */
export const bivariateCdf = (a: number, b: number, r: number) => bvnUpper(-a, -b, r);

/**
 * Lower Cholesky factor of a correlation matrix. A matrix pieced together from
 * pairwise numbers may not be a valid one; then the correlations are shrunk
 * toward zero until it is.
 */
function cholesky(R: number[][]): number[][] {
  const n = R.length;
  for (let scale = 1; scale > 0.01; scale *= 0.9) {
    const L = Array.from({ length: n }, () => new Array<number>(n).fill(0));
    let ok = true;
    for (let i = 0; i < n && ok; i += 1) {
      for (let j = 0; j <= i; j += 1) {
        let s = i === j ? 1 : R[i][j] * scale;
        for (let m = 0; m < j; m += 1) s -= L[i][m] * L[j][m];
        if (i === j) {
          if (s < 1e-6) ok = false;
          else L[i][i] = Math.sqrt(s);
        } else L[i][j] = s / L[j][j];
      }
    }
    if (ok) return L;
  }
  return R.map((row, i) => row.map((_, j) => (i === j ? 1 : 0)));
}

// Richtmyer lattice directions (square roots of primes) and fixed shifts, so the answer is the same every time.
const PRIMES = [2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47, 53, 59, 61, 67, 71, 73, 79, 83, 89, 97];
const SHIFTS = Array.from({ length: 8 }, (_, s) => PRIMES.map((p) => ((s + 1) * 0.6180339887498949 * Math.sqrt(p + 0.5)) % 1));

/**
 * P(Z_i < b_i for every i) for standard normals with correlation matrix R:
 * Genz's separation-of-variables method on a shifted lattice, with the most
 * restrictive limits first. Exact for one or two legs.
 */
export function multivariateCdf(b: number[], R: number[][], points = 512) {
  const n = b.length;
  if (n === 0) return 1;
  if (n === 1) return normalCdf(b[0]);
  if (n === 2) return bivariateCdf(b[0], b[1], R[0][1]);
  const order = b.map((_, i) => i).sort((i, j) => b[i] - b[j]);
  const lim = order.map((i) => b[i]);
  const L = cholesky(order.map((i) => order.map((j) => R[i][j])));
  const e0 = normalCdf(lim[0] / L[0][0]);
  const y = new Array<number>(n).fill(0);
  let total = 0;
  for (const shift of SHIFTS) {
    for (let k = 1; k <= points; k += 1) {
      for (const flip of [false, true]) {
        let e = e0;
        let f = e0;
        for (let i = 1; i < n && f > 0; i += 1) {
          let w = (k * Math.sqrt(PRIMES[(i - 1) % PRIMES.length]) + shift[(i - 1) % PRIMES.length]) % 1;
          if (flip) w = 1 - w;
          y[i - 1] = normalQuantile(w * e);
          let s = 0;
          for (let j = 0; j < i; j += 1) s += L[i][j] * y[j];
          e = normalCdf((lim[i] - s) / L[i][i]);
          f *= e;
        }
        total += f;
      }
    }
  }
  return Math.min(1, Math.max(0, total / (SHIFTS.length * points * 2)));
}

// --- Legs --------------------------------------------------------------------

const sideSign = (l: LegLink) => (l.kind === 'prop' && l.side === 'under' ? -1 : 1);

/** Correlation between two legs of one game, each read as "this leg hits". */
export function legCorrelation(a: LegLink, b: LegLink, table: CorrelationTable | undefined) {
  if (!table) return 0;
  // A parlay never holds both teams to win (picking one replaces the other), so two win legs don't meet.
  if (a.kind === 'win' && b.kind === 'win') return 0;
  if (a.kind === 'win' || b.kind === 'win') {
    const [win, prop] = (a.kind === 'win' ? [a, b] : [b, a]) as [Extract<LegLink, { kind: 'win' }>, Extract<LegLink, { kind: 'prop' }>];
    return (win.teamId === prop.teamId ? 1 : -1) * sideSign(prop) * (table.win[prop.market] ?? 0);
  }
  const relation = a.playerId === b.playerId ? 'same' : a.teamId === b.teamId ? 'teammate' : 'opponent';
  return sideSign(a) * sideSign(b) * (table[relation][marketPair(a.market, b.market)] ?? 0);
}

export type CorrelatedLeg = { league: string; gameId: string; prob: number; link?: LegLink | null };

const clampProb = (p: number) => Math.min(1 - 1e-6, Math.max(1e-6, p));

/** Chance every leg hits: legs of one game through their correlations, separate games independently. */
export function allHitChance(legs: CorrelatedLeg[], tables: Partial<Record<string, CorrelationTable>>) {
  const games = new Map<string, CorrelatedLeg[]>();
  for (const l of legs) games.set(`${l.league}:${l.gameId}`, [...(games.get(`${l.league}:${l.gameId}`) ?? []), l]);
  let chance = 1;
  for (const group of games.values()) {
    if (group.length === 1) {
      chance *= group[0].prob;
      continue;
    }
    const R = group.map((a, i) =>
      group.map((c, j) => (i === j ? 1 : a.link && c.link ? Math.max(-0.95, Math.min(0.95, legCorrelation(a.link, c.link, tables[a.league]))) : 0))
    );
    chance *= multivariateCdf(
      group.map((l) => normalQuantile(clampProb(l.prob))),
      R
    );
  }
  return chance;
}
