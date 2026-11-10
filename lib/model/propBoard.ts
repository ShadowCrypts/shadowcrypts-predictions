import { fairOver, mainLines, PropLine, PropMarket } from '../props';
import { Actuals, GameProjection, modelEdge, overChance, PropModelParams, propForecast } from './propModel';

export type PropCell = {
  projection: number;
  /** The real number, once the game is final. */
  actual: number | null;
  line: {
    line: number;
    /** American prices; null when the book posted the line without them. */
    over: number | null;
    under: number | null;
    book: string;
    /** The book's over chance, its margin removed. */
    bookOver: number;
    /** Our model's over chance on its own. */
    modelOver: number;
    /** What the site forecasts: the book's number with the model's small weight. */
    forecastOver: number;
    /** The side our model likes by 10+ points over the price, if any. */
    edge: { side: 'over' | 'under'; edge: number } | null;
    /** Where the line opened, when the book has moved it since (null if it hasn't, or the feed didn't keep it). */
    openLine?: number | null;
  } | null;
};

export type PropRow = { id: string; name: string; teamId: string; detail: string; available: number; cells: Partial<Record<PropMarket, PropCell>> };

export type PropBoard = { rows: PropRow[]; markets: PropMarket[]; book: string | null };

/** One game's player projections next to the books' lines (and the results, once final). */
export function propBoard(
  params: PropModelParams,
  leagueMarkets: PropMarket[],
  projection: GameProjection,
  lines: PropLine[] | null,
  actuals: Actuals | null
): PropBoard {
  const main = mainLines(lines ?? []);
  const byPlayer = new Map<string, Map<PropMarket, PropLine>>();
  for (const l of main) {
    const m = byPlayer.get(l.athleteId) ?? new Map<PropMarket, PropLine>();
    m.set(l.market, l);
    byPlayer.set(l.athleteId, m);
  }
  const offered = new Set(main.map((l) => l.market));
  // The book's markets in this league's order; before lines post, the ones we project.
  const markets = offered.size ? leagueMarkets.filter((m) => offered.has(m)) : leagueMarkets;
  const rows: PropRow[] = [];
  for (const p of [...projection.home, ...projection.away]) {
    const listed = byPlayer.get(p.id);
    if (!p.featured && !listed) continue;
    const played = actuals?.get(p.id);
    const cells: PropRow['cells'] = {};
    for (const market of markets) {
      const mean = p.mean[market];
      if (mean === undefined) continue;
      const line = listed?.get(market) ?? null;
      const modelOver = line ? overChance(params, market, mean, line.line) : 0;
      cells[market] = {
        projection: mean,
        actual: played?.[market] ?? null,
        line: line
          ? {
              line: line.line,
              over: line.over,
              under: line.under,
              book: line.book,
              bookOver: fairOver(line),
              modelOver,
              forecastOver: propForecast(params, market, mean, line),
              edge: modelEdge(modelOver, line),
              openLine: line.open && line.open.line !== line.line ? line.open.line : null
            }
          : null
      };
    }
    if (Object.keys(cells).length) rows.push({ id: p.id, name: p.name, teamId: p.teamId, detail: p.detail, available: p.available, cells });
  }
  return { rows, markets: markets.filter((m) => rows.some((r) => r.cells[m])), book: main[0]?.book ?? null };
}
