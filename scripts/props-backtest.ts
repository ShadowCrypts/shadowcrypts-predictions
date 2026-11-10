/**
 * Player projections against what happened and against sportsbook prop lines,
 * for every league with a player model. Settings are tuned on the first graded
 * season only; later seasons are the holdout. Run through
 * `npm run backtest -- --props` (after `npm run warm` has the prop history).
 */
import type { BoxScore, NflSkillBox } from '../lib/boxscores';
import type { Game, MarketOdds, TeamInfo } from '../lib/espn';
import type { LeagueConfig } from '../lib/leagues';
import { computeLeagueModel } from '../lib/model';
import { blendProbability } from '../lib/model/market';
import { propEngine, PropInputs } from '../lib/model/propEngines';
import { Actuals, fitDispersion, GameProjection, GradedLine, gradedLines, overChance, PropModelParams } from '../lib/model/propModel';
import { scoringPass } from '../lib/model/scoring';
import { getPropHistory } from '../lib/propFeed';
import { fairOver, impliedFromAmerican, profitPerUnit, PropMarket } from '../lib/props';

const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : NaN);
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const logLoss = (xs: { p: number; y: boolean }[]) => mean(xs.map(({ p, y }) => -Math.log(Math.min(1 - 1e-9, Math.max(1e-9, y ? p : 1 - p)))));

type Sample = { gameId: string; seasonYear: number; playerId: string; projected: Partial<Record<PropMarket, number>>; actual: Partial<Record<PropMarket, number>> };

function samples(games: Game[], projections: Map<string, GameProjection>, actualsFor: (id: string) => Actuals | null) {
  const out: Sample[] = [];
  for (const g of games) {
    const proj = projections.get(g.id);
    const actuals = proj ? actualsFor(g.id) : null;
    if (!proj || !actuals) continue;
    for (const p of [...proj.home, ...proj.away]) {
      const actual = actuals.get(p.id);
      if (actual) out.push({ gameId: g.id, seasonYear: g.seasonYear, playerId: p.id, projected: p.mean, actual });
    }
  }
  return out;
}

/** Each player's season-to-date and last-10 averages per market before every game: the naive baselines. */
function baselines(games: Game[], actualsFor: (id: string) => Actuals | null) {
  const history = new Map<string, { season: number; values: Partial<Record<PropMarket, number>>[] }>();
  const result = new Map<string, { season: Partial<Record<PropMarket, number>>; last10: Partial<Record<PropMarket, number>> }>();
  const avg = (xs: Partial<Record<PropMarket, number>>[]) => {
    const out: Partial<Record<PropMarket, number>> = {};
    for (const m of new Set(xs.flatMap((x) => Object.keys(x) as PropMarket[]))) out[m] = mean(xs.map((x) => x[m] ?? 0));
    return out;
  };
  for (const g of games) {
    const actuals = g.completed ? actualsFor(g.id) : null;
    if (!actuals) continue;
    for (const [id, values] of actuals) {
      const h = history.get(id);
      const past = h && h.season === g.seasonYear ? h.values : [];
      if (past.length >= 3) result.set(`${g.id}|${id}`, { season: avg(past), last10: avg(past.slice(-10)) });
      past.push(values);
      history.set(id, { season: g.seasonYear, values: past });
    }
  }
  return result;
}

function bettingRow(label: string, xs: { model: number; over: number; under: number; won: (side: 'over' | 'under') => boolean }[], edge: number) {
  let n = 0;
  let won = 0;
  let profit = 0;
  for (const x of xs) {
    const overEdge = x.model - impliedFromAmerican(x.over);
    const underEdge = 1 - x.model - impliedFromAmerican(x.under);
    const side = overEdge > edge && overEdge >= underEdge ? 'over' : underEdge > edge ? 'under' : null;
    if (!side) continue;
    n += 1;
    if (x.won(side)) {
      won += 1;
      profit += profitPerUnit(side === 'over' ? x.over : x.under);
    } else profit -= 1;
  }
  return `      ${label} edge > ${pct(edge).padStart(5)}: ${n} bets, ${n ? pct(won / n) : '-'} won, return ${n ? pct(profit / n) : '-'} per bet`;
}

