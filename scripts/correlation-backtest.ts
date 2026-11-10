/**
 * Same-game parlays: how the props of one game (and its result) move together.
 * Fits the correlations on the earlier half of the games with graded prop
 * lines, then checks on the later half whether parlay chances computed with
 * them beat treating the legs as independent. Run through
 * `npm run backtest -- --correlations`; add `--write` to save the table
 * fitted on every graded game to lib/model/correlationTable.ts.
 */
import type { BoxScore, NflSkillBox } from '../lib/boxscores';
import type { Game, MarketOdds, TeamInfo } from '../lib/espn';
import type { LeagueConfig } from '../lib/leagues';
import { computeLeagueModel } from '../lib/model';
import { allHitChance, bivariateCdf, CorrelatedLeg, CorrelationTable, LegLink, marketPair, normalQuantile } from '../lib/model/correlation';
import { blendProbability, marketView } from '../lib/model/market';
import { propEngine, PropInputs } from '../lib/model/propEngines';
import { gradedLines } from '../lib/model/propModel';
import { scoringPass } from '../lib/model/scoring';
import { getPropHistory } from '../lib/propFeed';
import type { PropMarket } from '../lib/props';

type PropLeg = { playerId: string; teamId: string; market: PropMarket; p: number; y: boolean; c: number };
type WinLeg = { p: number; y: boolean; c: number };
type GameLegs = { gameId: string; date: string; props: PropLeg[]; wins: Map<string, WinLeg> | null };

/** Seeded random numbers (mulberry32), so every run samples the same parlays. */
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

/** Every graded main line of every game, each with its chance as the site shows it, plus each team's chance to win. */
async function gameLegs(league: LeagueConfig, data: Parameters<typeof computeLeagueModel>[1] & { skillBoxes: Record<string, NflSkillBox | null> }) {
  const engine = propEngine(league)!;
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
    box: data.boxScores ?? {},
    skill: data.skillBoxes,
    context: { teamPoints, leaguePoints: scoringPass(games, league.scoring).averageBefore },
    live: { rosters: {}, injuries: {}, starters: new Map() }
  };
  const completed = games.filter((g) => g.completed);
  const props = await getPropHistory(league, completed, 0);
  const withProps = completed.filter((g) => props[g.id]?.length);
  const projections = engine.project(engine.params, inputs, (g) => !!props[g.id]?.length && g.completed);
  const lines = gradedLines(engine.params, withProps, projections, props, (id) => engine.actuals(id, inputs));
  const byGame = new Map<string, GameLegs>();
  const gameOf = new Map(games.map((g) => [g.id, g]));
  for (const l of lines) {
    const game = gameOf.get(l.gameId)!;
    let entry = byGame.get(l.gameId);
    if (!entry) {
      const view = marketView(data.closingOdds?.[l.gameId] ?? null, league);
      const decided = game.home.score !== null && game.away.score !== null && game.home.score !== game.away.score;
      const homeWon = decided && game.home.score! > game.away.score!;
      entry = {
        gameId: l.gameId,
        date: game.date,
        props: [],
        wins:
          view && decided
            ? new Map([
                [game.home.teamId, { p: view.homeProb, y: homeWon, c: normalQuantile(view.homeProb) }],
                [game.away.teamId, { p: 1 - view.homeProb, y: !homeWon, c: normalQuantile(1 - view.homeProb) }]
              ])
            : null
      };
      byGame.set(l.gameId, entry);
    }
    const proj = projections.get(l.gameId)!;
    const teamId = [...proj.home, ...proj.away].find((p) => p.id === l.line.athleteId)?.teamId;
    if (!teamId) continue;
    const p = blendProbability(l.model, l.book, engine.params.modelShare);
    entry.props.push({ playerId: l.line.athleteId, teamId, market: l.line.market, p, y: l.actual > l.line.line, c: normalQuantile(p) });
  }
  return [...byGame.values()].filter((g) => g.props.length >= 2).sort((a, b) => a.date.localeCompare(b.date));
}

