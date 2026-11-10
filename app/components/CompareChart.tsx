'use client';

import { useRef, useState } from 'react';
import { axisTicks, recencyPoints } from '../../lib/model/compare';
import { marketLabel, PropMarket } from '../../lib/props';
import { useWidth } from './useWidth';

/** `date` like "Oct 26", `opponent` like "vs GS" or "@ OKC". */
export type CompareGame = { gameId: string; date: string; opponent: string; stats: Partial<Record<PropMarket, number>> };
/** One player: his games newest first. */
export type CompareSeries = { name: string; color: string; games: CompareGame[] };

const H = 240;
const M = { top: 14, right: 40, bottom: 26, left: 36 };
/** Closest two end values can sit and still both be labeled (pixels). */
const LABEL_GAP = 16;

/** Solid with circles against dashed with squares: team colors can clash for color-blind readers, so shape tells them apart too. */
const STYLE = [{ dash: undefined, shape: 'circle' }, { dash: '6 4', shape: 'square' }] as const;

const newest = (games: CompareGame[], slots: number, slot: number) => games[slots - 1 - slot];

function Marker({ shape, x, y, color, ring = true }: { shape: 'circle' | 'square'; x: number; y: number; color: string; ring?: boolean }) {
  const stroke = ring ? { stroke: 'var(--surface-1)', strokeWidth: 2 } : {};
  return shape === 'circle' ? <circle cx={x} cy={y} r={4} fill={color} {...stroke} /> : <rect x={x - 4} y={y - 4} width={8} height={8} rx={1.5} fill={color} {...stroke} />;
}

/** The little line-and-marker that keys a player, in the legend and the tooltip. */
function Key({ index, color }: { index: number; color: string }) {
  const { dash, shape } = STYLE[index];
  return (
    <svg width={22} height={10} viewBox="0 0 22 10" className="shrink-0" aria-hidden>
      <line x1={0} x2={22} y1={5} y2={5} stroke={color} strokeWidth={2} strokeDasharray={dash ? '4 2' : undefined} />
      <Marker shape={shape} x={11} y={5} color={color} ring={false} />
    </svg>
  );
}

/**
 * Two players' last games in one stat, on one axis, lined up by how recent each
 * game was (their dates differ). Move across for the games at that point; the
 * table underneath holds every number.
 */
