'use client';

import { pct } from '../../lib/format';
import { hitRate } from '../../lib/model/hitRate';
import { HIT_GAMES } from '../../lib/model/hitRateRecord';
import type { PropRow } from '../../lib/model/propBoard';
import { marketLabel, PropMarket } from '../../lib/props';
import { ChanceBar } from './ChanceBar';
import { HitStrip } from './HitStrip';
import { ParlayLeg, useParlay } from './parlay';
import { LineValue } from './LineValue';
import { EdgeRecord, EdgeTag, LegButton } from './PlayerProps';

type GameInfo = { league: string; id: string; label: string; start: string; state: 'pre' | 'in' | 'post' };

/**
 * One player's projections and lines for his next game, every market at once.
 * `history` is his stats in his latest games, newest first, for his last-five
 * average and his hit rate against each line.
 */
export function PlayerNextGame({ row, game, record, history = [] }: { row: PropRow; game: GameInfo; record: EdgeRecord; history?: Partial<Record<PropMarket, number>>[] }) {
  const { legs, toggle } = useParlay();
  const chosen = new Set(legs.map((l) => l.key));
  const cells = Object.entries(row.cells) as [PropMarket, NonNullable<PropRow['cells'][PropMarket]>][];
  const recentAverage = (market: PropMarket, games: number) => {
    const values = history.slice(0, games).flatMap((g) => (g[market] === undefined ? [] : [g[market]!]));
    return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
  };
  const lastFive = (market: PropMarket) => recentAverage(market, 5);
  // Before the books post: the projection next to his recent averages, without a column of dashes for each thing a line would add.
  if (!cells.some(([, cell]) => cell.line)) {
    return (
      <table className="w-full text-left text-sm tabular">
        <thead>
          <tr className="border-b border-line text-xs text-ink-3">
            <th className="py-2 pr-3 font-medium">Stat</th>
            <th className="py-2 pr-3 text-right font-medium">Proj</th>
            {history.length > 0 && (
              <>
                <th className="py-2 pr-3 text-right font-medium" title="His average over his last five games played">
                  L5
                </th>
                <th className="py-2 text-right font-medium" title={`His average over his last ${HIT_GAMES} games played`}>
                  L{HIT_GAMES}
                </th>
              </>
            )}
          </tr>
        </thead>
        <tbody>
          {cells.map(([market, cell]) => (
            <tr key={market} className="border-b border-line/60 last:border-0">
              <td className="py-2 pr-3 text-ink-2">{marketLabel(market).short}</td>
              <td className="py-2 pr-3 text-right font-semibold text-ink">{cell.projection.toFixed(1)}</td>
              {history.length > 0 && (
                <>
                  <td className="py-2 pr-3 text-right text-ink-3">{lastFive(market)?.toFixed(1) ?? '—'}</td>
                  <td className="py-2 text-right text-ink-3">{recentAverage(market, HIT_GAMES)?.toFixed(1) ?? '—'}</td>
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    );
  }
  return (
    <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <table className="w-full min-w-[480px] text-left text-sm tabular">
        <thead>
          <tr className="border-b border-line text-xs text-ink-3">
            <th className="py-2 pr-3 font-medium">Stat</th>
            <th className="py-2 pr-3 text-right font-medium">Proj</th>
            {history.length > 0 && (
              <th className="hidden py-2 pr-3 text-right font-medium sm:table-cell" title="His average over his last five games played">
                L5
              </th>
            )}
            <th className="py-2 pr-3 text-right font-medium">Line</th>
            {history.length > 0 && (
              <th className="py-2 pr-3 text-right font-medium" title="Games over this line in his last ten. On past lines, hit rates added nothing to the book's own chance">
                L10
              </th>
            )}
            <th className="py-2 pr-3 text-right font-medium">Over</th>
            <th className="hidden py-2 pr-3 text-right font-medium sm:table-cell">Model</th>
            <th className="py-2 text-right font-medium">Parlay</th>
          </tr>
        </thead>
        <tbody>
          {cells.map(([market, cell]) => {
            const line = cell.line;
            const leg = (side: 'over' | 'under'): ParlayLeg => {
              const group = `${game.league}:${game.id}:${row.id}:${market}`;
              return {
                key: `${group}:${side}`,
                group,
                league: game.league,
                gameId: game.id,
                game: game.label,
                start: game.start,
                label: `${row.name} ${side} ${line!.line} ${marketLabel(market).long}`,
                prob: side === 'over' ? line!.forecastOver : 1 - line!.forecastOver,
                price: side === 'over' ? line!.over : line!.under,
                book: line!.book,
                link: { kind: 'prop', playerId: row.id, teamId: row.teamId, market, side },
                line: line!.line
              };
            };
            return (
              <tr key={market} className="border-b border-line/60 last:border-0">
                <td className="py-2 pr-3 text-ink-2">{marketLabel(market).short}</td>
                <td className="py-2 pr-3 text-right font-semibold text-ink">{cell.projection.toFixed(1)}</td>
                {history.length > 0 && <td className="hidden py-2 pr-3 text-right text-ink-3 sm:table-cell">{lastFive(market)?.toFixed(1) ?? '—'}</td>}
                <td className="py-2 pr-3 text-right text-ink-2">{line ? <LineValue line={line.line} openLine={line.openLine} /> : '—'}</td>
                {history.length > 0 && (
                  <td className="py-2 pr-3 text-right">
                    {(() => {
                      const rate = line ? hitRate(history.map((g) => g[market]), line.line, HIT_GAMES) : null;
                      return rate ? <HitStrip rate={rate} /> : <span className="text-ink-3">—</span>;
                    })()}
                  </td>
                )}
                <td className="whitespace-nowrap py-2 pr-3 text-right">
                  {line ? (
                    <span className="inline-flex flex-col items-end">
                      <span>
                        <span className={line.forecastOver >= 0.5 ? 'font-semibold text-accent-strong' : 'text-ink-2'}>
                          {pct(line.forecastOver)}
                          {line.over === null && '*'}
                        </span>
                        {line.edge && <EdgeTag edge={line.edge} record={record} />}
                      </span>
                      <ChanceBar chance={line.forecastOver} />
                    </span>
                  ) : (
                    <span className="text-ink-3">—</span>
                  )}
                </td>
                <td className="hidden py-2 pr-3 text-right text-ink-3 sm:table-cell">{line ? pct(line.modelOver) : '—'}</td>
                <td className="py-2 text-right">
                  {line ? (
                    <span className="inline-flex gap-1.5">
                      {(['over', 'under'] as const).map((side) => {
                        const l = leg(side);
                        return (
                          <LegButton
                            key={side}
                            leg={l}
                            side={side === 'over' ? 'Over' : 'Under'}
                            price={side === 'over' ? line.over : line.under}
                            active={chosen.has(l.key)}
                            disabled={game.state !== 'pre' && !chosen.has(l.key)}
                            onToggle={toggle}
                          />
                        );
                      })}
                    </span>
                  ) : (
                    <span className="text-xs text-ink-3">No line</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
