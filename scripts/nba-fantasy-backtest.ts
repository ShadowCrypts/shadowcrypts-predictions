/**
 * Fantasy basketball: do the projections rank a night's players better than the
 * obvious thing, his average so far? For every NBA regular-season game on file,
 * each player's projected fantasy points (from earlier games only) against what he
 * scored, next to two baselines a fan could work out alone: his season average and
 * his last five games. Only players who played are scored, since the projections
 * for past games know who dressed. Ranges, a start-or-sit table and a straight-line
 * correction for the page come from here. Run through `npm run backtest -- --fantasy --league=nba`.
 */
import type { BoxScore, NflSkillBox } from '../lib/boxscores';
import type { Game, MarketOdds, TeamInfo } from '../lib/espn';
import type { LeagueConfig } from '../lib/leagues';
import { computeLeagueModel } from '../lib/model';
import { rankCorrelation } from '../lib/model/fantasy';
import { nbaActualLine, nbaFantasyPoints, nbaProjectedLine } from '../lib/model/nbaFantasy';
import { nbaPlayerPass } from '../lib/model/nbaPlayers';
import { scoringPass } from '../lib/model/scoring';
import { etDateKey } from '../lib/time';

const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / Math.max(1, xs.length);
const quantile = (xs: number[], q: number) => {
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0;
};

type Row = { season: number; day: string; id: string; projected: number; minutes: number; average: number; last5: number; actual: number; games: number };

/** A player's first few games of a season leave the baselines nothing fair to go on. */
const MIN_GAMES = 5;

