/**
 * Picks and tests the UFC fighter ratings: parameters chosen on 2001–2018 fights only, then graded on 2019
 * onward against what happened and against the betting market (lines from 2019 on, closing prices once a
 * fight is over). Also fits how much of the published forecast comes from the ratings versus the market,
 * on 2019–2022, and tests that on 2023 onward. Nothing chosen ever sees the years it's graded on.
 *
 *   npm run backtest:ufc            (the first run reads ~4,000 betting lines; later runs are quick)
 */
import { blendProbability, impliedProbability } from '../lib/model/market';
import { summarize, type Outcome } from '../lib/model/metrics';
import { rateFights, UFC_ELO, type UfcEloParams } from '../lib/ufc/elo';
import { getUfcEvents, getUfcOdds, type UfcBout, type UfcOdds } from '../lib/ufc/feed';

const TRAIN_END = '2019-01-01';
const BLEND_END = '2023-01-01';
const ODDS_FROM = '2019-01-01';

const fmt = (m: ReturnType<typeof summarize>) => `${m.games} fights · ${(m.accuracy * 100).toFixed(1)}% right · Brier ${m.brier.toFixed(4)} · log loss ${m.logLoss.toFixed(4)}`;
const noVig = (o: UfcOdds) => {
  const a = impliedProbability(o.aMoneyline);
  const b = impliedProbability(o.bMoneyline);
  return a / (a + b);
};
const decided = (b: UfcBout) => b.a.winner === true || b.b.winner === true;

