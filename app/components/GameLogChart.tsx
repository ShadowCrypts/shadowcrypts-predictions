'use client';

import { useState } from 'react';
import { marketLabel, PropMarket } from '../../lib/props';

/** `date` like "Oct 26", `opponent` like "vs GS" or "@ OKC". */
export type LogGame = { gameId: string; date: string; opponent: string; stats: Partial<Record<PropMarket, number>>; line: Partial<Record<PropMarket, number>> };

const W = 640;
const H = 200;
const PAD = { top: 16, right: 12, bottom: 34, left: 34 };

/**
 * A player's recent games in one stat, oldest to newest: a bar per game,
 * green over that game's line and red under it (gray with no line on file),
 * the line itself as a tick, and his next game's line across the chart.
 */
export function GameLogChart({ games, markets, next }: { games: LogGame[]; markets: PropMarket[]; next: Partial<Record<PropMarket, number>> }) {
  const [market, setMarket] = useState<PropMarket>(markets[0]);
  if (!markets.length || games.length < 2) return null;
  const shown = [...games].reverse();
  const values = shown.map((g) => g.stats[market] ?? 0);
  const lines = shown.map((g) => g.line[market]);
  const ahead = next[market];
  const top = Math.max(1, ...values, ...lines.map((l) => l ?? 0), ahead ?? 0) * 1.12;
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const slot = plotW / shown.length;
  const barW = Math.min(36, slot * 0.62);
  const y = (v: number) => PAD.top + plotH - (v / top) * plotH;
  const ticks = [0, top / 2, top].map((v) => Math.round(v));
  const lined = shown.filter((_, i) => lines[i] !== undefined && values[i] !== lines[i]);
  const overs = lined.filter((g) => (g.stats[market] ?? 0) > g.line[market]!).length;
  const summary = `${marketLabel(market).short} in his last ${shown.length} games: ${values.join(', ')}${lined.length ? `; over the line in ${overs} of ${lined.length}` : ''}${ahead !== undefined ? `; next game's line ${ahead}` : ''}.`;

  return (
    <div className="space-y-3">
      <div className="scrollbar-none -mx-1 flex gap-1.5 overflow-x-auto px-1" role="group" aria-label="Stat to chart">
        {markets.map((m) => (
          <button key={m} type="button" onClick={() => setMarket(m)} aria-pressed={m === market} className={`chip shrink-0 ${m === market ? 'chip-active' : 'chip-idle'}`}>
            {marketLabel(m).short}
          </button>
        ))}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={summary}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} stroke="rgb(var(--line))" strokeWidth={1} />
            <text x={PAD.left - 6} y={y(t) + 4} textAnchor="end" fontSize={11} fill="rgb(var(--ink-3))">
              {t}
            </text>
          </g>
        ))}
        {shown.map((g, i) => {
          const v = values[i];
          const l = lines[i];
          const cx = PAD.left + slot * i + slot / 2;
          const tone = l === undefined || v === l ? 'rgb(var(--ink-3))' : v > l ? 'rgb(var(--good))' : 'rgb(var(--bad))';
          return (
            <g key={g.gameId}>
              {/* Keyed by stat, so switching stats replays the rise. */}
              <rect
                key={market}
                className="bar-rise"
                style={{ '--i': i } as React.CSSProperties}
                x={cx - barW / 2}
                y={y(v)}
                width={barW}
                height={Math.max(1, y(0) - y(v))}
                rx={3}
                fill={tone}
                opacity={0.85}
              />
              {l !== undefined && <line x1={cx - barW / 2 - 3} x2={cx + barW / 2 + 3} y1={y(l)} y2={y(l)} stroke="rgb(var(--ink))" strokeWidth={2} />}
              <text x={cx} y={y(v) - 4} textAnchor="middle" fontSize={11} fontWeight={600} fill="rgb(var(--ink))">
                {v}
              </text>
              <text x={cx} y={H - PAD.bottom + 14} textAnchor="middle" fontSize={10} fill="rgb(var(--ink-3))">
                {g.date}
              </text>
              <text x={cx} y={H - PAD.bottom + 26} textAnchor="middle" fontSize={10} fill="rgb(var(--ink-3))">
                {g.opponent}
              </text>
            </g>
          );
        })}
        {ahead !== undefined && (
          <g>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(ahead)} y2={y(ahead)} stroke="rgb(var(--accent-strong))" strokeWidth={1.5} strokeDasharray="5 4" />
            <text x={W - PAD.right} y={11} textAnchor="end" fontSize={11} fontWeight={600} fill="rgb(var(--accent-strong))">
              - - Next line {ahead}
            </text>
          </g>
        )}
      </svg>
      <p className="text-xs text-ink-3">
        Bars are what he did; the dark tick is that game&apos;s line (green went over, red under); the dashed line is his next game&apos;s line.
      </p>
    </div>
  );
}
