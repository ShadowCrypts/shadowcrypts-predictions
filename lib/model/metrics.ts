export type Band = 'Strong' | 'Solid' | 'Lean' | 'Toss-up';

export const BANDS: { band: Band; min: number; description: string }[] = [
  { band: 'Strong', min: 0.7, description: '70%+ win probability' },
  { band: 'Solid', min: 0.62, description: '62–70%' },
  { band: 'Lean', min: 0.55, description: '55–62%' },
  { band: 'Toss-up', min: 0, description: 'Under 55%' }
];

export function bandFor(pickProb: number): Band {
  return BANDS.find((b) => pickProb >= b.min)!.band;
}

/** One graded prediction: the home-win probability before the game, and what happened. */
export type Outcome = { homeProb: number; homeWon: boolean };

export type Metrics = {
  games: number;
  correct: number;
  accuracy: number;
  /** Mean squared error of the home-win probability. 0.25 is a coin flip. */
  brier: number;
  logLoss: number;
  /** Accuracy of always picking the home team, for comparison. */
  homeBaseline: number;
};

export type BandRecord = { band: Band; description: string; games: number; correct: number; accuracy: number; avgProb: number };

export type CalibrationBucket = { lo: number; hi: number; games: number; predicted: number; actual: number };

const EMPTY: Metrics = { games: 0, correct: 0, accuracy: 0, brier: 0, logLoss: 0, homeBaseline: 0 };

export function summarize(outcomes: Outcome[]): Metrics {
  if (outcomes.length === 0) return EMPTY;
  let correct = 0;
  let brier = 0;
  let logLoss = 0;
  let homeWins = 0;
  for (const { homeProb, homeWon } of outcomes) {
    const y = homeWon ? 1 : 0;
    if ((homeProb >= 0.5) === homeWon) correct += 1;
    if (homeWon) homeWins += 1;
    brier += (homeProb - y) ** 2;
    const p = Math.min(1 - 1e-9, Math.max(1e-9, homeProb));
    logLoss -= y * Math.log(p) + (1 - y) * Math.log(1 - p);
  }
  const n = outcomes.length;
  return { games: n, correct, accuracy: correct / n, brier: brier / n, logLoss: logLoss / n, homeBaseline: homeWins / n };
}

function pickView({ homeProb, homeWon }: Outcome) {
  const pickHome = homeProb >= 0.5;
  return { prob: pickHome ? homeProb : 1 - homeProb, hit: pickHome === homeWon };
}

export function byBand(outcomes: Outcome[]): BandRecord[] {
  return BANDS.map(({ band, description }) => {
    const picks = outcomes.map(pickView).filter((p) => bandFor(p.prob) === band);
    const correct = picks.filter((p) => p.hit).length;
    return {
      band,
      description,
      games: picks.length,
      correct,
      accuracy: picks.length ? correct / picks.length : 0,
      avgProb: picks.length ? picks.reduce((s, p) => s + p.prob, 0) / picks.length : 0
    };
  });
}

/** Buckets picks by stated confidence; a calibrated model's hit rate tracks the bucket. */
export function calibration(outcomes: Outcome[], width = 0.05): CalibrationBucket[] {
  const buckets: CalibrationBucket[] = [];
  const steps = Math.round(0.5 / width);
  for (let i = 0; i < steps; i += 1) {
    const lo = 0.5 + i * width;
    const hi = i === steps - 1 ? 1 : 0.5 + (i + 1) * width;
    const picks = outcomes.map(pickView).filter((p) => p.prob >= lo && (p.prob < hi || hi === 1));
    if (picks.length === 0) continue;
    buckets.push({
      lo,
      hi,
      games: picks.length,
      predicted: picks.reduce((s, p) => s + p.prob, 0) / picks.length,
      actual: picks.filter((p) => p.hit).length / picks.length
    });
  }
  return buckets;
}