async function main() {
  const events = await getUfcEvents();
  const bouts = events.flatMap((e) => e.bouts);
  const done = bouts.filter((b) => b.completed);
  console.log(`${events.length} events, ${bouts.length} fights (${done.length} finished, ${done.filter(decided).length} with a winner), ${events[0]?.date.slice(0, 4)}–${events[events.length - 1]?.date.slice(0, 4)}\n`);

  // How fights ended, to check the "5:00 of the last round is a decision" reading.
  const ends = new Map<string, number>();
  for (const b of done) {
    const key = b.round === b.rounds ? `last round ${b.clock}` : 'earlier round';
    ends.set(key, (ends.get(key) ?? 0) + 1);
  }
  console.log('How finished fights stopped (top 5):', [...ends].sort((x, y) => y[1] - x[1]).slice(0, 5).map(([k, v]) => `${k}: ${v}`).join(' · '), '\n');

  // Betting lines, read once and kept.
  const budget = { left: Infinity };
  const odds = new Map<string, UfcOdds>();
  for (const e of events.filter((e) => e.date >= ODDS_FROM && e.bouts.some((b) => b.completed))) {
    const lines = await getUfcOdds(e, budget);
    for (const [id, o] of Object.entries(lines)) if (o) odds.set(id, o);
  }
  console.log(`Betting lines on ${odds.size} of ${done.filter((b) => b.date >= ODDS_FROM).length} fights since 2019\n`);

  const grade = (params: UfcEloParams, from: string, to: string) => {
    const { rated } = rateFights(bouts, params);
    const outcomes: Outcome[] = [];
    for (const b of done) {
      if (b.date < from || b.date >= to || !decided(b)) continue;
      const r = rated.get(b.id);
      if (r) outcomes.push({ homeProb: r.chanceA, homeWon: b.a.winner === true });
    }
    return summarize(outcomes);
  };

  // 1. Parameters, on training years only.
  let best = { params: UFC_ELO, logLoss: Infinity };
  for (const k of [24, 32, 48, 64, 80])
    for (const newK of [0, 16, 32, 64])
      for (const newFights of [2, 3, 5])
        for (const debut of [1250, 1300, 1350, 1400, 1450])
          for (const finishBonus of [0, 0.2, 0.4]) {
            const params = { k, newK, newFights, debut, finishBonus };
            const m = grade(params, '2006-01-01', TRAIN_END);
            if (m.logLoss < best.logLoss) best = { params, logLoss: m.logLoss };
          }
  console.log('Best on 2006–2018:', JSON.stringify(best.params), `(in the site: ${JSON.stringify(UFC_ELO)})\n`);
  const params = UFC_ELO;
  console.log('Training years, 2006–2018:', fmt(grade(params, '2006-01-01', TRAIN_END)));
  console.log('Held-out years, 2019 on:  ', fmt(grade(params, TRAIN_END, '9999')));
  const favoriteBaseline = done.filter((b) => b.date >= TRAIN_END && decided(b)).length;
  console.log(`  (${favoriteBaseline} decided fights in the held-out years)\n`);

  // 2. Ratings against the market, on fights with a line.
  const { rated } = rateFights(bouts, params);
  const rows = done
    .filter((b) => b.date >= ODDS_FROM && decided(b) && odds.has(b.id) && rated.has(b.id))
    .map((b) => ({ b, model: rated.get(b.id)!.chanceA, market: noVig(odds.get(b.id)!), aWon: b.a.winner === true }));
  const on = (pick: (r: (typeof rows)[number]) => number, from: string, to: string) =>
    summarize(rows.filter((r) => r.b.date >= from && r.b.date < to).map((r) => ({ homeProb: pick(r), homeWon: r.aWon })));
  console.log('Fights with a line, 2019 on:');
  console.log('  Ratings alone: ', fmt(on((r) => r.model, ODDS_FROM, '9999')));
  console.log('  Market alone:  ', fmt(on((r) => r.market, ODDS_FROM, '9999')));

  // 3. How much of the published forecast the ratings get: fit on 2019–2022, tested on 2023 on.
  let share = { value: 0, logLoss: Infinity };
  for (let s = 0; s <= 1.0001; s += 0.05) {
    const m = on((r) => blendProbability(r.model, r.market, s), ODDS_FROM, BLEND_END);
    if (m.logLoss < share.logLoss) share = { value: Math.round(s * 100) / 100, logLoss: m.logLoss };
  }
  console.log(`\nBest ratings share on 2019–2022: ${share.value}`);
  for (const s of [0, share.value]) {
    console.log(`  2023 on, ratings share ${s}:`, fmt(on((r) => blendProbability(r.model, r.market, s), BLEND_END, '9999')));
  }
  console.log('  2023 on, ratings alone:      ', fmt(on((r) => r.model, BLEND_END, '9999')));
  console.log('  2023 on, market alone:       ', fmt(on((r) => r.market, BLEND_END, '9999')));

  // 4. Favorites winning more than their price says (the favorite–longshot bias): stretch the market's chance
  // in logit space by a factor fit on 2019–2022, tested on 2023 on.
  const logit = (p: number) => Math.log(p / (1 - p));
  const stretch = (p: number, s: number) => 1 / (1 + Math.exp(-s * logit(Math.min(0.995, Math.max(0.005, p)))));
  let fit = { s: 1, logLoss: Infinity };
  for (let s = 0.9; s <= 1.5001; s += 0.02) {
    const m = on((r) => stretch(r.market, s), ODDS_FROM, BLEND_END);
    if (m.logLoss < fit.logLoss) fit = { s: Math.round(s * 100) / 100, logLoss: m.logLoss };
  }
  console.log(`\nMarket stretched by ${fit.s} (fit on 2019–2022):`);
  console.log('  2023 on, stretched:', fmt(on((r) => stretch(r.market, fit.s), BLEND_END, '9999')));
  console.log('  2023 on, as priced:', fmt(on((r) => r.market, BLEND_END, '9999')));
  for (const [from, to] of [['2023-01-01', '2024-01-01'], ['2024-01-01', '2025-01-01'], ['2025-01-01', '9999']]) {
    const a = on((r) => stretch(r.market, fit.s), from, to);
    const b = on((r) => r.market, from, to);
    console.log(`  ${from.slice(0, 4)}: stretched log loss ${a.logLoss.toFixed(4)} vs ${b.logLoss.toFixed(4)} (${a.games} fights)`);
  }

  // 5. Does the market's chance hold up? The favorite's chance, in bands, against how often favorites won.
  console.log('\nThe market favorite, by its chance (2019 on):');
  for (const [lo, hi] of [[0.5, 0.6], [0.6, 0.7], [0.7, 0.8], [0.8, 0.9], [0.9, 1.01]]) {
    const inBand = rows.map((r) => ({ fav: Math.max(r.market, 1 - r.market), won: r.market >= 0.5 ? r.aWon : !r.aWon })).filter((r) => r.fav >= lo && r.fav < hi);
    const avg = inBand.reduce((s, r) => s + r.fav, 0) / Math.max(1, inBand.length);
    console.log(`  ${Math.round(lo * 100)}–${Math.min(100, Math.round(hi * 100))}%: ${inBand.length} fights, said ${(avg * 100).toFixed(1)}%, won ${((inBand.filter((r) => r.won).length / Math.max(1, inBand.length)) * 100).toFixed(1)}%`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
