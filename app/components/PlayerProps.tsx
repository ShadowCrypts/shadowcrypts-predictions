'use client';

import { Check, Plus, X } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { pct, pctCapped } from '../../lib/format';
import type { LiveCell, LiveProps } from '../../lib/model/gameLiveProps';
import { formatAmerican } from '../../lib/model/market';
import type { PropBoard, PropCell } from '../../lib/model/propBoard';
import { marketLabel, PropMarket } from '../../lib/props';
import { hitRate } from '../../lib/model/hitRate';
import { HIT_GAMES } from '../../lib/model/hitRateRecord';
import { ChanceBar } from './ChanceBar';
import { HitStrip } from './HitStrip';
import { LineValue } from './LineValue';
import { ParlayLeg, useParlay } from './parlay';
import { PlayerPhoto } from './PlayerPhoto';

type Team = { id: string; abbr: string; color?: string };
type GameInfo = { league: string; id: string; label: string; start: string; state: 'pre' | 'in' | 'post' };

export function LegButton({ leg, side, price, active, disabled, onToggle }: { leg: ParlayLeg; side: 'Over' | 'Under'; price: number | null; active: boolean; disabled: boolean; onToggle: (leg: ParlayLeg) => void }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onToggle(leg)}
      aria-pressed={active}
      // "O" alone says nothing to a screen reader: name the bet itself (pressed reads as "in your parlay").
      aria-label={`${leg.label}${price !== null ? `, ${formatAmerican(price)}` : ''}`}
      title={active ? 'Remove from your parlay' : `Add ${side.toLowerCase()} to your parlay`}
      className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium tabular ring-1 transition disabled:cursor-not-allowed disabled:opacity-40 ${
        active ? 'bg-accent/15 text-ink ring-accent/60' : 'text-ink-2 ring-line hover:text-ink hover:ring-line-strong'
      }`}
    >
      {active ? <Check className="h-3 w-3" aria-hidden /> : <Plus className="h-3 w-3" aria-hidden />}
      {side === 'Over' ? 'O' : 'U'}
      {price !== null && ` ${formatAmerican(price)}`}
    </button>
  );
}

function Result({ cell }: { cell: PropCell }) {
  if (cell.actual === null) return <span className="text-ink-3">—</span>;
  if (!cell.line) return <span className="tabular text-ink">{cell.actual}</span>;
  const over = cell.actual > cell.line.line;
  const push = cell.actual === cell.line.line;
  return (
    <span className="inline-flex items-center gap-1.5 tabular">
      <span className="font-semibold text-ink">{cell.actual}</span>
      <span className={`text-xs ${push ? 'text-ink-3' : over ? 'text-good' : 'text-bad'}`}>{push ? 'push' : over ? 'over' : 'under'}</span>
    </span>
  );
}

/** A prop while its game is on: the stat so far, a bar toward the line, and the live chance of the over. */
function LiveNow({ now, line }: { now: LiveCell | undefined; line: number | null }) {
  if (!now || now.current === null) {
    return (
      <span className="text-xs text-ink-3" title="Not in the box score yet. Books void a player who never plays.">
        not in yet
      </span>
    );
  }
  const { current, over } = now;
  const hit = over === 1;
  return (
    <span className="inline-flex flex-col items-end gap-1">
      <span className="inline-flex items-baseline gap-1.5 tabular">
        <span className="font-semibold text-ink">{current}</span>
        {over !== null && (
          <span className={`text-xs ${hit ? 'font-semibold text-good' : over >= 0.5 ? 'text-accent-strong' : 'text-ink-3'}`} title="Chance the over hits from here">
            {hit ? 'over hit' : `${pctCapped(over)} over`}
          </span>
        )}
      </span>
      {line !== null && line > 0 && (
        <span className="block h-1 w-16 overflow-hidden rounded-full bg-track" aria-hidden>
          <span className={`block h-full rounded-full ${hit ? 'bg-good' : 'bg-accent'}`} style={{ width: `${Math.min(100, (current / line) * 100).toFixed(1)}%` }} />
        </span>
      )}
    </span>
  );
}

export type EdgeRecord = { league: string; bets: number; won: number; returnPerBet: number } | null;

/** "Model leans under", with how lines like it have done in this league. */
export function EdgeTag({ edge, record }: { edge: NonNullable<NonNullable<PropCell['line']>['edge']>; record: EdgeRecord }) {
  const profitable = record && record.bets >= 200 && record.returnPerBet > 0;
  const history = record?.bets
    ? `In the ${record.league}, bets on lines where our model disagreed this much won ${pct(record.won / record.bets)} and returned ${record.returnPerBet >= 0 ? '+' : '−'}${Math.abs(record.returnPerBet * 100).toFixed(1)}% a bet over ${record.bets.toLocaleString()} graded lines. Past results, not a promise.`
    : 'Not enough graded lines yet to say how these do.';
  return (
    <span
      title={`Our model's ${edge.side} chance beats the price by ${Math.round(edge.edge * 100)} points. ${history}`}
      className={`ml-1.5 inline-block rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${profitable ? 'bg-good/15 text-good' : 'bg-raised text-ink-3 ring-1 ring-line'}`}
    >
      model: {edge.side}
    </span>
  );
}

