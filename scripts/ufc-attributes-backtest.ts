/**
 * Can fighter details beat the UFC betting market? Age on fight night (from date of birth), height, reach,
 * stance, UFC experience and time since the last fight, as differences between the two fighters, added to the
 * market's own chance in a logistic model. Weights are fit on 2019–2022 fights with a line and tested on
 * 2023 onward against the market alone: the bar is the market, on fights the fit never saw.
 *
 *   npm run backtest:ufc-attributes     (the first run reads ~1,500 fighter profiles from ESPN into .cache/)
 */
import { limiter, readStore, writeStore } from '../lib/cache';
import { fetchJson } from '../lib/espn';
import { getUfcEvents, getUfcOdds, type UfcBout, type UfcOdds } from '../lib/ufc/feed';
import { noMargin } from '../lib/ufc/model';

const FIT_FROM = '2019-01-01';
const TEST_FROM = '2023-01-01';
const STORE = 'espn-ufc-athletes-v1';
const YEAR_MS = 365.25 * 86_400_000;

type Athlete = { dob: string | null; height: number | null; reach: number | null; stance: string | null };

const positive = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null);

/** Fighter profiles (date of birth, height, reach, stance), read once and kept. */
async function athletes(ids: string[]) {
  const store = (await readStore<Record<string, Athlete | null>>(STORE)) ?? {};
  const missing = ids.filter((id) => !(id in store));
  if (missing.length) console.log(`Reading ${missing.length} fighter profiles from ESPN...`);
  const lane = limiter(6);
  let done = 0;
  await Promise.all(
    missing.map(async (id) => {
      try {
        const b = await fetchJson(`https://sports.core.api.espn.com/v2/sports/mma/athletes/${id}`, lane);
        const stance = typeof b?.stance?.text === 'string' && /orthodox|southpaw|switch/i.test(b.stance.text) ? b.stance.text.toLowerCase() : null;
        store[id] = { dob: typeof b?.dateOfBirth === 'string' ? b.dateOfBirth : null, height: positive(b?.height), reach: positive(b?.reach), stance };
      } catch {
        // Left out; the next run tries again.
      }
      done += 1;
      if (done % 250 === 0) {
        await writeStore(STORE, store);
        console.log(`  ${done} of ${missing.length}`);
      }
    })
  );
  await writeStore(STORE, store);
  return store;
}

const logit = (p: number) => Math.log(p / (1 - p));
const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));
const clamp = (p: number) => Math.min(0.995, Math.max(0.005, p));
const loss = (p: number, y: number) => -(y * Math.log(clamp(p)) + (1 - y) * Math.log(1 - clamp(p)));

const FEATURES = ['market (logit)', 'age gap (5 yrs)', 'older than 35 (A − B)', 'reach gap (5 in)', 'height gap (5 in)', 'UFC fights gap (log)', 'layoff gap (years)', 'southpaw vs orthodox'] as const;

type Row = { date: string; x: number[]; y: number; market: number; ageGap: number | null };

/** Logistic regression by Newton's method, with a small ridge on every weight but the market's. */
function fit(rows: Row[], ridge = 2) {
  const k = FEATURES.length;
  let w = [1, ...Array(k - 1).fill(0)];
  for (let iter = 0; iter < 50; iter += 1) {
    const g = Array(k).fill(0);
    const h = Array.from({ length: k }, () => Array(k).fill(0));
    for (const r of rows) {
      const p = sigmoid(r.x.reduce((s, v, i) => s + v * w[i], 0));
      for (let i = 0; i < k; i += 1) {
        g[i] += (p - r.y) * r.x[i];
        for (let j = 0; j < k; j += 1) h[i][j] += p * (1 - p) * r.x[i] * r.x[j];
      }
    }
    for (let i = 1; i < k; i += 1) {
      g[i] += ridge * w[i];
      h[i][i] += ridge;
    }
    const step = solve(h, g);
    w = w.map((v, i) => v - step[i]);
    if (Math.max(...step.map(Math.abs)) < 1e-9) break;
  }
  return w;
}