/** Up to `cap` pairs per kind of pair, sampled evenly, and how many there were in all. */
class Reservoir {
  seen = 0;
  size = 0;
  a: Float64Array;
  b: Float64Array;
  /** (y1 − p1)(y2 − p2): how far the pair's joint result ran from independence. */
  cross: Float64Array;
  /** p1 × p2: the chance both hit if independent. */
  both: Float64Array;
  constructor(
    private cap: number,
    private rand: () => number
  ) {
    this.a = new Float64Array(cap);
    this.b = new Float64Array(cap);
    this.cross = new Float64Array(cap);
    this.both = new Float64Array(cap);
  }
  add(a: number, b: number, cross: number, both: number) {
    const i = this.size < this.cap ? this.size++ : Math.floor(this.rand() * (this.seen + 1));
    this.seen += 1;
    if (i >= this.cap) return;
    this.a[i] = a;
    this.b[i] = b;
    this.cross[i] = cross;
    this.both[i] = both;
  }
  /**
   * The correlation that makes the expected co-movement match what happened:
   * Σ [P(both | r) − p1 p2] = Σ (y1 − p1)(y2 − p2), solved by bisection.
   * Matching the cross term rather than the both-hit count keeps a small
   * miscalibration of either leg from leaking into the correlation.
   */
  solve() {
    let target = 0;
    for (let i = 0; i < this.size; i += 1) target += this.cross[i];
    const excess = (r: number) => {
      let s = 0;
      for (let i = 0; i < this.size; i += 1) s += bivariateCdf(this.a[i], this.b[i], r) - this.both[i];
      return s - target;
    };
    let lo = -0.95;
    let hi = 0.95;
    if (excess(lo) >= 0) hi = lo;
    else if (excess(hi) <= 0) lo = hi;
    for (let k = 0; k < 14 && hi > lo; k += 1) {
      const mid = (lo + hi) / 2;
      if (excess(mid) < 0) lo = mid;
      else hi = mid;
    }
    const r = (lo + hi) / 2;
    // Standard error: the spread of the co-movement over how fast the expected value moves with r.
    const mean = target / Math.max(1, this.size);
    let spread = 0;
    let slope = 0;
    for (let i = 0; i < this.size; i += 1) {
      spread += (this.cross[i] - mean) ** 2;
      const [a, b] = [this.a[i], this.b[i]];
      slope += Math.exp(-(a * a - 2 * r * a * b + b * b) / (2 * (1 - r * r))) / (2 * Math.PI * Math.sqrt(1 - r * r));
    }
    return { r, se: slope > 0 ? Math.sqrt(spread) / slope : Infinity };
  }
}

/**
 * Typical size of a real correlation, for pulling noisy estimates toward
 * independence: each is multiplied by PRIOR² / (PRIOR² + SE²). The standard
 * error is inflated because pairs from one game aren't independent.
 */
const PRIOR = 0.3;
const SE_INFLATION = 1.5;