/**
 * One game's player projections next to the sportsbook's lines, a market at a
 * time. Over chances follow the book's own number with its margin removed,
 * plus the model's small fitted weight, because the book was the more
 * accurate of the two on every league's graded lines.
 */
export function PlayerProps({
  board,
  teams,
  game,
  record,
  live = null,
  recent = null,
  logs = null
}: {
  board: PropBoard;
  teams: { home: Team; away: Team };
  game: GameInfo;
  record: EdgeRecord;
  /** While the game is on: each player's stat so far and the live chance of each over. */
  live?: LiveProps | null;
  /** Before it: each player's average over his last five games, by market. */
  recent?: Record<string, Partial<Record<PropMarket, number>>> | null;
  /** Before it: each player's stats in his last ten games, newest first, for hit rates against each line. */
  logs?: Record<string, Partial<Record<PropMarket, number>>[]> | null;
}) {
  const [market, setMarket] = useState<PropMarket>(board.markets[0]);
  const [team, setTeam] = useState<'all' | 'home' | 'away'>('all');
  const { legs, toggle } = useParlay();
  const chosen = new Set(legs.map((l) => l.key));
  const teamOf = (teamId: string) => (teamId === teams.home.id ? teams.home : teams.away);
  const rows = board.rows
    .filter((r) => team === 'all' || r.teamId === teams[team].id)
    .filter((r) => r.cells[market])
    .sort((a, b) => b.cells[market]!.projection - a.cells[market]!.projection);
  const final = game.state === 'post';
  const open = game.state === 'pre';
  const tracking = game.state === 'in' && live !== null;

  const legFor = (row: PropBoard['rows'][number], cell: PropCell, side: 'over' | 'under'): ParlayLeg => {
    const line = cell.line!;
    const group = `${game.league}:${game.id}:${row.id}:${market}`;
    return {
      key: `${group}:${side}`,
      group,
      league: game.league,
      gameId: game.id,
      game: game.label,
      start: game.start,
      label: `${row.name} ${side} ${line.line} ${marketLabel(market).long}`,
      prob: side === 'over' ? line.forecastOver : 1 - line.forecastOver,
      price: side === 'over' ? line.over : line.under,
      book: line.book,
      link: { kind: 'prop', playerId: row.id, teamId: row.teamId, market, side },
      line: line.line
    };
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="scrollbar-none -mx-1 flex gap-1.5 overflow-x-auto px-1" role="group" aria-label="Stat">
          {board.markets.map((m) => (
            <button key={m} type="button" onClick={() => setMarket(m)} aria-pressed={m === market} className={`chip shrink-0 ${m === market ? 'chip-active' : 'chip-idle'}`}>
              {marketLabel(m).short}
            </button>
          ))}
        </div>
        <div className="flex rounded-full bg-surface p-0.5 ring-1 ring-line" role="group" aria-label="Team">
          {(['all', 'away', 'home'] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTeam(t)}
              aria-pressed={team === t}
              className={`rounded-full px-3 py-1 text-xs font-medium transition ${team === t ? 'bg-raised text-ink ring-1 ring-line-strong' : 'text-ink-3 hover:text-ink'}`}
            >
              {t === 'all' ? 'Both' : teams[t].abbr}
            </button>
          ))}
        </div>
      </div>

      {tracking && (
        <p className="flex items-center gap-2 text-xs text-ink-2">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-live" aria-hidden />
          <span>
            <span className="font-semibold text-live">Live</span> · {live.status}. Each stat so far from ESPN&apos;s box score, and the chance its over hits from
            here: the pregame line and chance, the time left, the pace so far and the score, the model tracked parlays use. Updates with the page.
          </span>
        </p>
      )}
      <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <table className="w-full min-w-[440px] text-left text-sm tabular sm:min-w-[560px]">
          <thead>
            <tr className="border-b border-line text-xs text-ink-3">
              <th className="py-2 pr-3 font-medium">Player</th>
              <th className="hidden py-2 pr-3 text-right font-medium sm:table-cell" title="Expected role: minutes, or targets and carries">
                Role
              </th>
              <th className="py-2 pr-3 text-right font-medium">Proj</th>
              {recent && (
                <th className="hidden py-2 pr-3 text-right font-medium sm:table-cell" title="His average over his last five games played">
                  L5
                </th>
              )}
              <th className="py-2 pr-3 text-right font-medium">Line</th>
              {logs && (
                <th className="hidden py-2 pr-3 text-right font-medium sm:table-cell" title="Games over this line in his last ten. On past lines, hit rates added nothing to the book's own chance">
                  L10
                </th>
              )}
              <th className="py-2 pr-3 text-right font-medium" title="Chance of the over: the book's own number with its margin removed, nudged by our model">
                Over
              </th>
              <th className="hidden py-2 pr-3 text-right font-medium sm:table-cell" title="Our model's over chance on its own">Model</th>
              <th className="py-2 text-right font-medium">{final ? 'Result' : tracking ? 'Now' : 'Parlay'}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const cell = r.cells[market]!;
              const line = cell.line;
              return (
                <tr key={r.id} className="border-b border-line/60 last:border-0">
                  <td className="py-2 pr-3">
                    <span className="flex max-w-[12.5rem] items-center gap-2 sm:max-w-none">
                      <PlayerPhoto league={game.league} id={r.id} name={r.name} size={26} ring={teamOf(r.teamId).color} />
                      <Link href={`/${game.league}/player/${r.id}`} className="truncate font-medium text-ink hover:underline">
                        {r.name}
                      </Link>
                      <span className="shrink-0 text-xs text-ink-3">{teamOf(r.teamId).abbr}</span>
                      {r.available < 1 && (
                        <span className="shrink-0 rounded-full bg-warn/15 px-1.5 py-0.5 text-[10px] font-semibold text-warn" title="Chance of playing, from the injury report">
                          {pct(r.available)} to play
                        </span>
                      )}
                    </span>
                  </td>
                  <td className="hidden whitespace-nowrap py-2 pr-3 text-right text-xs text-ink-3 sm:table-cell">{r.detail}</td>
                  <td className="py-2 pr-3 text-right font-semibold text-ink">{cell.projection.toFixed(1)}</td>
                  {recent && <td className="hidden py-2 pr-3 text-right text-ink-3 sm:table-cell">{recent[r.id]?.[market]?.toFixed(1) ?? '—'}</td>}
                  <td className="py-2 pr-3 text-right text-ink-2">{line ? <LineValue line={line.line} openLine={line.openLine} /> : '—'}</td>
                  {logs && (
                    <td className="hidden py-2 pr-3 text-right sm:table-cell">
                      {(() => {
                        const rate = line ? hitRate((logs[r.id] ?? []).map((g) => g[market]), line.line, HIT_GAMES) : null;
                        return rate ? <HitStrip rate={rate} /> : <span className="text-ink-3">—</span>;
                      })()}
                    </td>
                  )}
                  <td className="whitespace-nowrap py-2 pr-3 text-right">
                    {line ? (
                      <span className="inline-flex flex-col items-end">
                        <span>
                          <span
                            className={line.forecastOver >= 0.5 ? 'font-semibold text-accent-strong' : 'text-ink-2'}
                            title={line.over === null ? `${line.book} posted this line without prices, so it's read as their 50/50 point` : undefined}
                          >
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
                    {final ? (
                      <Result cell={cell} />
                    ) : tracking ? (
                      <LiveNow now={live.cells[r.id]?.[market]} line={line?.line ?? null} />
                    ) : line ? (
                      <span className="inline-flex gap-1.5">
                        {(['over', 'under'] as const).map((side) => {
                          const leg = legFor(r, cell, side);
                          return (
                            <LegButton
                              key={side}
                              leg={leg}
                              side={side === 'over' ? 'Over' : 'Under'}
                              price={side === 'over' ? line.over : line.under}
                              active={chosen.has(leg.key)}
                              disabled={!open && !chosen.has(leg.key)}
                              onToggle={toggle}
                            />
                          );
                        })}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs text-ink-3" title="No line from the book for this player">
                        <X className="h-3 w-3" aria-hidden /> No line
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {!rows.length && <p className="text-sm text-ink-3">No projections for this stat yet.</p>}
      {board.rows.some((r) => Object.values(r.cells).some((c) => c?.line && c.line.over === null)) && (
        <p className="text-xs text-ink-3">
          * {board.book ?? 'The book'} lists these lines in ESPN&apos;s feed without prices, so each is read as the book&apos;s 50/50 point, the
          chance leans only slightly toward our model, and a parlay can&apos;t show what the book would pay for them.
        </p>
      )}
    </div>
  );
}
