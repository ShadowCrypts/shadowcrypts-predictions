/**
 * Replays every league and prints the out-of-sample track record: the forecast
 * as shown (market-anchored), the rating model alone, and the market alone.
 *
 *   npm run backtest              # current settings
 *   npm run backtest -- --grid    # also sweep rating-model settings and the market blend weight
 *
 * The grid only scores the first graded season so later seasons stay a clean
 * holdout for whatever settings you pick.
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { BoxScore, getBoxScores, getNflSkillBoxes } from '../lib/boxscores';
import type { CorrelationTable } from '../lib/model/correlation';
import { CORRELATIONS } from '../lib/model/correlationTable';
import { altLineBacktest } from './altline-backtest';
import { fantasyBacktest } from './fantasy-backtest';
import { hitRateBacktest } from './hitrate-backtest';
import { correlationBacktest } from './correlation-backtest';
import { livePropBacktest } from './liveprop-backtest';
import { propEngine } from '../lib/model/propEngines';
import { Game, getClosingOdds, getLeagueGames, getTeams, MarketOdds } from '../lib/espn';
import { EloParams, LEAGUE_IDS, LEAGUES, LeagueConfig } from '../lib/leagues';
import { computeLeagueModel, LeagueModel } from '../lib/model';
import { replay, winProbability } from '../lib/model/elo';
import { blendProbability, marketView } from '../lib/model/market';
import { lineupPass } from '../lib/model/lineups';
import { MarketRatingParams, marketRatings } from '../lib/model/marketRatings';
import { summarize } from '../lib/model/metrics';
import { qbPass } from '../lib/model/quarterbacks';
import { projectScore, ScoringParams, ScoringPass, scoringPass } from '../lib/model/scoring';
import { propBacktest } from './props-backtest';
import { combineAdjustments, eastwardTrips, travelAdjustments } from '../lib/model/travel';

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const runGrid = process.argv.includes('--grid');

function sweep(league: LeagueConfig, games: Game[], teamIds: Set<string>, odds: Record<string, MarketOdds | null>, box: Record<string, BoxScore | null>) {
  const base = league.elo;
  const usable = games.filter(
    (g) => (g.seasonType === 2 || g.seasonType === 3) && teamIds.has(g.home.teamId) && teamIds.has(g.away.teamId) && !(g.state === 'post' && !g.completed)
  );
  const tuneSeason = [...new Set(usable.map((g) => g.seasonYear))].sort()[1];
  const tuneGames = usable.filter((g) => g.completed && g.seasonYear === tuneSeason && g.home.score !== g.away.score);
  // Lineup adjustments (NBA) at the current settings feed every replay below, as they do in the app.
  const lineupsAt = (scale: number) => {
    if (!league.lineups) return undefined;
    const unit = lineupPass(usable, box, { ...league.lineups, eloPerPoint: 1 }, { rosters: {}, injuries: {} }).extra;
    return new Map([...unit].map(([id, v]) => [id, v * league.lineups!.eloPerPoint * scale]));
  };
  // Starting quarterbacks (NFL) likewise, at the current settings.
  const qbUnit = league.quarterbacks ? qbPass(usable, box, { ...league.quarterbacks, eloPerYard: 1 }, { depth: {}, injuries: {} }).extra : null;
  const qbAt = (scale: number) => (qbUnit ? new Map([...qbUnit].map(([id, v]) => [id, v * league.quarterbacks!.eloPerYard * scale])) : undefined);
  // So does eastward travel, at the current Elo per time zone.
  const trips = eastwardTrips(usable);
  const travelAt = (eastZones: number) => (eastZones ? travelAdjustments(trips, eastZones) : undefined);
  const extra = combineAdjustments(lineupsAt(1), qbAt(1), travelAt(base.eastZones ?? 0));
  const score = (params: EloParams) => {
    const r = replay(usable, params, undefined, extra);
    return summarize(tuneGames.map((g) => ({ homeProb: r.contexts.get(g.id)!.homeProb, homeWon: g.home.score! > g.away.score! })));
  };
  if (league.lineups) {
    const scales = [0.5, 0.75, 1, 1.25, 1.5].map((s) => {
      const r = replay(usable, base, undefined, combineAdjustments(lineupsAt(s), travelAt(base.eastZones ?? 0)));
      const m = summarize(tuneGames.map((g) => ({ homeProb: r.contexts.get(g.id)!.homeProb, homeWon: g.home.score! > g.away.score! })));
      return `${Math.round(league.lineups!.eloPerPoint * s)}: ${m.logLoss.toFixed(4)}`;
    });
    console.log(`  lineup Elo per point (Elo-alone log loss on season ${tuneSeason}): ${scales.join('  ')}`);
  }
  if (league.quarterbacks) {
    // Scored the way it was fitted: the pre-line forecast against the tuning season's closing lines.
    const linesFor = new Map<string, number>();
    for (const g of usable) {
      const line = g.completed ? marketView(odds[g.id] ?? null, league) : null;
      if (line) linesFor.set(g.id, line.homeProb);
    }
    const lined = tuneGames.filter((g) => linesFor.has(g.id));
    const scales = [0, 0.5, 0.75, 1, 1.25, 1.5].map((s) => {
      const r = replay(usable, base, undefined, combineAdjustments(lineupsAt(1), qbAt(s), travelAt(base.eastZones ?? 0)));
      const m = marketRatings(usable, linesFor, r.contexts, base.hfa, league.preLine);
      const soft =
        lined.reduce((sum, g) => {
          const q = linesFor.get(g.id)!;
          const p = blendProbability(r.contexts.get(g.id)!.homeProb, winProbability(m.diffs.get(g.id)!), league.preLine.ratingsShare);
          return sum - q * Math.log(p) - (1 - q) * Math.log(1 - p);
        }, 0) / lined.length;
      return `${Math.round(league.quarterbacks!.eloPerYard * s)}: ${soft.toFixed(4)}`;
    });
    console.log(`  quarterback Elo per yard (pre-line log loss against season ${tuneSeason} closing lines): ${scales.join('  ')}`);
  }

  // Eastward travel, re-fitted together with home field because it mostly lands on the visitors.
  const travelFits = [0, 4, 8, 12, 16, 20]
    .flatMap((eastZones) =>
      [-8, -4, 0, 4].map((dh) => {
        const r = replay(usable, { ...base, hfa: base.hfa + dh, eastZones }, undefined, combineAdjustments(lineupsAt(1), qbAt(1), travelAt(eastZones)));
        const m = summarize(tuneGames.map((g) => ({ homeProb: r.contexts.get(g.id)!.homeProb, homeWon: g.home.score! > g.away.score! })));
        return { eastZones, hfa: base.hfa + dh, logLoss: m.logLoss };
      })
    )
    .sort((a, b) => a.logLoss - b.logLoss);
  console.log(
    `  eastward travel (Elo per zone / home field) on season ${tuneSeason}, best 3: ${travelFits
      .slice(0, 3)
      .map((f) => `${f.eastZones}/${f.hfa} ${f.logLoss.toFixed(4)}`)
      .join('  ')} (current ${base.eastZones ?? 0}/${base.hfa})`
  );

  const results: { params: EloParams; logLoss: number; accuracy: number }[] = [];
  const starterOptions = base.starter
    ? [null, ...[0.5, 1, 1.5].flatMap((f) => [0.9, 0.95, 0.98].map((decay) => ({ ...base.starter!, eloPerUnit: base.starter!.eloPerUnit * f, decay })))]
    : [null];
  for (const k of [0.75, 1, 1.25].map((f) => base.k * f)) {
    for (const hfa of [0.5, 0.75, 1, 1.25].map((f) => Math.round(base.hfa * f))) {
      for (const backToBack of base.backToBack ? [0, 0.5, 1, 1.5].map((f) => base.backToBack * f) : [0]) {
        for (const regress of [0.25, 1 / 3, 0.4]) {
          for (const starter of starterOptions) {
            const params = { ...base, k, hfa, backToBack, regress, starter };
            const m = score(params);
            results.push({ params, logLoss: m.logLoss, accuracy: m.accuracy });
          }
        }
      }
    }
  }
  results.sort((a, b) => a.logLoss - b.logLoss);
  const current = score(base);
  console.log(`  rating-model grid scored on season ${tuneSeason} (${tuneGames.length} games), best 5 by log loss:`);
  for (const r of results.slice(0, 5)) {
    const p = r.params;
    const starter = p.starter ? ` starter=${p.starter.eloPerUnit}/${p.starter.decay}` : '';
    console.log(`    k=${p.k} hfa=${p.hfa} b2b=${p.backToBack} regress=${p.regress.toFixed(2)}${starter}  logloss=${r.logLoss.toFixed(4)} acc=${pct(r.accuracy)}`);
  }
  console.log(`    current settings: logloss=${current.logLoss.toFixed(4)} acc=${pct(current.accuracy)}`);

  // Market blend: the rating model's share in logit space, fitted on the same season.
  const r = replay(usable, base, undefined, extra);
  const withLine = tuneGames.filter((g) => marketView(odds[g.id] ?? null, league));
  const blendLoss = (share: number) =>
    summarize(
      withLine.map((g) => ({
        homeProb: blendProbability(r.contexts.get(g.id)!.homeProb, marketView(odds[g.id] ?? null, league)!.homeProb, share),
        homeWon: g.home.score! > g.away.score!
      }))
    ).logLoss;
  const shares = Array.from({ length: 21 }, (_, i) => i * 0.025);
  const best = shares.reduce((a, b) => (blendLoss(b) < blendLoss(a) ? b : a), 0);
  console.log(`  best ratings share in the market blend: ${best} (current ${league.modelShare}) on ${withLine.length} games with a line`);

  // Pre-line forecast: market-implied ratings, then their blend with Elo. Every
  // tuning-season game is scored as if its own line weren't posted yet.
  const lineProbs = new Map<string, number>();
  for (const g of usable) {
    const line = g.completed ? marketView(odds[g.id] ?? null, league) : null;
    if (line) lineProbs.set(g.id, line.homeProb);
  }
  const won = (g: Game) => g.home.score! > g.away.score!;
  const preLineLoss = (p: MarketRatingParams) => {
    const m = marketRatings(usable, lineProbs, r.contexts, base.hfa, p);
    return summarize(
      tuneGames.map((g) => ({ homeProb: blendProbability(r.contexts.get(g.id)!.homeProb, winProbability(m.diffs.get(g.id)!), p.ratingsShare), homeWon: won(g) }))
    ).logLoss;
  };
  let bestPre: { p: MarketRatingParams; loss: number } | null = null;
  for (const starters of base.starter ? (['model', 'market'] as const) : (['model'] as const))
    for (const starterStep of starters === 'market' ? [0.1, 0.2, 0.35, 0.5] : [0])
      for (const lineStep of [0.05, 0.1, 0.15, 0.2, 0.3])
        for (const resultK of [0, base.k * 0.25, base.k * 0.5])
          for (const regress of [0.25, 0.5])
            for (const hfaStep of [0, 0.01]) {
              const p = { lineStep, resultK, regress, hfaStep, starters, starterStep, ratingsShare: 0 };
              const loss = preLineLoss(p);
              if (!bestPre || loss < bestPre.loss) bestPre = { p, loss };
            }
  const ratingsShare = shares
    .map((s) => s * 2)
    .reduce((a, b) => (preLineLoss({ ...bestPre!.p, ratingsShare: b }) < preLineLoss({ ...bestPre!.p, ratingsShare: a }) ? b : a), 0);
  console.log(`  best pre-line settings: ${JSON.stringify({ ...bestPre!.p, ratingsShare })}`);
  console.log(`    current: ${JSON.stringify(league.preLine)}`);
}

/**
 * Projected scores: tunes the scoring model's settings and the margin slope on
 * the first graded season, then reports later seasons against the posted
 * over/under, the posted spread, and the league average.
 */
