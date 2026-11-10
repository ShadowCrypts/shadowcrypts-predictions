/**
 * Live prop chances: from each graded main line's pregame chance and the
 * player's stat at each quarter or period break (rebuilt from play-by-play,
 * kept only where it adds up to the box score), the chance the over still
 * hits. Settings are fitted on the earlier half of games and checked on the
 * later half against the pregame chance alone and a plain time-left scaling.
 * Also checks same-game pairs at halftime, live chances combined with the
 * same-game correlations. Run through `npm run backtest -- --live-props`
 * (the first run downloads play-by-play for every graded game).
 */
import type { BoxScore, NflSkillBox } from '../lib/boxscores';
import type { Game, MarketOdds, TeamInfo } from '../lib/espn';
import type { LeagueConfig } from '../lib/leagues';
import { computeLeagueModel } from '../lib/model';
import { allHitChance, CorrelatedLeg } from '../lib/model/correlation';
import { CORRELATIONS } from '../lib/model/correlationTable';
import { LivePropParams, overFromMean } from '../lib/model/liveProps';
import { blendProbability } from '../lib/model/market';
import { propEngine, PropInputs } from '../lib/model/propEngines';
import { gradedLines, impliedMean, PropModelParams } from '../lib/model/propModel';
import { scoringPass } from '../lib/model/scoring';
import { getPlaySplits, MARKET_PARTS, PeriodSplits, SPLIT_LEAGUES } from '../lib/playSplits';
import { getPropHistory } from '../lib/propFeed';
import type { PropMarket } from '../lib/props';

/** A lead big enough to sit starters, and the step past it each cut (and in football, each lean of game script) counts. */
const BLOWOUT: Record<string, { from: number; per: number }> = { nba: { from: 12, per: 10 }, nhl: { from: 2, per: 1 }, nfl: { from: 17, per: 7 } };
/** Markets whose total can go down: a yardage line passed at a break can still finish under. */
const CAN_FALL = new Set<PropMarket>(['pass_yds', 'pass_rush_yds', 'rush_yds', 'rec_yds', 'rush_rec_yds']);

type Sample = {
  date: string;
  gameId: string;
  playerId: string;
  teamId: string;
  market: PropMarket;
  line: number;
  /** Pregame over chance and the mean it implies. */
  p: number;
  mean: number;
  /** Checkpoint index (0 = after the first quarter or period), the stat by then, the lead then. */
  checkpoint: number;
  current: number;
  played: number;
  lead: number;
  /** The player's team's lead then (below zero when behind). */
  edge: number;
  y: boolean;
};

const PACE = [0.8, 0.85, 0.9, 0.95, 1, 1.05, 1.1, 1.15, 1.2];
const CARRY = [0, 0.05, 0.1, 0.2, 0.3, 0.5];
const SPREAD = [0.5, 0.6, 0.8, 1, 1.2, 1.5, 2];
const CUT = [0, 0.05, 0.1, 0.2, 0.3];
const SCRIPT = [0, 0.03, 0.06, 0.1, 0.15, 0.2, 0.3];

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
const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / Math.max(1, xs.length);

