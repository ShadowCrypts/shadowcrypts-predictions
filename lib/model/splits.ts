import type { PropMarket } from '../props';
import type { PlayerGame } from './playerLog';

/** A season's games before its home and road splits stand on their own; until then they include last season too. */
const SPLIT_MIN_GAMES = 10;

export type SplitRow = { id: string; label: string; games: number; averages: Partial<Record<PropMarket, number>> };

function row(id: string, label: string, games: PlayerGame[], markets: PropMarket[]): SplitRow | null {
  if (!games.length) return null;
  const averages: SplitRow['averages'] = {};
  for (const m of markets) {
    const values = games.flatMap((g) => (g.stats[m] === undefined ? [] : [g.stats[m]!]));
    if (values.length) averages[m] = values.reduce((s, v) => s + v, 0) / values.length;
  }
  return { id, label, games: games.length, averages };
}

/**
 * A player's averages cut several ways, from his games on file (newest first):
 * this season, last season, his last ten, and at home and on the road. Early
 * in a season the home and road rows reach back into last season, and `scope`
 * says which they cover. Neutral-site games sit in neither.
 */
export function playerSplits(games: PlayerGame[], markets: PropMarket[], seasonYear: number) {
  const season = games.filter((g) => g.seasonYear === seasonYear);
  const last = games.filter((g) => g.seasonYear === seasonYear - 1);
  const scoped = season.length >= SPLIT_MIN_GAMES;
  const venue = scoped ? season : [...season, ...last];
  const rows = [
    row('season', 'This season', season, markets),
    row('last', 'Last season', last, markets),
    row('recent', 'Last 10', games.slice(0, 10), markets),
    row('home', 'At home', venue.filter((g) => g.home && !g.neutral), markets),
    row('road', 'On the road', venue.filter((g) => !g.home && !g.neutral), markets)
  ].flatMap((r) => (r ? [r] : []));
  return { rows, scope: scoped ? ('this season' as const) : ('this season and last' as const) };
}