export function CompareChart({ series, markets, slots = 10 }: { series: [CompareSeries, CompareSeries]; markets: PropMarket[]; slots?: number }) {
  const box = useRef<HTMLDivElement>(null);
  const W = useWidth(box, 640);
  const [market, setMarket] = useState<PropMarket>(markets[0]);
  const [active, setActive] = useState<number | null>(null);

  const points = series.map((s) => recencyPoints(s.games, market, slots));
  const ticks = axisTicks(Math.max(0, ...points.flat().map((v) => v ?? 0)));
  const top = ticks[ticks.length - 1];
  const sx = (i: number) => M.left + (slots < 2 ? 0 : (i / (slots - 1)) * (W - M.left - M.right));
  const sy = (v: number) => M.top + (1 - v / top) * (H - M.top - M.bottom);
  const ago = (i: number) => (i === slots - 1 ? 'Latest game' : `${slots - 1 - i} ${slots - 1 - i === 1 ? 'game' : 'games'} ago`);
  // A missing game breaks the line rather than bridging it.
  const path = (values: (number | null)[]) => {
    let d = '';
    values.forEach((v, i) => {
      if (v === null) return;
      d += `${i > 0 && values[i - 1] !== null ? 'L' : 'M'}${sx(i).toFixed(1)},${sy(v).toFixed(1)}`;
    });
    return d;
  };
  const ends = points.map((values) => values[slots - 1]);
  // End values only when they don't run into each other; the tooltip and table carry them otherwise.
  const labelEnds = ends[0] === null || ends[1] === null || Math.abs(sy(ends[0]) - sy(ends[1])) >= LABEL_GAP;
  const label = marketLabel(market).long;
  const tipLeft = active !== null && sx(active) <= W / 2;

  const pick = (clientX: number, rect: DOMRect) => {
    const x = ((clientX - rect.left) / rect.width) * W;
    setActive(Math.max(0, Math.min(slots - 1, Math.round(((x - M.left) / (W - M.left - M.right)) * (slots - 1)))));
  };

  return (
    <figure className="space-y-3">
      <div className="scrollbar-none -mx-1 flex gap-1.5 overflow-x-auto px-1" role="group" aria-label="Stat to chart">
        {markets.map((m) => (
          <button key={m} type="button" onClick={() => setMarket(m)} aria-pressed={m === market} className={`chip shrink-0 ${m === market ? 'chip-active' : 'chip-idle'}`}>
            {marketLabel(m).short}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-2">
        {series.map((s, i) => (
          <span key={s.name} className="inline-flex items-center gap-1.5">
            <Key index={i} color={s.color} /> {s.name}
          </span>
        ))}
      </div>
      <div ref={box} className="relative">
        <svg
          width={W}
          height={H}
          viewBox={`0 0 ${W} ${H}`}
          className="block max-w-full touch-pan-y rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          role="img"
          tabIndex={0}
          aria-label={`${label} over the last ${slots} games. ${series.map((s, i) => `${s.name}: ${points[i].filter((v) => v !== null).join(', ')}`).join('. ')}. Oldest first. Left and right arrow keys step through the games.`}
          onPointerMove={(e) => pick(e.clientX, e.currentTarget.getBoundingClientRect())}
          onPointerLeave={() => setActive(null)}
          onFocus={() => setActive((a) => a ?? slots - 1)}
          onBlur={() => setActive(null)}
          onKeyDown={(e) => {
            if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
            e.preventDefault();
            setActive((a) => Math.max(0, Math.min(slots - 1, (a ?? slots - 1) + (e.key === 'ArrowLeft' ? -1 : 1))));
          }}
        >
          {ticks.map((t) => (
            <g key={t}>
              <line x1={M.left} x2={W - M.right} y1={sy(t)} y2={sy(t)} stroke={t === 0 ? 'var(--axis)' : 'var(--grid)'} strokeWidth={1} />
              <text x={M.left - 8} y={sy(t)} dy="0.32em" textAnchor="end" fontSize={11} fill="var(--text-muted)">
                {t.toLocaleString()}
              </text>
            </g>
          ))}
          <text x={M.left} y={H - 8} fontSize={11} fill="var(--text-muted)">
            {slots - 1} games ago
          </text>
          <text x={W - M.right} y={H - 8} textAnchor="end" fontSize={11} fill="var(--text-muted)">
            Latest
          </text>
          {active !== null && <line x1={sx(active)} x2={sx(active)} y1={M.top} y2={H - M.bottom} stroke="var(--axis)" strokeWidth={1} />}
          {series.map((s, i) => (
            <g key={s.name}>
              <path d={path(points[i])} fill="none" stroke={s.color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={STYLE[i].dash} />
              {points[i].map((v, slot) => (v === null ? null : <Marker key={slot} shape={STYLE[i].shape} x={sx(slot)} y={sy(v)} color={s.color} />))}
            </g>
          ))}
          {labelEnds &&
            ends.map((v, i) =>
              v === null ? null : (
                <text key={series[i].name} x={W - M.right + 9} y={sy(v)} dy="0.32em" fontSize={12} fontWeight={600} fill="rgb(var(--ink))" className="tabular">
                  {v}
                </text>
              )
            )}
        </svg>
        {active !== null && (
          <div
            className="pointer-events-none absolute top-0 z-10 w-48 rounded-lg border border-line bg-raised px-3 py-2 text-xs shadow-xl"
            style={tipLeft ? { left: `${(sx(active) / W) * 100 + 2}%` } : { right: `${100 - (sx(active) / W) * 100 + 2}%` }}
          >
            <p className="mb-1 text-ink-3">{ago(active)}</p>
            {series.map((s, i) => {
              const game = newest(s.games, slots, active);
              const value = points[i][active];
              return (
                <p key={s.name} className="flex items-center gap-1.5 py-0.5">
                  <Key index={i} color={s.color} />
                  <span className="font-semibold text-ink tabular">{value ?? '—'}</span>
                  <span className="min-w-0 truncate text-ink-3">{game ? `${game.date} ${game.opponent}` : 'No game'}</span>
                </p>
              );
            })}
          </div>
        )}
      </div>
      <details className="text-sm">
        <summary className="cursor-pointer text-xs text-ink-2 hover:text-ink">See every game as a table</summary>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[420px] text-left text-sm tabular">
            <caption className="sr-only">
              {label}, the last {slots} games of each, newest first
            </caption>
            <thead>
              <tr className="border-b border-line text-xs text-ink-3">
                <th scope="col" className="py-2 pr-3 font-medium">
                  Game
                </th>
                {series.map((s) => (
                  <th key={s.name} scope="col" className="py-2 pr-3 font-medium" colSpan={2}>
                    {s.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: slots }, (_, i) => slots - 1 - i).map((slot) => (
                <tr key={slot} className="border-b border-line/60 last:border-0">
                  <th scope="row" className="whitespace-nowrap py-1.5 pr-3 font-normal text-ink-3">
                    {ago(slot)}
                  </th>
                  {series.map((s, i) => {
                    const game = newest(s.games, slots, slot);
                    return [
                      <td key={`${s.name}-v`} className="py-1.5 pr-2 font-semibold text-ink">
                        {points[i][slot] ?? '—'}
                      </td>,
                      <td key={`${s.name}-g`} className="whitespace-nowrap py-1.5 pr-3 text-xs text-ink-3">
                        {game ? `${game.date} ${game.opponent}` : ''}
                      </td>
                    ];
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
