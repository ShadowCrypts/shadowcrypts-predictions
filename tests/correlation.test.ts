import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { allHitChance, bivariateCdf, CorrelationTable, legCorrelation, multivariateCdf, normalCdf, normalQuantile } from '../lib/model/correlation';

const close = (actual: number, expected: number, tolerance: number) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} is not within ${tolerance} of ${expected}`);

/** P(X < a, Y < b) by Simpson's rule over x, as an independent check. */
function bivariateByIntegration(a: number, b: number, r: number) {
  const n = 4000;
  const lo = -9;
  const h = (a - lo) / n;
  const f = (x: number) => (Math.exp(-x * x / 2) / Math.sqrt(2 * Math.PI)) * normalCdf((b - r * x) / Math.sqrt(1 - r * r));
  let sum = f(lo) + f(a);
  for (let i = 1; i < n; i += 1) sum += f(lo + i * h) * (i % 2 ? 4 : 2);
  return (sum * h) / 3;
}

const table: CorrelationTable = {
  same: { 'pra|pts': 0.8 },
  teammate: { 'pts|pts': -0.1 },
  opponent: {},
  win: { pts: 0.2 },
  meta: { games: 0, pairs: 0, from: '', to: '' }
};

describe('correlation math', () => {
  it('normal CDF and quantile agree with known values', () => {
    close(normalCdf(1.959964), 0.975, 1e-6);
    close(normalQuantile(0.975), 1.959964, 1e-5);
    for (const p of [0.001, 0.03, 0.2, 0.5, 0.77, 0.99]) close(normalCdf(normalQuantile(p)), p, 1e-6);
  });

  it('bivariate normal matches the closed form at the origin and integration elsewhere', () => {
    for (const r of [-0.95, -0.5, 0, 0.3, 0.6, 0.8, 0.93, 0.95]) close(bivariateCdf(0, 0, r), 0.25 + Math.asin(r) / (2 * Math.PI), 1e-6);
    for (const [a, b, r] of [
      [0.5, -0.3, 0.7],
      [0.5, -0.3, -0.96],
      [-1.2, 0.4, 0.97],
      [1.5, 1.1, -0.4],
      [-0.2, -0.9, 0.2]
    ]) {
      close(bivariateCdf(a, b, r), bivariateByIntegration(a, b, r), 2e-6);
    }
  });

  it('multivariate normal matches the closed form for three equally correlated legs', () => {
    for (const r of [0.2, 0.5, 0.8]) {
      const R = [
        [1, r, r],
        [r, 1, r],
        [r, r, 1]
      ];
      close(multivariateCdf([0, 0, 0], R), 1 / 8 + (3 * Math.asin(r)) / (4 * Math.PI), 2e-3);
    }
    const I = [0, 1, 2, 3].map((i) => [0, 1, 2, 3].map((j) => (i === j ? 1 : 0)));
    close(multivariateCdf([0.3, -0.2, 1, 0], I), normalCdf(0.3) * normalCdf(-0.2) * normalCdf(1) * 0.5, 1e-3);
  });

  it('signs correlations by side and by team', () => {
    const pts = { kind: 'prop', playerId: 'a', teamId: 'T', market: 'pts', side: 'over' } as const;
    close(legCorrelation(pts, { ...pts, market: 'pra' }, table), 0.8, 0);
    close(legCorrelation(pts, { ...pts, market: 'pra', side: 'under' }, table), -0.8, 0);
    close(legCorrelation(pts, { ...pts, playerId: 'b' }, table), -0.1, 0);
    close(legCorrelation(pts, { kind: 'win', teamId: 'T' }, table), 0.2, 0);
    close(legCorrelation(pts, { kind: 'win', teamId: 'U' }, table), -0.2, 0);
    close(legCorrelation(pts, { ...pts, market: 'reb' }, table), 0, 0);
  });

  it('raises the chance of legs that move together and leaves separate games independent', () => {
    const link = (market: 'pts' | 'pra', side: 'over' | 'under') => ({ kind: 'prop', playerId: 'a', teamId: 'T', market, side }) as const;
    const tables = { nba: table };
    const together = allHitChance(
      [
        { league: 'nba', gameId: '1', prob: 0.5, link: link('pts', 'over') },
        { league: 'nba', gameId: '1', prob: 0.5, link: link('pra', 'over') }
      ],
      tables
    );
    close(together, 0.25 + Math.asin(0.8) / (2 * Math.PI), 1e-6);
    const opposed = allHitChance(
      [
        { league: 'nba', gameId: '1', prob: 0.5, link: link('pts', 'over') },
        { league: 'nba', gameId: '1', prob: 0.5, link: link('pra', 'under') }
      ],
      tables
    );
    assert.ok(opposed < 0.25);
    const apart = allHitChance(
      [
        { league: 'nba', gameId: '1', prob: 0.6, link: link('pts', 'over') },
        { league: 'nba', gameId: '2', prob: 0.5, link: link('pra', 'over') },
        { league: 'nba', gameId: '3', prob: 0.4 }
      ],
      tables
    );
    close(apart, 0.6 * 0.5 * 0.4, 1e-6);
  });
});
