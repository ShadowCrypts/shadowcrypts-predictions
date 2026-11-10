/**
 * Fantasy football: do the projections rank players better than the obvious
 * thing, his average so far? For every NFL week on file, each player's projected
 * points (from earlier games only) against what he scored, next to two baselines
 * a fan could work out alone: his season average and his last three games. Both
 * sides are scored only on players who played, since the projections for past
 * games know who was active. A touchdown prior is fitted on the earlier season
 * and checked on the later one, and range quantiles for the page come from here.
 * Run through `npm run backtest -- --fantasy`.
 */
import type { BoxScore, NflSkillBox } from '../lib/boxscores';
import type { Game, MarketOdds, TeamInfo } from '../lib/espn';
import type { LeagueConfig } from '../lib/leagues';
import { computeLeagueModel } from '../lib/model';
import { actualLines, fantasyPoints, projectedLine, projectedPoints, rankCorrelation } from '../lib/model/fantasy';
import { nflPlayerPass, NflPlayerParams } from '../lib/model/nflPlayers';
import { scoringPass } from '../lib/model/scoring';

const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / Math.max(1, xs.length);
const quantile = (xs: number[], q: number) => {
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0;
};

/** `raw` is the model's number before the page's correction; `projected` is what the page shows. */
type Row = { season: number; week: string; id: string; group: string; raw: number; projected: number; average: number; last3: number; actual: number; games: number };

const groupOf = (detail: string) => (detail.startsWith('QB') ? 'QB' : detail.startsWith('RB') ? 'RB' : 'WR/TE');
/** An NFL week: games from Thursday to Monday, labeled by the Tuesday before. */
const weekOf = (date: string) => {
  const d = new Date(date);
  const et = new Date(d.getTime() - 5 * 3_600_000);
  const back = (et.getUTCDay() + 5) % 7;
  return new Date(Date.UTC(et.getUTCFullYear(), et.getUTCMonth(), et.getUTCDate() - back)).toISOString().slice(0, 10);
};

function rowsFor(params: NflPlayerParams, games: Game[], box: Record<string, BoxScore | null>, skill: Record<string, NflSkillBox | null>, teamPoints: Map<string, { home: number; away: number }>, leaguePoints: Map<string, number>) {
  const projected = nflPlayerPass(games, box, skill, params, { teamPoints, leaguePoints }, { rosters: {}, injuries: {}, starters: new Map() }, (g) => g.completed && g.seasonType === 2);
  const history = new Map<string, { season: number; points: number }[]>();
  const rows: Row[] = [];
  for (const g of games) {
    if (!g.completed || g.seasonType !== 2) continue;
    const actual = actualLines(box[g.id], skill[g.id]);
    const p = projected.get(g.id);
    if (p) {
      for (const player of [...p.home, ...p.away]) {
        const line = actual.get(player.id);
        const past = (history.get(player.id) ?? []).filter((h) => h.season === g.seasonYear);
        // Every side needs something to go on: a player's first three games of a season stay out.
        if (!line || past.length < 3) continue;
        const group = groupOf(player.detail);
        rows.push({
          season: g.seasonYear,
          week: weekOf(g.date),
          id: player.id,
          group,
          raw: fantasyPoints(projectedLine(player)),
          projected: projectedPoints(projectedLine(player), group === 'WR/TE' ? 'WR' : (group as 'QB' | 'RB')),
          average: mean(past.map((h) => h.points)),
          last3: mean(past.slice(-3).map((h) => h.points)),
          actual: fantasyPoints(line),
          games: past.length
        });
      }
    }
    for (const [id, line] of actual) (history.get(id) ?? history.set(id, []).get(id)!).push({ season: g.seasonYear, points: fantasyPoints(line) });
  }
  return rows;
}

function report(label: string, rows: Row[]) {
  const mae = (f: (r: Row) => number) => mean(rows.map((r) => Math.abs(f(r) - r.actual)));
  const weeks = new Map<string, Row[]>();
  for (const r of rows) (weeks.get(`${r.week}|${r.group}`) ?? weeks.set(`${r.week}|${r.group}`, []).get(`${r.week}|${r.group}`)!).push(r);
  const inOrder = (f: (r: Row) => number) => mean([...weeks.values()].filter((w) => w.length >= 8).map((w) => rankCorrelation(w.map(f), w.map((r) => r.actual))));
  console.log(
    `    ${label.padEnd(10)} n=${String(rows.length).padStart(5)}  average miss: projected ${mae((r) => r.projected).toFixed(2)}, season average ${mae((r) => r.average).toFixed(2)}, last 3 ${mae((r) => r.last3).toFixed(2)} | order within a week: projected ${inOrder((r) => r.projected).toFixed(3)}, season average ${inOrder((r) => r.average).toFixed(3)}, last 3 ${inOrder((r) => r.last3).toFixed(3)}`
  );
}

