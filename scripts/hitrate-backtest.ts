/**
 * Hit rates: how often a player cleared a line in his last few games, the
 * number prop tools lead with. For every graded main line, his record against
 * that same line over his previous games is checked against what happened
 * next and against the book's own chance: does a player who cleared it 8 of
 * his last 10 go over more often than the book says? A shift on the book's
 * log-odds per point of hit rate is fitted on the earlier half of lines and
 * checked on the later half. Run through `npm run backtest -- --hit-rates`.
 */
import type { BoxScore, NflSkillBox } from '../lib/boxscores';
import type { Game, MarketOdds, TeamInfo } from '../lib/espn';
import type { LeagueConfig } from '../lib/leagues';
import { computeLeagueModel } from '../lib/model';
import { hitRate } from '../lib/model/hitRate';
import { propEngine, PropInputs } from '../lib/model/propEngines';
import { gradedLines } from '../lib/model/propModel';
import { scoringPass } from '../lib/model/scoring';
import { getPropHistory } from '../lib/propFeed';
import type { PropMarket } from '../lib/props';

/** Games looked back over, and the fewest that count. */
const WINDOW = 10;
const MIN_GAMES = 5;

type Row = { date: string; market: PropMarket; book: number; rate: number; n: number; y: boolean };

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const logLoss = (p: number, y: boolean) => -Math.log(Math.min(1 - 1e-9, Math.max(1e-9, y ? p : 1 - p)));
const logit = (p: number) => Math.log(p / (1 - p));
const shifted = (p: number, d: number) => 1 / (1 + Math.exp(-(logit(Math.min(0.995, Math.max(0.005, p))) + d)));
const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / Math.max(1, xs.length);

export async function hitRateBacktest(
  league: LeagueConfig,
  data: {
    games: Game[];
    teams: TeamInfo[];
    closingOdds: Record<string, MarketOdds | null>;
    boxScores: Record<string, BoxScore | null>;
    skillBoxes: Record<string, NflSkillBox | null>;
  }
) {
  const engine = propEngine(league);
  if (!engine) return;
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

  // Each player's games in order, so "his last 10 before this one" is a slice.
  const order = new Map(completed.map((g, i) => [g.id, i]));
  const history = new Map<string, { at: number; stats: Partial<Record<PropMarket, number>> }[]>();
  for (const [i, g] of completed.entries()) {
    for (const [id, stats] of engine.actuals(g.id, inputs) ?? []) (history.get(id) ?? history.set(id, []).get(id)!).push({ at: i, stats });
  }
  const dateOf = new Map(games.map((g) => [g.id, g.date]));

  const rows: Row[] = [];
  for (const l of lines) {
    // A push is neither, at the book or here.
    if (l.actual === l.line.line) continue;
    const at = order.get(l.gameId);
    const past = at === undefined ? [] : (history.get(l.line.athleteId) ?? []).filter((h) => h.at < at);
    // Newest first, as the site counts them.
    const values = past
      .slice(-WINDOW * 2)
      .reverse()
      .map((h) => h.stats[l.line.market]);
    const rate = hitRate(values, l.line.line, WINDOW);
    if (!rate || rate.n < MIN_GAMES) continue;
    rows.push({ date: dateOf.get(l.gameId) ?? '', market: l.line.market, book: l.book, rate: rate.hits / rate.n, n: rate.n, y: l.actual > l.line.line });
  }
  rows.sort((a, b) => a.date.localeCompare(b.date));
  if (rows.length < 500) {
    console.log(`  only ${rows.length} lines with a hit rate; skipped`);
    return;
  }

  // Buckets: the book's chance against how often they really went over.
  console.log(`  ${rows.length.toLocaleString()} graded main lines with at least ${MIN_GAMES} earlier games (last ${WINDOW} counted):`);
  const buckets: [string, (r: number) => boolean][] = [
    ['cleared 0–30%', (r) => r <= 0.3],
    ['cleared 31–49%', (r) => r > 0.3 && r < 0.5],
    ['cleared 50–69%', (r) => r >= 0.5 && r < 0.7],
    ['cleared 70–79%', (r) => r >= 0.7 && r < 0.8],
    ['cleared 80%+', (r) => r >= 0.8]
  ];
  for (const [label, test] of buckets) {
    const xs = rows.filter((x) => test(x.rate));
    if (xs.length < 50) continue;
    console.log(
      `    ${label.padEnd(16)} n=${String(xs.length).padStart(6)}  book said ${pct(mean(xs.map((x) => x.book)))} over, went over ${pct(mean(xs.map((x) => +x.y)))}  (betting every over: ${pct(mean(xs.map((x) => (x.y ? 1 / x.book - 1 : -1))))} a bet at fair odds)`
    );
  }

  // Does the hit rate add anything to the book? A log-odds shift per unit of (rate − 0.5), fitted early, tested late.
  const half = Math.floor(rows.length / 2);
  const early = rows.slice(0, half);
  const late = rows.slice(half);
  const loss = (set: Row[], b: number) => mean(set.map((x) => logLoss(shifted(x.book, b * (x.rate - 0.5)), x.y)));
  const slopes = Array.from({ length: 41 }, (_, i) => (i - 20) / 20);
  const fitted = slopes.reduce((a, b) => (loss(early, b) < loss(early, a) ? b : a), 0);
  const lateBest = slopes.reduce((a, b) => (loss(late, b) < loss(late, a) ? b : a), 0);
  console.log(
    `  hit rate on top of the book: slope fitted on the earlier half ${fitted.toFixed(2)}; later-half log loss book alone ${loss(late, 0).toFixed(4)} → with hit rate ${loss(late, fitted).toFixed(4)} (best on the later half alone ${lateBest.toFixed(2)})`
  );
  // And the hit rate on its own, as a forecast (shrunk halfway to even so 10/10 isn't a certainty).
  console.log(`  hit rate alone as the chance (halfway to 50%): log loss ${mean(late.map((x) => logLoss(0.5 + (x.rate - 0.5) / 2, x.y))).toFixed(4)} vs the book ${loss(late, 0).toFixed(4)}`);
}