export async function propBacktest(
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
  const actualsFor = (id: string) => engine.actuals(id, inputs);
  const seasons = [...new Set(games.filter((g) => g.completed).map((g) => g.seasonYear))].sort();
  const tuneSeason = seasons[1];
  const isTune = (g: Game) => g.completed && g.seasonYear === tuneSeason;
  const isHoldout = (g: Game) => g.completed && g.seasonYear > tuneSeason;
  const tuneGames = games.filter(isTune);

  // 1. Settings, tuned on the tuning season by average miss relative to each market's size.
  const score = (params: PropModelParams) => {
    const s = samples(tuneGames, engine.project(params, inputs, isTune), actualsFor);
    return engine.tuneMarkets.reduce((sum, m) => {
      const pairs = s.filter((x) => x.projected[m] !== undefined && x.actual[m] !== undefined);
      return sum + mean(pairs.map((x) => Math.abs(x.projected[m]! - x.actual[m]!))) / Math.max(0.1, mean(pairs.map((x) => x.actual[m]!)));
    }, 0);
  };
  let best = { params: engine.params, loss: score(engine.params) };
  for (const stage of engine.stages) {
    for (const params of stage(best.params)) {
      const loss = score(params);
      if (loss < best.loss) best = { params, loss };
    }
  }
  const { dispersion: _unused, modelShare: _share, ...settings } = best.params as PropModelParams & Record<string, number>;
  console.log(`  tuned on ${tuneSeason}: ${JSON.stringify(settings)}`);

  // 2. Spread of outcomes per market, fitted on the tuning season.
  const all = engine.project(best.params, inputs, (g) => g.completed && g.seasonYear >= tuneSeason);
  const tune = samples(tuneGames, all, actualsFor);
  const dispersion: Partial<Record<PropMarket, [number, number]>> = {};
  for (const m of engine.markets) {
    const points = tune.filter((x) => x.projected[m] !== undefined && x.actual[m] !== undefined).map((x) => ({ mu: x.projected[m]!, sq: (x.actual[m]! - x.projected[m]!) ** 2 }));
    if (points.length >= 100) dispersion[m] = fitDispersion(points);
  }
  console.log(`  dispersion: ${JSON.stringify(dispersion)}`);
  const fitted = { ...best.params, dispersion: { ...best.params.dispersion, ...dispersion } };

  // 3. Holdout accuracy against the naive baselines.
  const holdout = samples(games.filter(isHoldout), all, actualsFor);
  const base = baselines(games, actualsFor);
  console.log(`  holdout average miss (players with 3+ earlier games this season):`);
  for (const m of engine.markets) {
    const xs = holdout.filter((x) => x.projected[m] !== undefined && x.actual[m] !== undefined && base.get(`${x.gameId}|${x.playerId}`)?.season[m] !== undefined);
    if (xs.length < 100) continue;
    const miss = (f: (x: Sample) => number) => mean(xs.map((x) => Math.abs(f(x) - x.actual[m]!))).toFixed(2);
    console.log(
      `    ${m.padEnd(13)} n=${String(xs.length).padStart(6)}  model ${miss((x) => x.projected[m]!)}  season avg ${miss((x) => base.get(`${x.gameId}|${x.playerId}`)!.season[m]!)}  last 10 ${miss((x) => base.get(`${x.gameId}|${x.playerId}`)!.last10[m] ?? 0)}`
    );
  }

  // 4. Against the sportsbooks: main lines, players who played.
  const props = await getPropHistory(league, games.filter((g) => g.completed), 0);
  const tuneLines = gradedLines(fitted, games.filter(isTune), all, props, actualsFor);
  const testLines = gradedLines(fitted, games.filter(isHoldout), all, props, actualsFor);
  // DraftKings doesn't label sides; check the over really is listed first in this league too.
  const dk = [...tuneLines, ...testLines].filter((g) => g.line.book === 'DraftKings');
  const favored = (g: GradedLine, side: 'over' | 'under') => (side === 'over' ? g.book > 0.54 : g.book < 0.46);
  const overRate = (xs: GradedLine[]) => pct(xs.filter((g) => g.actual > g.line.line).length / Math.max(1, xs.length));
  console.log(
    `  DraftKings side check: over favored → ${overRate(dk.filter((g) => favored(g, 'over')))} went over (n=${dk.filter((g) => favored(g, 'over')).length}); under favored → ${overRate(dk.filter((g) => favored(g, 'under')))} (n=${dk.filter((g) => favored(g, 'under')).length})`
  );
  const shares = Array.from({ length: 11 }, (_, i) => i / 10);
  const blendLoss = (w: number, xs: GradedLine[]) => logLoss(xs.map((x) => ({ p: blendProbability(x.model, x.book, w), y: x.actual > x.line.line })));
  const w = tuneLines.length >= 200 ? shares.reduce((a, b) => (blendLoss(b, tuneLines) < blendLoss(a, tuneLines) ? b : a), 0) : 0;
  console.log(`  prop lines: ${tuneLines.length} on the tuning season, ${testLines.length} on the holdout; model weight next to the book: ${w}${tuneLines.length < 200 ? ' (too few tuning lines to fit; follows the book)' : ''}`);
  for (const [label, xs] of [['tuning season', tuneLines], ['holdout', testLines]] as const) {
    if (!xs.length) continue;
    const y = (x: GradedLine) => x.actual > x.line.line;
    console.log(
      `    ${label}: log loss model ${logLoss(xs.map((x) => ({ p: x.model, y: y(x) }))).toFixed(4)}  book ${logLoss(xs.map((x) => ({ p: x.book, y: y(x) }))).toFixed(4)}  blend ${blendLoss(w, xs).toFixed(4)} | miss: projection ${mean(xs.map((x) => Math.abs(x.projected - x.actual))).toFixed(2)}  book line ${mean(xs.map((x) => Math.abs(x.line.line - x.actual))).toFixed(2)}`
    );
  }
  const closing = testLines.map((x) => ({ model: x.model, over: x.line.over, under: x.line.under, won: (side: 'over' | 'under') => (side === 'over' ? x.actual > x.line.line : x.actual < x.line.line) }));
  const opening = testLines
    .filter((x) => x.line.open && x.actual !== x.line.open.line)
    .map((x) => {
      const open = x.line.open!;
      return { model: overChance(fitted, x.line.market, x.projected, open.line), over: open.over, under: open.under, book: fairOver(open), actual: x.actual, line: open.line, won: (side: 'over' | 'under') => (side === 'over' ? x.actual > open.line : x.actual < open.line) };
    });
  if (closing.length) {
    console.log(`    betting the model's disagreements on the holdout:`);
    for (const edge of [0, 0.05, 0.1]) console.log(bettingRow('closing line,', closing, edge));
    if (opening.length) {
      console.log(
        `      opening lines (${opening.length}): log loss model ${logLoss(opening.map((o) => ({ p: o.model, y: o.actual > o.line }))).toFixed(4)}  book ${logLoss(opening.map((o) => ({ p: o.book, y: o.actual > o.line }))).toFixed(4)}`
      );
      for (const edge of [0.05, 0.1]) console.log(bettingRow('opening line,', opening, edge));
    }
  }
  // Where any edge comes from: the model's biggest disagreements, by market and side, on both seasons.
  for (const [label, xs] of [['tuning season', tuneLines], ['holdout', testLines]] as const) {
    const rows: string[] = [];
    for (const m of engine.markets) {
      for (const side of ['over', 'under'] as const) {
        let n = 0;
        let won = 0;
        let profit = 0;
        for (const x of xs.filter((g) => g.line.market === m)) {
          const edge = side === 'over' ? x.model - impliedFromAmerican(x.line.over) : 1 - x.model - impliedFromAmerican(x.line.under);
          if (edge <= 0.1) continue;
          const hit = side === 'over' ? x.actual > x.line.line : x.actual < x.line.line;
          n += 1;
          if (hit) {
            won += 1;
            profit += profitPerUnit(side === 'over' ? x.line.over : x.line.under);
          } else profit -= 1;
        }
        if (n >= 30) rows.push(`${m} ${side} ${n}: ${pct(won / n)} won, ${pct(profit / n)}`);
      }
    }
    console.log(`    edge > 10% by market, ${label}: ${rows.join(' | ') || 'none'}`);
  }
  const byMarket = engine.markets
    .map((m) => {
      const xs = testLines.filter((x) => x.line.market === m);
      const y = (x: GradedLine) => x.actual > x.line.line;
      return xs.length >= 30 ? `${m} ${xs.length}: model ${logLoss(xs.map((x) => ({ p: x.model, y: y(x) }))).toFixed(3)} book ${logLoss(xs.map((x) => ({ p: x.book, y: y(x) }))).toFixed(3)}` : null;
    })
    .filter(Boolean);
  console.log(`    by market (holdout log loss): ${byMarket.join(' | ')}`);
}