function fitTable(games: GameLegs[], cap = 20000): CorrelationTable {
  const rand = random(7);
  const cells = new Map<string, Reservoir>();
  const add = (key: string, a: number, b: number, cross: number, both: number) => {
    let cell = cells.get(key);
    if (!cell) cells.set(key, (cell = new Reservoir(cap, rand)));
    cell.add(a, b, cross, both);
  };
  let pairs = 0;
  for (const g of games) {
    for (let i = 0; i < g.props.length; i += 1) {
      const x = g.props[i];
      const own = g.wins?.get(x.teamId);
      if (own) add(`win:${x.market}`, x.c, own.c, (+x.y - x.p) * (+own.y - own.p), x.p * own.p);
      for (let j = i + 1; j < g.props.length; j += 1) {
        const z = g.props[j];
        const relation = x.playerId === z.playerId ? 'same' : x.teamId === z.teamId ? 'teammate' : 'opponent';
        add(`${relation}:${marketPair(x.market, z.market)}`, x.c, z.c, (+x.y - x.p) * (+z.y - z.p), x.p * z.p);
        pairs += 1;
      }
    }
  }
  const table: CorrelationTable = {
    same: {},
    teammate: {},
    opponent: {},
    win: {},
    meta: { games: games.length, pairs, from: games[0]?.date.slice(0, 10) ?? '', to: games.at(-1)?.date.slice(0, 10) ?? '' }
  };
  for (const [key, cell] of [...cells].sort((a, b) => a[0].localeCompare(b[0]))) {
    const fit = cell.solve();
    const se = fit.se * SE_INFLATION;
    const r = (fit.r * PRIOR ** 2) / (PRIOR ** 2 + se ** 2);
    if (Math.abs(r) < 0.005) continue;
    const [relation, pair] = key.split(':') as [keyof Omit<CorrelationTable, 'meta'>, string];
    table[relation][pair] = Number(r.toFixed(3));
  }
  return table;
}

type Trial = { indep: number; corr: number; hit: boolean };

function report(label: string, trials: Trial[]) {
  if (trials.length < 50) return;
  const n = trials.length;
  const hits = trials.filter((t) => t.hit).length;
  const mean = (f: (t: Trial) => number) => trials.reduce((s, t) => s + f(t), 0) / n;
  console.log(
    `    ${label.padEnd(34)} n=${String(n).padStart(6)}  hit ${pct(hits / n)}  predicted: independent ${pct(mean((t) => t.indep))}, correlated ${pct(mean((t) => t.corr))}  log loss ${mean((t) => logLoss(t.indep, t.hit)).toFixed(4)} → ${mean((t) => logLoss(t.corr, t.hit)).toFixed(4)}`
  );
}

