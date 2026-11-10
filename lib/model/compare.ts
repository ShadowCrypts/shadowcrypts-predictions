import { pct } from '../format';
import type { PropMarket } from '../props';
import type { PlayerGame } from './playerLog';
import type { PropRow } from './propBoard';

/** Recent games each comparison averages. */
export const COMPARE_RECENT = 10;
/** Two-stat combos left off the comparison: they follow from the singles, and points + rebounds + assists stays. */
const SKIP: PropMarket[] = ['pr', 'pa', 'ar'];

/** One player in one stat: next game, recent and season averages, and how often he's cleared the book's line lately. */
export type StatLine = {
  next: { projection: number; line: number | null; over: number | null } | null;
  recent: { average: number; games: number } | null;
  season: { average: number; games: number } | null;
  /** Overs against the book's main line in his last `COMPARE_RECENT` games that had one, pushes left out. */
  overs: { hits: number; of: number } | null;
};

function average(games: PlayerGame[], market: PropMarket) {
  const values = games.flatMap((g) => (g.stats[market] === undefined ? [] : [g.stats[market]!]));
  return values.length ? { average: values.reduce((s, v) => s + v, 0) / values.length, games: values.length } : null;
}

/** A player's line in one stat, from his games (newest first) and his next game's row on the prop board. */
export function statLine(games: PlayerGame[], next: PropRow | null, market: PropMarket, seasonYear: number): StatLine {
  const cell = next?.cells[market];
  const recent = games.slice(0, COMPARE_RECENT);
  const lined = recent.filter((g) => g.lines[market] && g.stats[market] !== undefined && g.stats[market] !== g.lines[market]!.line);
  return {
    next: cell ? { projection: cell.projection, line: cell.line?.line ?? null, over: cell.line?.forecastOver ?? null } : null,
    recent: average(recent, market),
    season: average(
      games.filter((g) => g.seasonYear === seasonYear),
      market
    ),
    overs: lined.length ? { hits: lined.filter((g) => g.stats[market]! > g.lines[market]!.line).length, of: lined.length } : null
  };
}

/** Share of his games a player needs to log a stat in for it to be his (a quarterback's one catch isn't). */
const REGULAR = 0.25;

/** The stats worth comparing: the league's markets either player is lined in or regularly logs, combos aside. */
export function compareMarkets(markets: PropMarket[], logs: PlayerGame[][], rows: (PropRow | null)[]) {
  const his = (games: PlayerGame[], m: PropMarket) =>
    games.some((g) => g.lines[m]) || (games.length > 0 && games.filter((g) => (g.stats[m] ?? 0) > 0).length >= REGULAR * games.length);
  return markets.filter((m) => !SKIP.includes(m) && (logs.some((games) => his(games, m)) || rows.some((r) => r?.cells[m]?.line)));
}

/**
 * The player with the most similar stat line, across every stat rather than one
 * (a center who scores like a guard is still a center). Each stat's gap counts
 * against the bigger of the two values, so a rebound weighs more than a point;
 * the floor of one keeps a steal here or there from deciding it.
 */
export function mostAlike<T extends { id: string; mean: Partial<Record<PropMarket, number>> }>(target: Partial<Record<PropMarket, number>>, pool: T[], markets: PropMarket[], except: string) {
  const counted = markets.filter((m) => !SKIP.includes(m));
  const distance = (p: T) =>
    counted.reduce((sum, m) => {
      const mine = target[m] ?? 0;
      const theirs = p.mean[m] ?? 0;
      return sum + ((mine - theirs) / Math.max(1, mine, theirs)) ** 2;
    }, 0);
  let best: T | null = null;
  let bestDistance = Infinity;
  for (const p of pool) {
    if (p.id === except) continue;
    const d = distance(p);
    if (d < bestDistance) {
      best = p;
      bestDistance = d;
    }
  }
  return best;
}