function scoreSweep(league: LeagueConfig, model: LeagueModel, games: Game[], odds: Record<string, MarketOdds | null>) {
  const usable = games.filter((g) => model.predictions[g.id]);
  const done = usable.filter((g) => g.completed && g.home.score !== null && g.away.score !== null);
  const seasons = [...new Set(done.map((g) => g.seasonYear))].sort();
  const tuneSeason = seasons[1];
  const tune = done.filter((g) => g.seasonYear === tuneSeason);
  const holdout = done.filter((g) => g.seasonYear > tuneSeason);
  const total = (g: Game) => g.home.score! + g.away.score!;
  const margin = (g: Game) => g.home.score! - g.away.score!;
  const mae = (xs: number[]) => xs.reduce((s, x) => s + Math.abs(x), 0) / Math.max(1, xs.length);
  const totalMiss = (pass: ScoringPass, set: Game[]) => mae(set.map((g) => pass.expected.get(g.id)!.home + pass.expected.get(g.id)!.away - total(g)));

  const fits: { params: ScoringParams; miss: number }[] = [];
  for (const k of [0, 0.0025, 0.005, 0.01, 0.015, 0.02, 0.03, 0.04, 0.06, 0.08, 0.1])
    for (const regress of [0.25, 0.4, 0.6, 0.8])
      for (const leagueStep of [0.001, 0.003, 0.01])
        for (const venueK of [0, 0.002, 0.005, 0.01, 0.02]) {
          const params = { k, regress, leagueStep, venueK, marginPerLogit: 0 };
          fits.push({ params, miss: totalMiss(scoringPass(usable, params), tune) });
        }
  fits.sort((a, b) => a.miss - b.miss);
  const label = (p: ScoringParams) => `k=${p.k} regress=${p.regress} step=${p.leagueStep} venue=${p.venueK}`;
  console.log(`  scoring model on season ${tuneSeason}, best 3 by total MAE: ${fits.slice(0, 3).map((f) => `${label(f.params)} ${f.miss.toFixed(3)}`).join('  ')}`);
  const noVenue = fits.find((f) => f.params.venueK === 0)!;
  console.log(`    best without venues: ${label(noVenue.params)} ${noVenue.miss.toFixed(3)}`);

  // Margin per unit of log-odds, least squares through the origin on the tuning season.
  const x = (g: Game) => Math.log(model.predictions[g.id].homeProb / (1 - model.predictions[g.id].homeProb));
  const slope = tune.reduce((s, g) => s + x(g) * margin(g), 0) / tune.reduce((s, g) => s + x(g) ** 2, 0);
  const spreadTune = tune.filter((g) => marketView(odds[g.id] ?? null, league)?.homeSpread != null);
  const spreadSlope = league.elo.eloPerPoint
    ? spreadTune.reduce((s, g) => s + x(g) * -marketView(odds[g.id] ?? null, league)!.homeSpread!, 0) / spreadTune.reduce((s, g) => s + x(g) ** 2, 0)
    : null;
  const holdoutGames = done.filter((g) => g.seasonYear > tuneSeason);
  const slopeMiss = (b: number) => mae(holdoutGames.map((g) => b * x(g) - margin(g))).toFixed(3);
  console.log(`  margin per logit: ${slope.toFixed(2)} from results (holdout MAE ${slopeMiss(slope)})${spreadSlope ? `, ${spreadSlope.toFixed(2)} from posted spreads (${slopeMiss(spreadSlope)})` : ''}`);

  const params = league.scoring;
  console.log(`  holdout below uses the current settings: ${label(params)} margin=${params.marginPerLogit}`);
  const pass = scoringPass(usable, params);
  const view = (g: Game) => marketView(odds[g.id] ?? null, league);
  const withTotal = holdout.filter((g) => view(g)?.overUnder != null);
  const modelTotal = (g: Game) => pass.expected.get(g.id)!.home + pass.expected.get(g.id)!.away;
  // Market and model totals blended, the weight fitted on the tuning season.
  const tuneWithTotal = tune.filter((g) => view(g)?.overUnder != null);
  const blendMiss = (w: number, set: Game[]) => mae(set.map((g) => w * view(g)!.overUnder! + (1 - w) * modelTotal(g) - total(g)));
  const weights = Array.from({ length: 11 }, (_, i) => i / 10);
  const w = weights.reduce((a, b) => (blendMiss(b, tuneWithTotal) < blendMiss(a, tuneWithTotal) ? b : a), 1);
  console.log(
    `  holdout totals (${withTotal.length} games with an over/under): model ${mae(withTotal.map((g) => modelTotal(g) - total(g))).toFixed(2)}  market ${mae(withTotal.map((g) => view(g)!.overUnder! - total(g))).toFixed(2)}  league average ${mae(withTotal.map((g) => 2 * pass.averageBefore.get(g.id)! - total(g))).toFixed(2)}  blend w=${w} ${blendMiss(w, withTotal).toFixed(2)}`
  );
  console.log(`  holdout totals, all ${holdout.length} games: model ${totalMiss(pass, holdout).toFixed(2)}  league average ${mae(holdout.map((g) => 2 * pass.averageBefore.get(g.id)! - total(g))).toFixed(2)}`);
  const withSpread = holdout.filter((g) => view(g)?.homeSpread != null);
  const forecastMargin = (g: Game) => slope * x(g);
  console.log(
    `  holdout margin: from the forecast ${mae(holdout.map((g) => forecastMargin(g) - margin(g))).toFixed(2)} (all)` +
      (league.elo.eloPerPoint ? `  forecast ${mae(withSpread.map((g) => forecastMargin(g) - margin(g))).toFixed(2)} vs posted spread ${mae(withSpread.map((g) => -view(g)!.homeSpread! - margin(g))).toFixed(2)} (${withSpread.length} with a spread)` : '')
  );
  const projected = holdout.map((g) => ({ g, s: projectScore(model.predictions[g.id].homeProb, pass.expected.get(g.id)!, view(g), params, !!league.elo.eloPerPoint) }));
  const teamMiss = mae(projected.flatMap(({ g, s }) => [s.home - g.home.score!, s.away - g.away.score!]));
  console.log(`  holdout projected score as shown: each team's score off by ${teamMiss.toFixed(2)} ${league.scoreUnit} on average`);
}