/** Random same-game parlays on games the table never saw, priced both ways. */
function evaluate(games: GameLegs[], table: CorrelationTable, league: string) {
  const rand = random(11);
  const pick = <T,>(xs: T[]) => xs[Math.floor(rand() * xs.length)];
  const shuffle = <T,>(xs: T[]) => {
    const out = [...xs];
    for (let i = out.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rand() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  };
  const tables = { [league]: table };
  const propLeg = (x: PropLeg, side: 'over' | 'under'): CorrelatedLeg & { hit: boolean } => ({
    league,
    gameId: '',
    prob: side === 'over' ? x.p : 1 - x.p,
    hit: side === 'over' ? x.y : !x.y,
    link: { kind: 'prop', playerId: x.playerId, teamId: x.teamId, market: x.market, side } satisfies LegLink
  });
  const trial = (legs: (CorrelatedLeg & { hit: boolean })[]): Trial => ({
    indep: legs.reduce((p, l) => p * l.prob, 1),
    corr: allHitChance(legs, tables),
    hit: legs.every((l) => l.hit)
  });
  const out: Record<string, Trial[]> = {};
  const push = (key: string, t: Trial) => (out[key] ??= []).push(t);
  for (const g of games) {
    const side = (): 'over' | 'under' => (rand() < 0.5 ? 'over' : 'under');
    // Two legs, by how they relate.
    for (let k = 0; k < 12; k += 1) {
      const x = pick(g.props);
      const z = pick(g.props);
      if (x === z) continue;
      const relation = x.playerId === z.playerId ? 'same player' : x.teamId === z.teamId ? 'teammates' : 'opponents';
      push(`2 legs, ${relation}`, trial([propLeg(x, side()), propLeg(z, side())]));
    }
    // Three and four legs, anything in the game.
    for (const size of [3, 4]) {
      for (let k = 0; k < 3; k += 1) {
        const chosen = new Set<PropLeg>();
        while (chosen.size < Math.min(size, g.props.length)) chosen.add(pick(g.props));
        if (chosen.size === size) push(`${size} legs, random sides`, trial([...chosen].map((x) => propLeg(x, side()))));
      }
    }
    // A player's overs together: points with rebounds, and so on.
    const byPlayer = new Map<string, PropLeg[]>();
    for (const x of g.props) byPlayer.set(x.playerId, [...(byPlayer.get(x.playerId) ?? []), x]);
    for (const own of byPlayer.values()) {
      if (own.length < 2) continue;
      const [x, z] = shuffle(own);
      push('2 overs, same player', trial([propLeg(x, 'over'), propLeg(z, 'over')]));
    }
    // Stacks: a team to win with overs from two or three of its players.
    for (const [teamId, win] of g.wins ?? []) {
      const own = g.props.filter((x) => x.teamId === teamId);
      const players = shuffle([...new Set(own.map((x) => x.playerId))]);
      for (const size of [2, 3]) {
        if (players.length < size) continue;
        const legs = players.slice(0, size).map((id) => propLeg(pick(own.filter((x) => x.playerId === id)), 'over'));
        legs.push({ league, gameId: '', prob: win.p, hit: win.y, link: { kind: 'win', teamId } });
        push(`team to win + ${size} players' overs`, trial(legs));
      }
    }
  }
  for (const [label, trials] of Object.entries(out)) report(label, trials);
  // Where the correlations move the chance most, did the results follow?
  const all = Object.values(out).flat();
  const bands: [string, (t: Trial) => boolean][] = [
    ['correlated ≥ 1.25× independent', (t) => t.corr >= 1.25 * t.indep],
    ['correlated ≤ 0.8× independent', (t) => t.corr <= 0.8 * t.indep]
  ];
  for (const [label, keep] of bands) report(label, all.filter(keep));
  report('every parlay above', all);
}

export async function correlationBacktest(
  league: LeagueConfig,
  data: {
    games: Game[];
    teams: TeamInfo[];
    closingOdds: Record<string, MarketOdds | null>;
    boxScores: Record<string, BoxScore | null>;
    skillBoxes: Record<string, NflSkillBox | null>;
  }
): Promise<CorrelationTable | null> {
  if (!propEngine(league)) return null;
  const games = await gameLegs(league, data);
  if (games.length < 40) {
    console.log(`  only ${games.length} games with graded lines; skipped`);
    return null;
  }
  const half = Math.floor(games.length / 2);
  const early = games.slice(0, half);
  const late = games.slice(half);
  const fitted = fitTable(early);
  console.log(`  fitted on ${early.length} games (${fitted.meta.from} to ${fitted.meta.to}, ${fitted.meta.pairs.toLocaleString()} pairs of lines)`);
  const strongest = (part: Record<string, number>) =>
    Object.entries(part)
      .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
      .slice(0, 6)
      .map(([k, r]) => `${k} ${r.toFixed(2)}`)
      .join('  ');
  for (const relation of ['same', 'teammate', 'opponent', 'win'] as const) console.log(`    ${relation.padEnd(9)} ${strongest(fitted[relation]) || '-'}`);
  console.log(`  tested on the later ${late.length} games (${late[0].date.slice(0, 10)} to ${late.at(-1)!.date.slice(0, 10)}), log loss independent → correlated:`);
  evaluate(late, fitted, league.id);
  // Stability: the same pairs fitted on each half alone.
  const lateFit = fitTable(late);
  for (const relation of ['same', 'teammate', 'win'] as const) {
    const keys = Object.keys(fitted[relation])
      .sort((a, b) => Math.abs(fitted[relation][b]) - Math.abs(fitted[relation][a]))
      .slice(0, 6);
    console.log(`    ${relation} early → late: ${keys.map((k) => `${k} ${fitted[relation][k].toFixed(2)}→${(lateFit[relation][k] ?? 0).toFixed(2)}`).join('  ')}`);
  }
  const shipped = fitTable(games);
  console.log(`  table for the site: fitted on all ${games.length} games (${shipped.meta.pairs.toLocaleString()} pairs)`);
  return shipped;
}