/** The games the two played against each other, newest first; teammates' shared games don't count. Games come newest first. */
export function meetings(left: PlayerGame[], right: PlayerGame[]) {
  const theirs = new Map(right.map((g) => [g.gameId, g]));
  return left.flatMap((g) => {
    const other = theirs.get(g.gameId);
    return other && other.home !== g.home ? [{ left: g, right: other }] : [];
  });
}

/**
 * A player's stat over his last `slots` games, oldest to newest, right-aligned
 * so the newest game of each player lines up however many he has. Two players'
 * games fall on different dates, so the chart reads by how recent, not by when.
 */
export function recencyPoints(games: Pick<PlayerGame, 'stats'>[], market: PropMarket, slots: number): (number | null)[] {
  const newestFirst = games.slice(0, slots);
  return Array.from({ length: slots }, (_, i) => newestFirst[slots - 1 - i]?.stats[market] ?? null);
}

/** Round axis ticks from zero that clear `max`, at most four steps of 1, 2 or 5 times a power of ten. */
export function axisTicks(max: number) {
  if (!(max > 0)) return [0, 1];
  const power = 10 ** Math.floor(Math.log10(max));
  const candidates = [0.1, 0.2, 0.5, 1, 2, 5, 10].map((m) => m * power).filter((step) => step >= 1 || max < 1);
  const step = candidates.find((s) => Math.ceil(max / s) <= 4) ?? max;
  return Array.from({ length: Math.ceil(max / step) + 1 }, (_, i) => i * step);
}

/** One side of a comparison row: the value, a note under it, and the bar's length (0–1). */
export type CompareSide = { value: string; note?: string; bar: number };
export type CompareRow = { id: string; label: string; left: CompareSide; right: CompareSide; edge: 'left' | 'right' | null };

const MISSING: CompareSide = { value: '—', bar: 0 };

/**
 * The two players' lines as rows: next game's projection (with the line and the
 * over chance), the last ten, this season, and overs against the line lately.
 * Bars run against the bigger of the two; the bigger number is the row's edge.
 */
export function compareRows(left: StatLine, right: StatLine): CompareRow[] {
  const rows: CompareRow[] = [];
  const row = <T>(id: string, label: string, pick: (s: StatLine) => T | null, size: (v: T) => number, side: (v: T) => Omit<CompareSide, 'bar'>, share = false) => {
    const l = pick(left);
    const r = pick(right);
    if (l === null && r === null) return;
    const top = Math.max(l === null ? 0 : size(l), r === null ? 0 : size(r));
    const bar = (v: T) => (share ? size(v) : top > 0 ? size(v) / top : 0);
    const edge = l === null || r === null || size(l) === size(r) ? null : size(l) > size(r) ? 'left' : 'right';
    rows.push({
      id,
      label,
      left: l === null ? MISSING : { ...side(l), bar: bar(l) },
      right: r === null ? MISSING : { ...side(r), bar: bar(r) },
      edge
    });
  };
  row(
    'next',
    'Next game',
    (s) => s.next,
    (n) => n.projection,
    (n) => ({ value: n.projection.toFixed(1), note: n.line === null ? 'No line yet' : `Line ${n.line}${n.over === null ? '' : ` · ${pct(n.over)} over`}` })
  );
  row('recent', `Last ${COMPARE_RECENT}`, (s) => s.recent, (a) => a.average, (a) => ({ value: a.average.toFixed(1), note: a.games < COMPARE_RECENT ? `${a.games} games` : undefined }));
  row('season', 'This season', (s) => s.season, (a) => a.average, (a) => ({ value: a.average.toFixed(1), note: `${a.games} ${a.games === 1 ? 'game' : 'games'}` }));
  row('overs', 'Over the line', (s) => s.overs, (o) => o.hits / o.of, (o) => ({ value: `${o.hits} of ${o.of}`, note: 'Last 10' }), true);
  return rows;
}
