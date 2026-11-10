import type { Game } from '../espn';
import { fairOver, impliedFromAmerican, isPriced, mainLines, PricedLine, profitPerUnit, PropLine, PropMarket } from '../props';
import type { LivePropParams } from './liveProps';
import { blendProbability } from './market';
import { calibration, CalibrationBucket } from './metrics';

/** What every league's player model shares: its weight next to the book, and its spread of outcomes. */
export type PropModelParams = {
  /** The model's weight next to the sportsbook's over chance (logit blend); the book gets the rest. */
  modelShare: number;
  /** Spread of outcomes per market: variance = a × mean + b × mean². */
  dispersion: Partial<Record<PropMarket, [number, number]>>;
  /** For chances at other lines, the spread around the mean a posted line implies, as a multiple of `dispersion`. */
  lineSpread?: Partial<Record<PropMarket, number>>;
  /** Live chances mid-game (leagues whose play-by-play could be rebuilt to fit them). */
  live?: LivePropParams;
};

export type PlayerProjection = {
  id: string;
  name: string;
  teamId: string;
  /** Short context for the table: "34 min", "Starting G", "WR · 7.1 targets". */
  detail: string;
  /** Shown even without a book line (a regular, not a deep reserve). */
  featured: boolean;
  /** Chance of playing at all (1 when the box score or injury report says he's available). */
  available: number;
  /** Expected value per market, if he plays. */
  mean: Partial<Record<PropMarket, number>>;
  /** NFL: expected rushing and receiving touchdowns, for fantasy scoring (books' touchdown lines are yes-or-no, so it isn't a market). */
  tds?: number;
};

export type GameProjection = { home: PlayerProjection[]; away: PlayerProjection[]; source: 'box score' | 'injury report' };

/** What each player actually did, per market. */
export type Actuals = Map<string, Partial<Record<PropMarket, number>>>;

export function marketVariance(params: Pick<PropModelParams, 'dispersion'>, market: PropMarket, mean: number) {
  const [a, b] = params.dispersion[market] ?? [1.5, 0.05];
  return Math.max(mean * 1.0001, a * mean + b * mean * mean);
}

/**
 * Chances of finishing over, under, or exactly on a line, with the stat as a
 * negative binomial: counts like these are lumpier than a bell curve, and the
 * spread grows with the mean.
 */
export function lineChances(mean: number, variance: number, line: number) {
  const mu = Math.max(mean, 0.01);
  const r = (mu * mu) / Math.max(variance - mu, 1e-6);
  const p = r / (r + mu);
  const floor = Math.floor(line);
  let pmf = Math.exp(r * Math.log(p));
  let cdf = 0;
  for (let k = 0; k <= floor; k += 1) {
    if (k > 0) pmf *= ((k - 1 + r) / k) * (1 - p);
    cdf += pmf;
  }
  // pmf now holds P(X = floor). Whole-number lines can push.
  const push = Number.isInteger(line) ? pmf : 0;
  const under = Math.min(1, cdf - push);
  return { over: Math.max(0, 1 - cdf), under: Math.max(0, under), push };
}

/** Chance of the over, ignoring pushes (a push returns the stake). */
export function overChance(params: Pick<PropModelParams, 'dispersion'>, market: PropMarket, mean: number, line: number) {
  const { over, under } = lineChances(mean, marketVariance(params, market, mean), line);
  return over + under > 0 ? over / (over + under) : 0.5;
}

/**
 * A line and its over chance read as a whole distribution: the mean at which
 * the over at `line` has chance `p`, with the market's spread of outcomes
 * times `scale`. From it, the chance at any other line.
 */
