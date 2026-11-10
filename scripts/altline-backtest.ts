/**
 * Chances at any line: each player's main line and its chance read as a whole
 * distribution (the stat's usual spread around the mean that chance implies),
 * then checked at other lines on games the fit never saw, against what
 * happened and against the book's own prices where it posted alternate lines.
 * The spread is fitted per market as a multiple of the player model's own,
 * on the earlier half of games. Run through `npm run backtest -- --alt-lines`.
 */
import type { BoxScore, NflSkillBox } from '../lib/boxscores';
import type { Game, MarketOdds, TeamInfo } from '../lib/espn';
import type { LeagueConfig } from '../lib/leagues';
import { computeLeagueModel } from '../lib/model';
import { blendProbability } from '../lib/model/market';
import { propEngine, PropInputs } from '../lib/model/propEngines';
import { gradedLines, impliedMean, overAt, PropModelParams } from '../lib/model/propModel';
import { scoringPass } from '../lib/model/scoring';
import { getPropHistory } from '../lib/propFeed';
import { fairOver, isPriced, PropMarket } from '../lib/props';

/** One main line, the alternate lines it's checked at, and what happened. */
type Main = { date: string; market: PropMarket; line: number; p: number; actual: number; alts: { at: number; book: number | null }[] };

const SCALES = [0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1, 1.1, 1.2, 1.35, 1.5];