export async function nbaFantasyBacktest(
  league: LeagueConfig,
  data: { games: Game[]; teams: TeamInfo[]; closingOdds: Record<string, MarketOdds | null>; boxScores: Record<string, BoxScore | null>; skillBoxes: Record<string, NflSkillBox | null> }
) {
  if (!league.players || !league.lineups) return;
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
  const projected = nbaPlayerPass(games, data.boxScores, league.players, league.lineups, { teamPoints, leaguePoints }, { rosters: {}, injuries: {} }, (g) => g.completed && g.seasonType === 2);

  const history = new Map<string, { season: number; points: number }[]>();
  const rows: Row[] = [];
  for (const g of games) {
    const box = data.boxScores[g.id];
    if (!g.completed || g.seasonType !== 2 || box?.league !== 'nba') continue;
    const actual = new Map(Object.values(box.teams).flat().filter((l) => l.min > 0).map((l) => [l.id, nbaFantasyPoints(nbaActualLine(l))]));
    const p = projected.get(g.id);
    if (p) {
      for (const player of [...p.home, ...p.away]) {
        const scored = actual.get(player.id);
        const past = (history.get(player.id) ?? []).filter((h) => h.season === g.seasonYear);
        if (scored === undefined || past.length < MIN_GAMES) continue;
        rows.push({
          season: g.seasonYear,
          day: etDateKey(g.date),
          id: player.id,
          projected: nbaFantasyPoints(nbaProjectedLine(player)),
          minutes: Number.parseFloat(player.detail) || 0,
          average: mean(past.map((h) => h.points)),
          last5: mean(past.slice(-5).map((h) => h.points)),
          actual: scored,
          games: past.length
        });
      }
    }
    for (const [id, points] of actual) (history.get(id) ?? history.set(id, []).get(id)!).push({ season: g.seasonYear, points });
  }

  const seasons = [...new Set(rows.map((r) => r.season))].sort();
  const lastSeason = seasons.at(-1)!;
  console.log(`  seasons on file: ${seasons.join(', ')} (${rows.length.toLocaleString()} player-games)`);

  const byDay = (subset: Row[]) => {
    const days = new Map<string, Row[]>();
    for (const r of subset) (days.get(r.day) ?? days.set(r.day, []).get(r.day)!).push(r);
    return [...days.values()].filter((d) => d.length >= 8);
  };
  const orderOf = (subset: Row[], f: (r: Row) => number) => mean(byDay(subset).map((d) => rankCorrelation(d.map(f), d.map((r) => r.actual))));
  const report = (label: string, subset: Row[]) => {
    const mae = (f: (r: Row) => number) => mean(subset.map((r) => Math.abs(f(r) - r.actual)));
    console.log(
      `    ${label.padEnd(10)} n=${String(subset.length).padStart(6)}  average miss: projected ${mae((r) => r.projected).toFixed(2)}, season average ${mae((r) => r.average).toFixed(2)}, last 5 ${mae((r) => r.last5).toFixed(2)} | order within a night: projected ${orderOf(subset, (r) => r.projected).toFixed(3)}, season average ${orderOf(subset, (r) => r.average).toFixed(3)}, last 5 ${orderOf(subset, (r) => r.last5).toFixed(3)}`
    );
  };
  for (const season of seasons) {
    const inSeason = rows.filter((r) => r.season === season);
    console.log(`  ${season}:`);
    report('everyone', inSeason);
    report('20+ avg', inSeason.filter((r) => r.average >= 20));
  }

  console.log(`  average projected ${mean(rows.map((r) => r.projected)).toFixed(2)} vs average scored ${mean(rows.map((r) => r.actual)).toFixed(2)}`);
  console.log('  projected vs scored, by projection:');
  const tiers = [[0, 10], [10, 20], [20, 30], [30, 40], [40, 50], [50, 999]];
  for (const [low, high] of tiers) {
    const tier = rows.filter((r) => r.projected >= low && r.projected < high);
    const held = tier.filter((r) => r.season === lastSeason);
    if (tier.length) console.log(`    proj ${String(low).padStart(2)}-${String(high).padEnd(3)} n=${String(tier.length).padStart(6)}  projected ${mean(tier.map((r) => r.projected)).toFixed(2)} scored ${mean(tier.map((r) => r.actual)).toFixed(2)} his average ${mean(tier.map((r) => r.average)).toFixed(2)} | ${lastSeason} n=${held.length} projected ${mean(held.map((r) => r.projected)).toFixed(2)} scored ${mean(held.map((r) => r.actual)).toFixed(2)}`);
  }

  // A straight-line correction, fitted before the last season and checked on it.
  const fit = rows.filter((r) => r.season < lastSeason);
  const check = rows.filter((r) => r.season === lastSeason);
  const mx = mean(fit.map((r) => r.projected));
  const my = mean(fit.map((r) => r.actual));
  const b = fit.reduce((s, r) => s + (r.projected - mx) * (r.actual - my), 0) / fit.reduce((s, r) => s + (r.projected - mx) ** 2, 0);
  const a = my - b * mx;
  const fixed = (r: Row) => Math.max(0, a + b * r.projected);
  const miss = (subset: Row[], f: (r: Row) => number) => mean(subset.map((r) => Math.abs(f(r) - r.actual)));
  console.log(`  straight-line correction (scored = a + b x projected) fit before ${lastSeason}: a ${a.toFixed(3)} b ${b.toFixed(3)} | ${lastSeason} miss ${miss(check, (r) => r.projected).toFixed(3)} -> ${miss(check, fixed).toFixed(3)}`);

  console.log(`  mixing in his own season average (share of the projection): fit on seasons before ${lastSeason} | check on ${lastSeason}`);
  for (const share of [1, 0.85, 0.7, 0.55, 0.4]) {
    const mix = (r: Row) => share * r.projected + (1 - share) * r.average;
    console.log(`    ${share.toFixed(2)}  miss ${miss(fit, mix).toFixed(3)} order ${orderOf(fit, mix).toFixed(3)} | miss ${miss(check, mix).toFixed(3)} order ${orderOf(check, mix).toFixed(3)}`);
  }

  console.log('  how far real scores land from the projection (share of the projection), by projection:');
  for (const [low, high] of [[5, 15], [15, 25], [25, 35], [35, 999], [15, 999]]) {
    const ratios = rows.filter((r) => r.projected >= low && r.projected < high).map((r) => r.actual / r.projected);
    console.log(`    proj ${String(low).padStart(2)}-${String(high).padEnd(3)} n=${String(ratios.length).padStart(6)}  10th ${quantile(ratios, 0.1).toFixed(2)}  25th ${quantile(ratios, 0.25).toFixed(2)}  median ${quantile(ratios, 0.5).toFixed(2)}  75th ${quantile(ratios, 0.75).toFixed(2)}  90th ${quantile(ratios, 0.9).toFixed(2)}`);
  }

  // Start or sit: on the same night, when one player is projected this many more than another, how often does he outscore him?
  console.log('  start or sit: how often the higher-projected player outscored the other, by the gap (both projected 15+, same night):');
  const gaps = [0, 2, 4, 6, 8, 10, 15, 20, 999];
  const pairStats = (subset: Row[]) => {
    const tally = gaps.slice(0, -1).map(() => ({ won: 0, n: 0 }));
    const days = new Map<string, Row[]>();
    for (const r of subset) if (r.projected >= 15) (days.get(r.day) ?? days.set(r.day, []).get(r.day)!).push(r);
    for (const players of days.values()) {
      for (let i = 0; i < players.length; i += 1) {
        for (let j = i + 1; j < players.length; j += 1) {
          const [hi, lo] = players[i].projected >= players[j].projected ? [players[i], players[j]] : [players[j], players[i]];
          const gap = hi.projected - lo.projected;
          const at = gaps.findIndex((g, k) => gap >= g && gap < gaps[k + 1]);
          if (at < 0) continue;
          tally[at].n += 1;
          tally[at].won += hi.actual > lo.actual ? 1 : hi.actual === lo.actual ? 0.5 : 0;
        }
      }
    }
    return tally;
  };
  const before = pairStats(fit);
  const held = pairStats(check);
  const all = pairStats(rows);
  gaps.slice(0, -1).forEach((g, i) => {
    const pct = (t: { won: number; n: number }) => `${((t.won / Math.max(1, t.n)) * 100).toFixed(1)}% of ${t.n}`;
    console.log(`    gap ${String(g).padStart(2)}-${String(gaps[i + 1]).padEnd(3)}  all: ${pct(all[i])} | before ${lastSeason}: ${pct(before[i])} | ${lastSeason}: ${pct(held[i])}`);
  });
}