/** Solves A x = b (Gaussian elimination with partial pivoting). */
function solve(a: number[][], b: number[]) {
  const n = b.length;
  const m = a.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c += 1) {
    let pivot = c;
    for (let r = c + 1; r < n; r += 1) if (Math.abs(m[r][c]) > Math.abs(m[pivot][c])) pivot = r;
    [m[c], m[pivot]] = [m[pivot], m[c]];
    for (let r = 0; r < n; r += 1) {
      if (r === c || m[c][c] === 0) continue;
      const f = m[r][c] / m[c][c];
      for (let j = c; j <= n; j += 1) m[r][j] -= f * m[c][j];
    }
  }
  return m.map((row, i) => (row[i] === 0 ? 0 : row[n] / row[i]));
}

async function main() {
  const events = await getUfcEvents();
  const bouts = events.flatMap((e) => e.bouts).sort((x, y) => x.date.localeCompare(y.date) || x.order - y.order);

  // Each fighter's UFC fights and last fight date before each bout (from the record, nothing after it).
  const history = new Map<string, { fights: number; last: string | null }>();
  const before = new Map<string, { a: { fights: number; last: string | null }; b: { fights: number; last: string | null } }>();
  for (const b of bouts) {
    const ha = history.get(b.a.id) ?? { fights: 0, last: null };
    const hb = history.get(b.b.id) ?? { fights: 0, last: null };
    before.set(b.id, { a: { ...ha }, b: { ...hb } });
    if (b.completed) {
      history.set(b.a.id, { fights: ha.fights + 1, last: b.date });
      history.set(b.b.id, { fights: hb.fights + 1, last: b.date });
    }
  }

  const decided = (b: UfcBout) => b.completed && (b.a.winner === true || b.b.winner === true);
  const graded = bouts.filter((b) => b.date >= FIT_FROM && decided(b));
  const odds = new Map<string, UfcOdds>();
  for (const e of events.filter((e) => e.date >= FIT_FROM && e.bouts.some((b) => b.completed))) {
    for (const [id, o] of Object.entries(await getUfcOdds(e, { left: Infinity }))) if (o) odds.set(id, o);
  }
  const lined = graded.filter((b) => odds.has(b.id));
  const people = await athletes([...new Set(lined.flatMap((b) => [b.a.id, b.b.id]))]);

  const ageOn = (id: string, date: string) => {
    const dob = people[id]?.dob;
    return dob ? (Date.parse(date) - Date.parse(dob)) / YEAR_MS : null;
  };
  const gap = (x: number | null | undefined, y: number | null | undefined, scale: number) => (x != null && y != null ? (x - y) / scale : 0);
  const layoff = (last: string | null, date: string) => (last ? Math.min(3, (Date.parse(date) - Date.parse(last)) / YEAR_MS) : 0);
  let complete = 0;
  const rows: Row[] = lined.map((b) => {
    const market = noMargin(odds.get(b.id)!);
    const A = people[b.a.id];
    const B = people[b.b.id];
    const ageA = ageOn(b.a.id, b.date);
    const ageB = ageOn(b.b.id, b.date);
    const h = before.get(b.id)!;
    const southpawEdge = A?.stance && B?.stance ? (A.stance === 'southpaw' && B.stance === 'orthodox' ? 1 : A.stance === 'orthodox' && B.stance === 'southpaw' ? -1 : 0) : 0;
    if (ageA !== null && ageB !== null && A?.reach && B?.reach && A?.height && B?.height) complete += 1;
    return {
      date: b.date,
      y: b.a.winner === true ? 1 : 0,
      market,
      ageGap: ageA !== null && ageB !== null ? ageA - ageB : null,
      x: [
        logit(clamp(market)),
        gap(ageA, ageB, 5),
        ageA !== null && ageB !== null ? Math.max(0, ageA - 35) / 5 - Math.max(0, ageB - 35) / 5 : 0,
        gap(A?.reach, B?.reach, 5),
        gap(A?.height, B?.height, 5),
        Math.log1p(h.a.fights) - Math.log1p(h.b.fights),
        layoff(h.a.last, b.date) - layoff(h.b.last, b.date),
        southpawEdge
      ]
    };
  });
  console.log(`\n${rows.length} fights with a line since 2019; ${complete} with age, height and reach for both fighters.\n`);

  // 1. Does the market misprice age? The older fighter's chance by the market against how often they won, in
  // each half on its own: a real lean shows in both.
  for (const [from, to, span] of [
    [FIT_FROM, '9999', '2019 on'],
    [FIT_FROM, TEST_FROM, '2019–2022'],
    [TEST_FROM, '9999', '2023 on']
  ] as const) {
    console.log(`The older fighter, by age gap (${span}):`);
    for (const [lo, hi, label] of [
      [0, 2, 'under 2 years'],
      [2, 5, '2–5 years'],
      [5, 8, '5–8 years'],
      [8, 99, '8+ years']
    ] as const) {
      const inGap = rows.filter((r) => r.date >= from && r.date < to && r.ageGap !== null && Math.abs(r.ageGap) >= lo && Math.abs(r.ageGap) < hi);
      const n = Math.max(1, inGap.length);
      const olderSaid = inGap.reduce((s, r) => s + (r.ageGap! > 0 ? r.market : 1 - r.market), 0) / n;
      const olderWon = inGap.filter((r) => (r.ageGap! > 0 ? r.y === 1 : r.y === 0)).length / n;
      const se = Math.sqrt((olderSaid * (1 - olderSaid)) / n);
      console.log(`  ${label.padEnd(14)} ${String(inGap.length).padStart(5)} fights: market gave the older fighter ${(olderSaid * 100).toFixed(1)}%, they won ${(olderWon * 100).toFixed(1)}% (±${(se * 100).toFixed(1)})`);
    }
  }

  // 2. The model, fit on 2019–2022 and tested on 2023 on.
  const train = rows.filter((r) => r.date < TEST_FROM);
  const test = rows.filter((r) => r.date >= TEST_FROM);
  const w = fit(train);
  console.log(`\nWeights fit on ${train.length} fights (2019–2022); positive helps fighter A:`);
  FEATURES.forEach((f, i) => console.log(`  ${f.padEnd(24)} ${w[i] >= 0 ? ' ' : ''}${w[i].toFixed(3)}`));

  const predict = (r: Row) => sigmoid(r.x.reduce((s, v, i) => s + v * w[i], 0));
  const report = (label: string, list: Row[]) => {
    const diffs = list.map((r) => loss(predict(r), r.y) - loss(r.market, r.y));
    const mean = diffs.reduce((s, d) => s + d, 0) / list.length;
    const sd = Math.sqrt(diffs.reduce((s, d) => s + (d - mean) ** 2, 0) / (list.length - 1));
    const right = (p: (r: Row) => number) => list.filter((r) => (p(r) >= 0.5) === (r.y === 1)).length / list.length;
    const lm = list.reduce((s, r) => s + loss(r.market, r.y), 0) / list.length;
    console.log(
      `  ${label.padEnd(10)} ${String(list.length).padStart(5)} fights · log loss ${(lm + mean).toFixed(4)} vs market ${lm.toFixed(4)} (${mean <= 0 ? 'better' : 'worse'} by ${Math.abs(mean).toFixed(4)} ± ${(sd / Math.sqrt(list.length)).toFixed(4)}) · right ${(right(predict) * 100).toFixed(1)}% vs ${(right((r) => r.market) * 100).toFixed(1)}%`
    );
  };
  console.log('\nTested on fights the fit never saw:');
  report('2023 on', test);
  for (const y of ['2023', '2024', '2025', '2026']) report(y, test.filter((r) => r.date.startsWith(y)));
  console.log('\nOn the years it was fit on (for comparison, not a test):');
  report('2019–22', train);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