export async function fantasyBacktest(
  league: LeagueConfig,
  data: { games: Game[]; teams: TeamInfo[]; closingOdds: Record<string, MarketOdds | null>; boxScores: Record<string, BoxScore | null>; skillBoxes: Record<string, NflSkillBox | null> }
) {
  if (!league.nflPlayers) return;
  const { model } = computeLeagueModel(league, data);
  const games = Object.values(model.predictions)
    .map((p) => p.game)
    .sort((a, b) => a.date.localeCompare(b.date));
  const teamPoints = new Map<string, { home: number; away: number }>();
  for (const g of games) {
    const p = model.predictions[g.id].projected;
    if (p) teamPoints.set(g.id, { home: p.home, away: p.away });
  }
  const leaguePoints = scoringPass(games, league.scoring).averageBefore;
  const seasons = [...new Set(games.filter((g) => g.completed).map((g) => g.seasonYear))].sort();
  console.log(`  seasons on file: ${seasons.join(', ')}`);

  const fitOn = seasons.at(-2) ?? seasons[0];
  console.log(`  touchdown prior, by average miss on ${fitOn}:`);
  let best = { prior: 60, miss: Infinity };
  for (const prior of [15, 30, 60, 120, 240, 480]) {
    const rows = rowsFor({ ...league.nflPlayers, priorTouches: prior }, games, data.boxScores, data.skillBoxes, teamPoints, leaguePoints).filter((r) => r.season === fitOn);
    const miss = mean(rows.map((r) => Math.abs(r.projected - r.actual)));
    console.log(`    ${String(prior).padStart(4)} touches: ${miss.toFixed(3)} (n=${rows.length})`);
    if (miss < best.miss) best = { prior, miss };
  }
  console.log(`  using ${best.prior}`);

  const rows = rowsFor({ ...league.nflPlayers, priorTouches: best.prior }, games, data.boxScores, data.skillBoxes, teamPoints, leaguePoints);
  for (const season of seasons) {
    const inSeason = rows.filter((r) => r.season === season);
    if (!inSeason.length) continue;
    console.log(`  ${season}${season === fitOn ? ' (the prior was fitted here)' : ''}:`);
    report('everyone', inSeason);
    for (const group of ['QB', 'RB', 'WR/TE']) report(group, inSeason.filter((r) => r.group === group));
    // Who a fantasy manager is really choosing between: the players who score.
    report('8+ avg', inSeason.filter((r) => r.average >= 8));
  }

  console.log('  how far real scores land from the projection (share of the projection, players projected 8+):');
  for (const group of ['QB', 'RB', 'WR/TE']) {
    const ratios = rows.filter((r) => r.group === group && r.projected >= 8).map((r) => r.actual / r.projected);
    console.log(`    ${group.padEnd(6)} n=${String(ratios.length).padStart(5)}  10th ${quantile(ratios, 0.1).toFixed(2)}  25th ${quantile(ratios, 0.25).toFixed(2)}  median ${quantile(ratios, 0.5).toFixed(2)}  75th ${quantile(ratios, 0.75).toFixed(2)}  90th ${quantile(ratios, 0.9).toFixed(2)}`);
  }
  // Honest bias check: are projections too high or low overall?
  console.log(`  average projected ${mean(rows.map((r) => r.projected)).toFixed(2)} vs average scored ${mean(rows.map((r) => r.actual)).toFixed(2)}`);

  // Are the best players pulled too far back toward everyone else? Bias by position and tier.
  console.log('  projected vs scored, by position and how good he has been so far:');
  for (const group of ['QB', 'RB', 'WR/TE']) {
    for (const [low, high] of [[0, 8], [8, 14], [14, 20], [20, 99]]) {
      const tier = rows.filter((r) => r.group === group && r.average >= low && r.average < high);
      if (tier.length) console.log(`    ${group.padEnd(6)} avg ${String(low).padStart(2)}-${String(high).padEnd(2)} n=${String(tier.length).padStart(5)}  his average ${mean(tier.map((r) => r.average)).toFixed(2)}  projected ${mean(tier.map((r) => r.projected)).toFixed(2)}  scored ${mean(tier.map((r) => r.actual)).toFixed(2)}`);
    }
  }

  // The top backs and receivers run high. A straight-line correction per position, fitted before the last season and checked on it.
  console.log('  straight-line correction by position (scored = a + b x projected), fit before the last season:');
  const lastSeason = seasons.at(-1)!;
  const buckets = [[0, 8], [8, 12], [12, 16], [16, 20], [20, 99]];
  for (const group of ['QB', 'RB', 'WR/TE']) {
    const fit = rows.filter((r) => r.group === group && r.season < lastSeason);
    const check = rows.filter((r) => r.group === group && r.season === lastSeason);
    const mx = mean(fit.map((r) => r.raw));
    const my = mean(fit.map((r) => r.actual));
    const b = fit.reduce((s, r) => s + (r.raw - mx) * (r.actual - my), 0) / fit.reduce((s, r) => s + (r.raw - mx) ** 2, 0);
    const a = my - b * mx;
    const fixed = (r: Row) => Math.max(0, a + b * r.raw);
    const miss = (subset: Row[], f: (r: Row) => number) => mean(subset.map((r) => Math.abs(f(r) - r.actual)));
    console.log(`    ${group.padEnd(6)} a ${a.toFixed(3)} b ${b.toFixed(3)} | ${lastSeason} miss ${miss(check, (r) => r.raw).toFixed(3)} -> ${miss(check, fixed).toFixed(3)}, mean projected ${mean(check.map((r) => r.raw)).toFixed(2)} -> ${mean(check.map(fixed)).toFixed(2)}, scored ${mean(check.map((r) => r.actual)).toFixed(2)}`);
    for (const [low, high] of buckets) {
      const tier = rows.filter((r) => r.group === group && r.raw >= low && r.raw < high);
      const heldOut = tier.filter((r) => r.season === lastSeason);
      if (tier.length) console.log(`      proj ${String(low).padStart(2)}-${String(high).padEnd(2)} n=${String(tier.length).padStart(5)} projected ${mean(tier.map((r) => r.raw)).toFixed(2)} corrected ${mean(tier.map(fixed)).toFixed(2)} scored ${mean(tier.map((r) => r.actual)).toFixed(2)} | ${lastSeason} n=${heldOut.length} corrected ${mean(heldOut.map(fixed)).toFixed(2)} scored ${mean(heldOut.map((r) => r.actual)).toFixed(2)}`);
    }
  }

  // Start or sit: when one player is projected this many more than another that week, how often does he outscore him?
  console.log('  start or sit: how often the higher-projected player outscored the other, by the gap (both projected 5+, same week):');
  const gaps = [0, 1, 2, 3, 4, 6, 8, 12, 99];
  const pairStats = (subset: Row[]) => {
    const tally = gaps.slice(0, -1).map(() => ({ won: 0, n: 0 }));
    const weeks = new Map<string, Row[]>();
    for (const r of subset) if (r.projected >= 5) (weeks.get(r.week) ?? weeks.set(r.week, []).get(r.week)!).push(r);
    for (const players of weeks.values()) {
      for (let i = 0; i < players.length; i += 1) {
        for (let j = i + 1; j < players.length; j += 1) {
          const [hi, lo] = players[i].projected >= players[j].projected ? [players[i], players[j]] : [players[j], players[i]];
          const at = gaps.findIndex((g, k) => hi.projected - lo.projected >= g && hi.projected - lo.projected < gaps[k + 1]);
          if (at < 0) continue;
          tally[at].n += 1;
          tally[at].won += hi.actual > lo.actual ? 1 : hi.actual === lo.actual ? 0.5 : 0;
        }
      }
    }
    return tally;
  };
  const before = pairStats(rows.filter((r) => r.season < lastSeason));
  const held = pairStats(rows.filter((r) => r.season === lastSeason));
  gaps.slice(0, -1).forEach((g, i) => {
    console.log(`    gap ${String(g).padStart(2)}-${String(gaps[i + 1]).padEnd(2)}  before ${lastSeason}: ${((before[i].won / Math.max(1, before[i].n)) * 100).toFixed(1)}% of ${before[i].n} | ${lastSeason}: ${((held[i].won / Math.max(1, held[i].n)) * 100).toFixed(1)}% of ${held[i].n}`);
  });

  // Would mixing in his own average help? Fitted on everything before the last season, checked on the last.
  const last = seasons.at(-1)!;
  const orderOf = (subset: Row[], f: (r: Row) => number) => {
    const weeks = new Map<string, Row[]>();
    for (const r of subset) (weeks.get(`${r.week}|${r.group}`) ?? weeks.set(`${r.week}|${r.group}`, []).get(`${r.week}|${r.group}`)!).push(r);
    return mean([...weeks.values()].filter((w) => w.length >= 8).map((w) => rankCorrelation(w.map(f), w.map((r) => r.actual))));
  };
  console.log(`  mixing in his own season average (share of the projection): fit on seasons before ${last} | check on ${last}`);
  for (const share of [1, 0.85, 0.7, 0.55, 0.4, 0.25, 0]) {
    const mix = (r: Row) => share * r.projected + (1 - share) * r.average;
    const fit = rows.filter((r) => r.season < last);
    const check = rows.filter((r) => r.season === last);
    const miss = (subset: Row[]) => mean(subset.map((r) => Math.abs(mix(r) - r.actual)));
    console.log(`    ${share.toFixed(2)}  miss ${miss(fit).toFixed(3)} order ${orderOf(fit, mix).toFixed(3)} | miss ${miss(check).toFixed(3)} order ${orderOf(check, mix).toFixed(3)}`);
  }
}