async function main() {
  if (process.argv.includes('--live-props')) {
    const only = process.argv.find((a) => a.startsWith('--league='))?.split('=')[1];
    for (const id of ['nba', 'nhl', 'nfl'] as const) {
      const league = LEAGUES[id];
      if (only && only !== id) continue;
      const [games, teams] = await Promise.all([getLeagueGames(league), getTeams(league)]);
      const regular = games.filter((g) => g.seasonType === 2 || g.seasonType === 3);
      const first = Math.min(...regular.map((g) => g.seasonYear));
      const closingOdds = await getClosingOdds(league, regular.filter((g) => g.completed && g.seasonYear > first));
      const [boxScores, skillBoxes] = await Promise.all([getBoxScores(league, regular), getNflSkillBoxes(league, regular)]);
      console.log(`\n=== ${league.name} live prop chances ===`);
      await livePropBacktest(league, { games, teams, closingOdds, boxScores, skillBoxes });
    }
    return;
  }
  if (process.argv.includes('--fantasy')) {
    const league = LEAGUES.nfl;
    const [games, teams] = await Promise.all([getLeagueGames(league), getTeams(league)]);
    const regular = games.filter((g) => g.seasonType === 2 || g.seasonType === 3);
    const first = Math.min(...regular.map((g) => g.seasonYear));
    const closingOdds = await getClosingOdds(league, regular.filter((g) => g.completed && g.seasonYear > first));
    const [boxScores, skillBoxes] = await Promise.all([getBoxScores(league, regular), getNflSkillBoxes(league, regular)]);
    console.log(`\n=== ${league.name} fantasy projections ===`);
    await fantasyBacktest(league, { games, teams, closingOdds, boxScores, skillBoxes });
    return;
  }
  if (process.argv.includes('--hit-rates')) {
    const only = process.argv.find((a) => a.startsWith('--league='))?.split('=')[1];
    for (const id of LEAGUE_IDS) {
      const league = LEAGUES[id];
      if (!propEngine(league) || (only && only !== id)) continue;
      const [games, teams] = await Promise.all([getLeagueGames(league), getTeams(league)]);
      const regular = games.filter((g) => g.seasonType === 2 || g.seasonType === 3);
      const first = Math.min(...regular.map((g) => g.seasonYear));
      const closingOdds = await getClosingOdds(league, regular.filter((g) => g.completed && g.seasonYear > first));
      const [boxScores, skillBoxes] = await Promise.all([getBoxScores(league, regular), getNflSkillBoxes(league, regular)]);
      console.log(`\n=== ${league.name} hit rates ===`);
      await hitRateBacktest(league, { games, teams, closingOdds, boxScores, skillBoxes });
    }
    return;
  }
  if (process.argv.includes('--alt-lines')) {
    const only = process.argv.find((a) => a.startsWith('--league='))?.split('=')[1];
    for (const id of LEAGUE_IDS) {
      const league = LEAGUES[id];
      if (!propEngine(league) || (only && only !== id)) continue;
      const [games, teams] = await Promise.all([getLeagueGames(league), getTeams(league)]);
      const regular = games.filter((g) => g.seasonType === 2 || g.seasonType === 3);
      const first = Math.min(...regular.map((g) => g.seasonYear));
      const closingOdds = await getClosingOdds(league, regular.filter((g) => g.completed && g.seasonYear > first));
      const [boxScores, skillBoxes] = await Promise.all([getBoxScores(league, regular), getNflSkillBoxes(league, regular)]);
      console.log(`\n=== ${league.name} chances at any line ===`);
      await altLineBacktest(league, { games, teams, closingOdds, boxScores, skillBoxes });
    }
    return;
  }
  if (process.argv.includes('--correlations')) {
    const only = process.argv.find((a) => a.startsWith('--league='))?.split('=')[1];
    const tables: Partial<Record<string, CorrelationTable>> = { ...CORRELATIONS };
    for (const id of LEAGUE_IDS) {
      const league = LEAGUES[id];
      if (!propEngine(league) || (only && only !== id)) continue;
      const [games, teams] = await Promise.all([getLeagueGames(league), getTeams(league)]);
      const regular = games.filter((g) => g.seasonType === 2 || g.seasonType === 3);
      const first = Math.min(...regular.map((g) => g.seasonYear));
      const closingOdds = await getClosingOdds(league, regular.filter((g) => g.completed && g.seasonYear > first));
      const [boxScores, skillBoxes] = await Promise.all([getBoxScores(league, regular), getNflSkillBoxes(league, regular)]);
      console.log(`\n=== ${league.name} same-game correlations ===`);
      const table = await correlationBacktest(league, { games, teams, closingOdds, boxScores, skillBoxes });
      if (table) tables[id] = table;
    }
    if (process.argv.includes('--write')) {
      const file = path.join(__dirname, '..', 'lib', 'model', 'correlationTable.ts');
      const body = `// Generated by \`npm run backtest -- --correlations --write\`; don't edit by hand.\nimport type { CorrelationTable } from './correlation';\n\nexport const CORRELATIONS: Partial<Record<string, CorrelationTable>> = ${JSON.stringify(tables, null, 2)};\n`;
      writeFileSync(file, body);
      console.log(`\nwrote ${path.relative(process.cwd(), file)}`);
    }
    return;
  }
  if (process.argv.includes('--props')) {
    // `--league=nhl` runs one league.
    const only = process.argv.find((a) => a.startsWith('--league='))?.split('=')[1];
    for (const id of LEAGUE_IDS) {
      const league = LEAGUES[id];
      if (!propEngine(league) || (only && only !== id)) continue;
      const [games, teams] = await Promise.all([getLeagueGames(league), getTeams(league)]);
      const regular = games.filter((g) => g.seasonType === 2 || g.seasonType === 3);
      const first = Math.min(...regular.map((g) => g.seasonYear));
      const closingOdds = await getClosingOdds(league, regular.filter((g) => g.completed && g.seasonYear > first));
      const [boxScores, skillBoxes] = await Promise.all([getBoxScores(league, regular), getNflSkillBoxes(league, regular)]);
      console.log(`\n=== ${league.name} player props ===`);
      await propBacktest(league, { games, teams, closingOdds, boxScores, skillBoxes });
    }
    return;
  }
  if (process.argv.includes('--scores')) {
    for (const id of LEAGUE_IDS) {
      const league = LEAGUES[id];
      const [games, teams] = await Promise.all([getLeagueGames(league), getTeams(league)]);
      const regular = games.filter((g) => g.seasonType === 2 || g.seasonType === 3);
      const first = Math.min(...regular.map((g) => g.seasonYear));
      const closingOdds = await getClosingOdds(league, regular.filter((g) => g.completed && g.seasonYear > first));
      const boxScores = league.lineups || league.quarterbacks ? await getBoxScores(league, regular) : {};
      const { model } = computeLeagueModel(league, { games, teams, closingOdds, boxScores });
      console.log(`\n=== ${league.name} projected scores ===`);
      scoreSweep(league, model, games, closingOdds);
    }
    return;
  }
  for (const id of LEAGUE_IDS) {
    const league = LEAGUES[id];
    const [games, teams] = await Promise.all([getLeagueGames(league), getTeams(league)]);
    const regular = games.filter((g) => g.seasonType === 2 || g.seasonType === 3);
    const first = Math.min(...regular.map((g) => g.seasonYear));
    const closingOdds = await getClosingOdds(league, regular.filter((g) => g.completed && g.seasonYear > first));
    const boxScores = league.lineups || league.quarterbacks ? await getBoxScores(league, regular) : {};
    const { model } = computeLeagueModel(league, { games, teams, closingOdds, boxScores });
    const { overall, modelOnly, marketOnly, preLine, marketCoverage, seasons, bands, calibration } = model.record;

    console.log(`\n=== ${league.name} ===`);
    console.log(`forecast  n=${overall.games}  acc=${pct(overall.accuracy)}  brier=${overall.brier.toFixed(4)}  logloss=${overall.logLoss.toFixed(4)}`);
    console.log(`ratings   acc=${pct(modelOnly.accuracy)}  logloss=${modelOnly.logLoss.toFixed(4)}`);
    console.log(`pre-line  acc=${pct(preLine.accuracy)}  logloss=${preLine.logLoss.toFixed(4)}  (every game, as if no line were posted)`);
    console.log(`market    acc=${pct(marketOnly.accuracy)}  logloss=${marketOnly.logLoss.toFixed(4)}  (lines for ${pct(marketCoverage)} of games)`);
    console.log(`home-team baseline=${pct(overall.homeBaseline)}`);
    for (const s of seasons) {
      console.log(`  ${s.label.padEnd(8)} n=${String(s.metrics.games).padStart(5)}  acc=${pct(s.metrics.accuracy)}  logloss=${s.metrics.logLoss.toFixed(4)}`);
    }
    console.log('  bands:', bands.map((b) => `${b.band} ${b.games ? pct(b.accuracy) : '-'} (n=${b.games}, avg ${pct(b.avgProb)})`).join(' | '));
    console.log('  calibration:', calibration.map((c) => `${Math.round(c.lo * 100)}+: ${pct(c.actual)} vs ${pct(c.predicted)} (n=${c.games})`).join(' | '));

    if (runGrid) sweep(league, games, new Set(teams.map((t) => t.id)), closingOdds, boxScores);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