export async function livePropBacktest(
  league: LeagueConfig,
  data: {
    games: Game[];
    teams: TeamInfo[];
    closingOdds: Record<string, MarketOdds | null>;
    boxScores: Record<string, BoxScore | null>;
    skillBoxes: Record<string, NflSkillBox | null>;
  }
): Promise<LivePropParams | null> {
  const engine = propEngine(league);
  const periods = SPLIT_LEAGUES[league.id];
  if (!engine || !periods) return null;
  const params: PropModelParams = engine.params;
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
  const graded = new Set(lines.map((l) => l.gameId));
  const splits: Record<string, PeriodSplits | null> = await getPlaySplits(
    league,
    withProps.filter((g) => graded.has(g.id))
  );
  const dateOf = new Map(games.map((g) => [g.id, g.date]));
  const homeOf = new Map(games.map((g) => [g.id, g.home.teamId]));

  // Samples: every main line whose play-by-play adds up to the box score, at every break.
  const samples: Sample[] = [];
  let kept = 0;
  let dropped = 0;
  for (const l of lines) {
    const split = splits[l.gameId];
    const parts = MARKET_PARTS[league.id][l.line.market];
    const proj = projections.get(l.gameId);
    const teamId = proj ? [...proj.home, ...proj.away].find((x) => x.id === l.line.athleteId)?.teamId : undefined;
    if (!split || !parts || !teamId) continue;
    const row = split.players[l.line.athleteId] ?? {};
    const byPeriod = Array.from({ length: periods }, (_, i) => parts.reduce((s, part) => s + (row[part]?.[i] ?? 0), 0));
    if (byPeriod.reduce((a, b) => a + b, 0) !== l.actual) {
      dropped += 1;
      continue;
    }
    kept += 1;
    const p = blendProbability(l.model, l.book, params.modelShare);
    const m = impliedMean(params, l.line.market, l.line.line, p, params.lineSpread?.[l.line.market] ?? 1);
    let current = 0;
    for (let c = 0; c < periods - 1; c += 1) {
      current += byPeriod[c];
      samples.push({
        date: dateOf.get(l.gameId) ?? '',
        gameId: l.gameId,
        playerId: l.line.athleteId,
        teamId,
        market: l.line.market,
        line: l.line.line,
        p,
        mean: m,
        checkpoint: c,
        current,
        played: (c + 1) / periods,
        lead: Math.abs(split.margins[c] ?? 0),
        edge: (split.margins[c] ?? 0) * (homeOf.get(l.gameId) === teamId ? 1 : -1),
        y: l.actual > l.line.line
      });
    }
  }
  console.log(`  ${kept.toLocaleString()} graded lines rebuilt period by period (${dropped.toLocaleString()} didn't add up to the box score and were left out)`);
  if (kept < 500) return null;
  samples.sort((a, b) => a.date.localeCompare(b.date));
  const dates = [...new Set(samples.map((s) => s.gameId))];
  const cut = new Set(dates.slice(0, Math.floor(dates.length / 2)));
  const early = samples.filter((s) => cut.has(s.gameId));
  const late = samples.filter((s) => !cut.has(s.gameId));

  const checkpoints = Array.from({ length: periods - 1 }, (_, c) => (c + 1) / periods);
  const blow = BLOWOUT[league.id];
  type Point = { pace: number; carry: number; spread: number; blowout: number; script: number };
  const live = (point: Point[]): LivePropParams => ({
    checkpoints,
    pace: point.map((x) => x.pace),
    carry: point.map((x) => x.carry),
    spread: point.map((x) => x.spread),
    blowout: point.map((x) => x.blowout),
    blowoutFrom: blow.from,
    blowoutPer: blow.per,
    ...(point.some((x) => x.script) ? { script: point.map((x) => x.script) } : {})
  });
  const chance = (settings: LivePropParams, s: Sample) => overFromMean(params, settings, s.market, s.line, s.mean, s);
  const start = (): Point => ({ pace: 1, carry: 0, spread: 1, blowout: 0, script: 0 });

  /** Per checkpoint, coordinate descent over the settings on that checkpoint's samples; game script only for football, and only when asked. */
  const fit = (set: Sample[], withScript = league.id === 'nfl') => {
    const point = checkpoints.map(start);
    const knobs: [keyof Point, number[]][] = [
      ['pace', PACE],
      ['carry', CARRY],
      ['spread', SPREAD],
      ['blowout', CUT],
      ...(withScript ? [['script', SCRIPT] as [keyof Point, number[]]] : [])
    ];
    for (let c = 0; c < checkpoints.length; c += 1) {
      const own = set.filter((s) => s.checkpoint === c && s.current <= s.line);
      const loss = (x: (typeof point)[number]) => {
        const trial = live(point.map((p, i) => (i === c ? x : p)));
        return own.reduce((sum, s) => sum + logLoss(chance(trial, s), s.y), 0);
      };
      for (let pass = 0; pass < 2; pass += 1) {
        for (const [key, grid] of knobs) {
          let best = point[c];
          let bestLoss = loss(best);
          for (const v of grid) {
            const x = { ...point[c], [key]: v };
            const l = loss(x);
            if (l < bestLoss) {
              best = x;
              bestLoss = l;
            }
          }
          point[c] = best;
        }
      }
    }
    return live(point);
  };

  const fitted = fit(early);
  const plain = live(checkpoints.map(start));
  const noScript = league.id === 'nfl' ? fit(early, false) : null;
  console.log(
    `  fitted on ${cut.size.toLocaleString()} games: pace ${fitted.pace.join('/')} carry ${fitted.carry.join('/')} spread ${fitted.spread.join('/')} blowout ${fitted.blowout.join('/')}${fitted.script ? ` script ${fitted.script.join('/')}` : ''}`
  );
  console.log(
    `  later ${(dates.length - cut.size).toLocaleString()} games, legs still open at each break; log loss pregame chance / time left only /${noScript ? ' fitted without game script /' : ''} fitted:`
  );
  const label = (c: number) => (league.id === 'nhl' ? ['after P1', 'after P2'][c] : ['after Q1', 'halftime', 'after Q3'][c]);
  for (let c = 0; c < checkpoints.length; c += 1) {
    const xs = late.filter((s) => s.checkpoint === c && s.current <= s.line);
    const fit = xs.map((s) => chance(fitted, s));
    const without = noScript ? ` ${mean(xs.map((s) => logLoss(chance(noScript, s), s.y))).toFixed(4)} /` : '';
    console.log(
      `    ${label(c).padEnd(9)} n=${String(xs.length).padStart(6)}  ${mean(xs.map((s) => logLoss(s.p, s.y))).toFixed(4)} / ${mean(xs.map((s) => logLoss(chance(plain, s), s.y))).toFixed(4)} /${without} ${mean(xs.map((s, i) => logLoss(fit[i], s.y))).toFixed(4)}`
    );
    const bands = [0, 0.1, 0.25, 0.4, 0.6, 0.75, 0.9, 1];
    const rows: string[] = [];
    for (let b = 0; b < bands.length - 1; b += 1) {
      const idx = fit.map((p, i) => (p >= bands[b] && p < bands[b + 1] ? i : -1)).filter((i) => i >= 0);
      if (idx.length >= 50) rows.push(`said ${pct(mean(idx.map((i) => fit[i])))} hit ${pct(mean(idx.map((i) => +xs[i].y)))} (${idx.length})`);
    }
    console.log(`      calibration: ${rows.join(' | ')}`);
  }

  // By market at the middle break, and how often a yardage line already passed still finished over.
  const mid = Math.floor((checkpoints.length - 1) / 2);
  const byMarket = new Map<PropMarket, Sample[]>();
  for (const s of late) if (s.checkpoint === mid && s.current <= s.line) byMarket.set(s.market, [...(byMarket.get(s.market) ?? []), s]);
  const marketRows = [...byMarket]
    .filter(([, xs]) => xs.length >= 200)
    .map(([m, xs]) => `${m} ${mean(xs.map((s) => logLoss(s.p, s.y))).toFixed(3)}→${mean(xs.map((s) => logLoss(chance(fitted, s), s.y))).toFixed(3)} (${xs.length})`);
  console.log(`  by market at ${label(mid)}, pregame → live: ${marketRows.join(' | ')}`);
  for (let c = 0; c < checkpoints.length; c += 1) {
    const past = late.filter((s) => s.checkpoint === c && s.current > s.line && CAN_FALL.has(s.market));
    if (past.length >= 50) console.log(`  yardage lines already passed ${label(c)}: ${pct(mean(past.map((s) => +s.y)))} still finished over (${past.length})`);
  }

  // Same-game pairs at the middle break, both legs still open: live chances multiplied or combined with the correlations.
  const byGame = new Map<string, Sample[]>();
  for (const s of late) if (s.checkpoint === mid && s.current <= s.line) byGame.set(s.gameId, [...(byGame.get(s.gameId) ?? []), s]);
  const rand = random(3);
  const trials: { indep: number; corr: number; hit: boolean }[] = [];
  for (const group of byGame.values()) {
    if (group.length < 2) continue;
    for (let k = 0; k < 6; k += 1) {
      const a = group[Math.floor(rand() * group.length)];
      const b = group[Math.floor(rand() * group.length)];
      if (a === b) continue;
      const legs = [a, b].map((s): CorrelatedLeg & { hit: boolean } => {
        const side = rand() < 0.5 ? 'over' : 'under';
        const q = chance(fitted, s);
        return {
          league: league.id,
          gameId: s.gameId,
          prob: side === 'over' ? q : 1 - q,
          hit: side === 'over' ? s.y : !s.y,
          link: { kind: 'prop', playerId: s.playerId, teamId: s.teamId, market: s.market, side }
        };
      });
      trials.push({ indep: legs[0].prob * legs[1].prob, corr: allHitChance(legs, CORRELATIONS), hit: legs.every((l) => l.hit) });
    }
  }
  if (trials.length >= 100) {
    console.log(
      `  same-game pairs at ${label(mid)} (n=${trials.length}): hit ${pct(mean(trials.map((t) => +t.hit)))}, multiplied ${pct(mean(trials.map((t) => t.indep)))}, with correlations ${pct(mean(trials.map((t) => t.corr)))}; log loss ${mean(trials.map((t) => logLoss(t.indep, t.hit))).toFixed(4)} → ${mean(trials.map((t) => logLoss(t.corr, t.hit))).toFixed(4)}`
    );
  }
  const shipped = fit(samples);
  console.log(`  for the site, fitted on every game: ${JSON.stringify({ pace: shipped.pace, carry: shipped.carry, spread: shipped.spread, blowout: shipped.blowout, script: shipped.script })}`);
  return shipped;
}