export function impliedMean(params: Pick<PropModelParams, 'dispersion'>, market: PropMarket, line: number, p: number, scale = 1) {
  const target = Math.min(0.99, Math.max(0.01, p));
  const over = (mean: number) => {
    const { over, under } = lineChances(mean, Math.max(mean * 1.0001, marketVariance(params, market, mean) * scale), line);
    return over + under > 0 ? over / (over + under) : 0.5;
  };
  let lo = 0.01;
  let hi = Math.max(1, line * 4 + 10);
  for (let k = 0; k < 50; k += 1) {
    const mid = (lo + hi) / 2;
    if (over(mid) < target) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Chance of finishing over `line` from a mean read off another line (pushes left out). */
export function overAt(params: Pick<PropModelParams, 'dispersion'>, market: PropMarket, mean: number, line: number, scale = 1) {
  const { over, under } = lineChances(mean, Math.max(mean * 1.0001, marketVariance(params, market, mean) * scale), line);
  return over + under > 0 ? over / (over + under) : 0.5;
}

/** Over chances at any line for a player's stat, read off his main line and its chance. */
export function chanceAt(params: Pick<PropModelParams, 'dispersion' | 'lineSpread'>, market: PropMarket, mainLine: number, p: number) {
  const scale = params.lineSpread?.[market] ?? 1;
  const mean = impliedMean(params, market, mainLine, p, scale);
  return (line: number) => (line === mainLine ? p : overAt(params, market, mean, line, scale));
}

/**
 * Whole-number thresholds worth showing ("25+" is the over at 24.5), between
 * very likely and very unlikely, at a round step so there are at most `max`.
 */
export function ladder(chance: (line: number) => number, mainLine: number, max = 8) {
  const ks: number[] = [];
  for (let k = 1; k <= Math.ceil(mainLine * 3 + 12); k += 1) {
    const p = chance(k - 0.5);
    if (p < 0.03) break;
    if (p < 0.97) ks.push(k);
  }
  if (!ks.length) return [];
  const step = [1, 2, 5, 10, 25, 50].find((s) => Math.floor(ks.at(-1)! / s) - Math.ceil(ks[0] / s) + 1 <= max) ?? 100;
  return ks.filter((k) => k % step === 0);
}

/** The forecast for an over: the book's chance with its margin removed, nudged by the model's weight. */
export function propForecast(params: PropModelParams, market: PropMarket, mean: number, line: PropLine) {
  return blendProbability(overChance(params, market, mean, line.line), fairOver(line), params.modelShare);
}

/**
 * Player projections against sportsbook props, every graded game with lines:
 * main lines only, players who played (books void the rest), pushes left out.
 */
export type PropRecord = {
  lines: number;
  games: number;
  /** Log loss of the over/under call: lower is better, 0.693 is a coin flip. */
  logLoss: { model: number; book: number; forecast: number };
  /** Average miss against the real stat: our projection, and the book's line read as an estimate. */
  miss: { projection: number; line: number };
  /** Betting the side the model liked by 10 points or more over the price, at the closing price. */
  betting: { bets: number; won: number; returnPerBet: number };
  /** The site's chances as shown (the side it favored), in bands, against how often that side came in. Pushes left out. */
  calibration?: CalibrationBucket[];
};

/** How far the model's chance must beat the price's own (margin included) to count as a disagreement. */
export const BET_EDGE = 0.1;

/** The side the model likes against the price, if it beats it by BET_EDGE or more; none without prices. */
export function modelEdge(model: number, line: Pick<PropLine, 'over' | 'under'>): { side: 'over' | 'under'; edge: number } | null {
  if (line.over === null || line.under === null) return null;
  const over = model - impliedFromAmerican(line.over);
  const under = 1 - model - impliedFromAmerican(line.under);
  if (over >= BET_EDGE && over >= under) return { side: 'over', edge: over };
  if (under >= BET_EDGE) return { side: 'under', edge: under };
  return null;
}

const logLoss = (p: number, y: boolean) => -Math.log(Math.min(1 - 1e-9, Math.max(1e-9, y ? p : 1 - p)));

/** One graded line: what the model, the book and the result said. */
export type GradedLine = { gameId: string; line: PricedLine; projected: number; actual: number; model: number; book: number };

/** Every priced main line in these games with a projection and a result. */
export function gradedLines(
  params: PropModelParams,
  games: Game[],
  projections: Map<string, GameProjection>,
  history: Record<string, PropLine[] | null>,
  actualsFor: (gameId: string) => Actuals | null
): GradedLine[] {
  const out: GradedLine[] = [];
  for (const game of games) {
    const lines = history[game.id];
    const proj = projections.get(game.id);
    const actuals = lines && proj ? actualsFor(game.id) : null;
    if (!lines || !proj || !actuals) continue;
    const byId = new Map([...proj.home, ...proj.away].map((p) => [p.id, p]));
    for (const line of mainLines(lines.filter(isPriced)) as PricedLine[]) {
      const projected = byId.get(line.athleteId)?.mean[line.market];
      const actual = actuals.get(line.athleteId)?.[line.market];
      if (projected === undefined || actual === undefined || actual === line.line) continue;
      out.push({ gameId: game.id, line, projected, actual, model: overChance(params, line.market, projected, line.line), book: fairOver(line) });
    }
  }
  return out;
}

export function gradeProps(params: PropModelParams, graded: GradedLine[]): PropRecord {
  const totals = { model: 0, book: 0, forecast: 0, projection: 0, line: 0, bets: 0, won: 0, profit: 0 };
  for (const g of graded) {
    const over = g.actual > g.line.line;
    totals.model += logLoss(g.model, over);
    totals.book += logLoss(g.book, over);
    totals.forecast += logLoss(blendProbability(g.model, g.book, params.modelShare), over);
    totals.projection += Math.abs(g.projected - g.actual);
    totals.line += Math.abs(g.line.line - g.actual);
    const side = modelEdge(g.model, g.line)?.side;
    if (side) {
      totals.bets += 1;
      if (side === 'over' ? over : !over) {
        totals.won += 1;
        totals.profit += profitPerUnit(side === 'over' ? g.line.over : g.line.under);
      } else totals.profit -= 1;
    }
  }
  const n = Math.max(1, graded.length);
  return {
    lines: graded.length,
    games: new Set(graded.map((g) => g.gameId)).size,
    logLoss: { model: totals.model / n, book: totals.book / n, forecast: totals.forecast / n },
    miss: { projection: totals.projection / n, line: totals.line / n },
    betting: { bets: totals.bets, won: totals.won, returnPerBet: totals.bets ? totals.profit / totals.bets : 0 },
    calibration: calibration(
      graded.filter((g) => g.actual !== g.line.line).map((g) => ({ homeProb: blendProbability(g.model, g.book, params.modelShare), homeWon: g.actual > g.line.line }))
    )
  };
}

/** Least-squares fit of variance = a × mean + b × mean² to squared misses. */
export function fitDispersion(points: { mu: number; sq: number }[]): [number, number] {
  let s11 = 0;
  let s12 = 0;
  let s22 = 0;
  let t1 = 0;
  let t2 = 0;
  for (const { mu, sq } of points) {
    const x2 = mu * mu;
    s11 += mu * mu;
    s12 += mu * x2;
    s22 += x2 * x2;
    t1 += mu * sq;
    t2 += x2 * sq;
  }
  const det = s11 * s22 - s12 * s12;
  if (!det) return [1.5, 0.05];
  const a = (t1 * s22 - t2 * s12) / det;
  const b = (s11 * t2 - s12 * t1) / det;
  return [Number(Math.max(1, a).toFixed(3)), Number(Math.max(0, b).toFixed(4))];
}