function random(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const logLoss = (p: number, y: boolean) => -Math.log(Math.min(1 - 1e-9, Math.max(1e-9, y ? p : 1 - p)));

/** Chances at every alternate line of these mains, with the spread scaled by `scale`. */
function predict(params: PropModelParams, mains: Main[], scale: (m: PropMarket) => number) {
  return mains.flatMap((m) => {
    const s = scale(m.market);
    const mean = impliedMean(params, m.market, m.line, m.p, s);
    return m.alts.map((a) => ({ market: m.market, p: overAt(params, m.market, mean, a.at, s), y: m.actual > a.at, book: a.book }));
  });
}

export async function altLineBacktest(
  league: LeagueConfig,
  data: {
    games: Game[];
    teams: TeamInfo[];
    closingOdds: Record<string, MarketOdds | null>;
    boxScores: Record<string, BoxScore | null>;
    skillBoxes: Record<string, NflSkillBox | null>;
  }
): Promise<Partial<Record<PropMarket, number>> | null> {
  const engine = propEngine(league);
  if (!engine) return null;
  const params = engine.params;
  const { model } = computeLeagueModel(league, data);
  const games = Object.values(model.predictions)
    .map((p) => p.game)
    .sort((a, b) => a.date.localeCompare(b.date));
  const teamPoints = new Map<string, { home: number; away: number }>();
  for (const g of games) {
    const p = model.predictions[g.id].projected;
    if (p) teamPoints.set(g.id, { home: p.home, away: p.away });
  }
  const inputs: PropInputs = {
    games,
    box: data.boxScores,
    skill: data.skillBoxes,
    context: { teamPoints, leaguePoints: scoringPass(games, league.scoring).averageBefore },
    live: { rosters: {}, injuries: {}, starters: new Map() }
  };
  const completed = games.filter((g) => g.completed);
  const props = await getPropHistory(league, completed, 0);
  const withProps = completed.filter((g) => props[g.id]?.length);
  const projections = engine.project(params, inputs, (g) => !!props[g.id]?.length && g.completed);
  const lines = gradedLines(params, withProps, projections, props, (id) => engine.actuals(id, inputs));
  const dateOf = new Map(games.map((g) => [g.id, g.date]));

  // Alternate lines to check each main line at: every one the book posted, plus up to four
  // others spread across the likely range (whole-number thresholds, as alternate lines are sold).
  const rand = random(5);
  const mains: Main[] = lines.map((l) => {
    const p = blendProbability(l.model, l.book, params.modelShare);
    const mean = impliedMean(params, l.line.market, l.line.line, p);
    const posted = (props[l.gameId] ?? [])
      .filter(isPriced)
      .filter((x) => x.athleteId === l.line.athleteId && x.market === l.line.market && x.line !== l.line.line && x.line !== l.actual)
      .map((x) => ({ at: x.line, book: fairOver(x) }));
    const candidates: number[] = [];
    for (let k = 0; k <= Math.ceil(l.line.line * 3 + 10); k += 1) {
      const at = k - 0.5;
      if (at === l.line.line || at < 0) continue;
      const chance = overAt(params, l.line.market, mean, at);
      if (chance > 0.04 && chance < 0.96) candidates.push(at);
    }
    const picked = new Set<number>();
    while (picked.size < Math.min(4, candidates.length)) picked.add(candidates[Math.floor(rand() * candidates.length)]);
    const alts = [...posted, ...[...picked].filter((at) => !posted.some((x) => x.at === at)).map((at) => ({ at, book: null }))];
    return { date: dateOf.get(l.gameId) ?? '', market: l.line.market, line: l.line.line, p, actual: l.actual, alts };
  });
  mains.sort((a, b) => a.date.localeCompare(b.date));
  if (mains.length < 500) {
    console.log(`  only ${mains.length} graded lines; skipped`);
    return null;
  }
  const half = Math.floor(mains.length / 2);
  const early = mains.slice(0, half);
  const late = mains.slice(half);

  /** Per market, the spread multiple with the lowest log loss on these mains' alternate lines. */
  const fitScales = (set: Main[]) => {
    const out: Partial<Record<PropMarket, number>> = {};
    for (const market of new Set(set.map((m) => m.market))) {
      const own = set.filter((m) => m.market === market);
      if (own.reduce((n, m) => n + m.alts.length, 0) < 400) continue;
      const loss = (s: number) => predict(params, own, () => s).reduce((sum, x) => sum + logLoss(x.p, x.y), 0);
      out[market] = SCALES.reduce((a, b) => (loss(b) < loss(a) ? b : a), 1);
    }
    return out;
  };
  const fitted = fitScales(early);
  console.log(`  ${early.length.toLocaleString()} main lines fitted (${early[0].date.slice(0, 10)} to ${early.at(-1)!.date.slice(0, 10)}), spread multiples: ${JSON.stringify(fitted)}`);

  const plain = predict(params, late, () => 1);
  const tuned = predict(params, late, (m) => fitted[m] ?? 1);
  const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / Math.max(1, xs.length);
  console.log(`  tested on ${late.length.toLocaleString()} later main lines, ${tuned.length.toLocaleString()} other lines; log loss with the model's spread → fitted spread:`);
  for (const market of [...new Set(late.map((m) => m.market))]) {
    const idx = tuned.map((x, i) => (x.market === market ? i : -1)).filter((i) => i >= 0);
    if (idx.length < 200) continue;
    console.log(
      `    ${market.padEnd(13)} n=${String(idx.length).padStart(6)}  ${mean(idx.map((i) => logLoss(plain[i].p, plain[i].y))).toFixed(4)} → ${mean(idx.map((i) => logLoss(tuned[i].p, tuned[i].y))).toFixed(4)}`
    );
  }
  // Calibration: do lines given 20% go over about 20% of the time?
  const bands = [0, 0.1, 0.25, 0.4, 0.6, 0.75, 0.9, 1];
  const rows: string[] = [];
  for (let b = 0; b < bands.length - 1; b += 1) {
    const xs = tuned.filter((x) => x.p >= bands[b] && x.p < bands[b + 1]);
    if (xs.length) rows.push(`${Math.round(bands[b] * 100)}–${Math.round(bands[b + 1] * 100)}%: said ${pct(mean(xs.map((x) => x.p)))}, went over ${pct(mean(xs.map((x) => +x.y)))} (n=${xs.length})`);
  }
  console.log(`    calibration: ${rows.join(' | ')}`);
  // Against the book's own alternate prices, where it posted them.
  const withBook = tuned.map((x, i) => ({ x, plain: plain[i] })).filter(({ x }) => x.book !== null);
  if (withBook.length >= 100) {
    console.log(
      `    lines the book also posted (n=${withBook.length}): book ${mean(withBook.map(({ x }) => logLoss(x.book!, x.y))).toFixed(4)}  ours ${mean(withBook.map(({ x }) => logLoss(x.p, x.y))).toFixed(4)}  (model's spread ${mean(withBook.map(({ plain }) => logLoss(plain.p, plain.y))).toFixed(4)}); average gap ${pct(mean(withBook.map(({ x }) => Math.abs(x.p - x.book!))))}`
    );
  }
  // Over lean: do main-line overs hit as often as the chance (margin split evenly) says? A
  // shift in log-odds fitted on the earlier half, checked on the later half.
  const logit = (p: number) => Math.log(p / (1 - p));
  const shifted = (p: number, d: number) => 1 / (1 + Math.exp(-(logit(Math.min(0.995, Math.max(0.005, p))) - d)));
  const mainLoss = (set: Main[], d: number) => mean(set.map((m) => logLoss(shifted(m.p, d), m.actual > m.line)));
  const leans = Array.from({ length: 31 }, (_, i) => (i - 15) / 100);
  const lean = leans.reduce((a, b) => (mainLoss(early, b) < mainLoss(early, a) ? b : a), 0);
  for (const [label, set] of [['earlier half', early], ['later half', late]] as const) {
    console.log(`  over lean, ${label}: main lines said ${pct(mean(set.map((m) => m.p)))} over, went over ${pct(mean(set.map((m) => +(m.actual > m.line))))} (n=${set.length})`);
  }
  console.log(
    `    shift fitted on the earlier half: ${lean.toFixed(2)} log-odds; later-half main-line log loss ${mainLoss(late, 0).toFixed(4)} → ${mainLoss(late, lean).toFixed(4)}; best shift on the later half alone ${leans.reduce((a, b) => (mainLoss(late, b) < mainLoss(late, a) ? b : a), 0).toFixed(2)}`
  );
  const shipped = fitScales(mains);
  console.log(`  for the site, fitted on all ${mains.length.toLocaleString()} main lines: ${JSON.stringify(shipped)}`);
  return shipped;
}
