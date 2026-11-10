'use client';

import { useMemo, useRef, useState } from 'react';
import { injuryNews, newsText } from '../../lib/model/injuryNews';
import type { Snapshot } from '../../lib/model/movement';
import { useViewerZone } from './LocalTime';
import { useWidth } from './useWidth';

const H = 220;
const M = { top: 16, right: 16, bottom: 28, left: 44 };
const pctLabel = (v: number) => `${Math.round(v * 100)}%`;

/** Last reading at or before time t (the forecast holds between updates). */
function at(points: { t: number; s: Snapshot }[], t: number) {
  let found = points[0];
  for (const p of points) if (p.t <= t) found = p;
  return found;
}

/**
 * How the forecast moved before the game, home side up: the solid line is the
 * forecast, the dashed one the betting line's vig-free probability once posted.
 */
export function MovementChart({
  snapshots,
  start,
  asOf,
  homeAbbr,
  awayAbbr
}: {
  snapshots: Snapshot[];
  start: string;
  /** When the page was rendered; the last reading holds until then (or the start). */
  asOf: string;
  homeAbbr: string;
  awayAbbr: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const W = useWidth(box, 640);
  const [hover, setHover] = useState<number | null>(null);
  const zone = useViewerZone();
  const { tickFormat, tipFormat } = useMemo(
    () => ({
      tickFormat: new Intl.DateTimeFormat('en-US', { timeZone: zone, weekday: 'short', hour: 'numeric' }),
      tipFormat: new Intl.DateTimeFormat('en-US', { timeZone: zone, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' })
    }),
    [zone]
  );

  const points = snapshots.map((s) => ({ t: Date.parse(s.t), s }));
  const tMin = points[0].t;
  const tMax = Math.max(points[points.length - 1].t, Math.min(Date.parse(start), Date.parse(asOf)));
  const values = points.flatMap((p) => [p.s.p, p.s.line ?? p.s.p]);
  const lo = Math.max(0, Math.floor((Math.min(...values) - 0.05) * 20) / 20);
  const hi = Math.min(1, Math.ceil((Math.max(...values) + 0.05) * 20) / 20);
  const sx = (t: number) => M.left + ((t - tMin) / (tMax - tMin || 1)) * (W - M.left - M.right);
  const sy = (v: number) => M.top + (1 - (v - lo) / (hi - lo || 1)) * (H - M.top - M.bottom);
  const step = (get: (s: Snapshot) => number | null) => {
    let d = '';
    let prevY: number | null = null;
    for (const p of points) {
      const v = get(p.s);
      if (v === null) {
        prevY = null;
        continue;
      }
      const x = sx(p.t).toFixed(1);
      const y = sy(v).toFixed(1);
      d += prevY === null ? `M${x},${y}` : `H${x}V${y}`;
      prevY = Number(y);
    }
    // Hold the last value to the right edge.
    const last = [...points].reverse().find((p) => get(p.s) !== null);
    if (last && d) d += `H${sx(tMax).toFixed(1)}`;
    return d;
  };
  const ticks = [lo, (lo + hi) / 2, hi].map((v) => Math.round(v * 100) / 100);
  const timeTicks = [tMin, (tMin + tMax) / 2, tMax];
  const tip = hover === null ? null : at(points, hover);
  // Readings where a key player went out or came back since the one before.
  const events = points.flatMap((pt, i) => {
    const news = i > 0 && pt.s.out ? injuryNews(points[i - 1].s.out, pt.s.out) : null;
    return news ? [{ t: pt.t, p: pt.s.p, text: newsText(news) }] : [];
  });
  const tipEvent = tip ? events.find((e) => e.t === tip.t) : undefined;

  return (
    <figure>
      <div className="mb-2 flex flex-wrap gap-4 text-xs text-ink-2">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-0.5 w-4 rounded-full bg-accent" aria-hidden /> Forecast ({homeAbbr} win chance)
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-4 border-t-2 border-dashed border-accent-2" aria-hidden /> Betting line, margin removed
        </span>
        {events.length > 0 && (
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full border-2 border-warn bg-surface" aria-hidden /> Injury news
          </span>
        )}
      </div>
      <div ref={box} className="relative">
        <svg
          width={W}
          height={H}
          viewBox={`0 0 ${W} ${H}`}
          className="block max-w-full touch-pan-y"
          role="img"
          aria-label={`Forecast for ${homeAbbr} moved from ${pctLabel(points[0].s.p)} to ${pctLabel(points[points.length - 1].s.p)} over ${points.length} updates`}
          onPointerMove={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const x = ((e.clientX - rect.left) / rect.width) * W;
            setHover(tMin + ((x - M.left) / (W - M.left - M.right)) * (tMax - tMin));
          }}
          onPointerLeave={() => setHover(null)}
        >
          {ticks.map((v) => (
            <g key={v}>
              <line x1={M.left} x2={W - M.right} y1={sy(v)} y2={sy(v)} stroke="var(--grid)" strokeWidth={1} />
              <text x={M.left - 8} y={sy(v)} dy="0.32em" textAnchor="end" fontSize={11} fill="var(--text-muted)">
                {pctLabel(v)}
              </text>
            </g>
          ))}
          {lo < 0.5 && hi > 0.5 && <line x1={M.left} x2={W - M.right} y1={sy(0.5)} y2={sy(0.5)} stroke="var(--axis)" strokeDasharray="4 4" />}
          {timeTicks.map((t, i) => (
            <text key={i} x={sx(t)} y={H - 8} textAnchor={i === 0 ? 'start' : i === 2 ? 'end' : 'middle'} fontSize={11} fill="var(--text-muted)">
              {tickFormat.format(new Date(t))}
            </text>
          ))}
          <path d={step((s) => s.line)} fill="none" stroke="var(--series-2)" strokeWidth={2} strokeDasharray="5 4" />
          <path d={step((s) => s.p)} fill="none" stroke="var(--series-1)" strokeWidth={2.5} strokeLinejoin="round" />
          {events.map((e) => (
            <circle key={e.t} cx={sx(e.t)} cy={sy(e.p)} r={5} fill="var(--surface-1)" stroke="rgb(var(--warn))" strokeWidth={2.5} />
          ))}
          {hover !== null && tip && (
            <g>
              <line x1={sx(Math.max(tMin, Math.min(tMax, hover)))} x2={sx(Math.max(tMin, Math.min(tMax, hover)))} y1={M.top} y2={H - M.bottom} stroke="var(--axis)" />
              <circle cx={sx(Math.max(tMin, Math.min(tMax, hover)))} cy={sy(tip.s.p)} r={4} fill="var(--series-1)" stroke="var(--surface-1)" strokeWidth={2} />
            </g>
          )}
        </svg>
        {hover !== null && tip && (
          <div
            className="pointer-events-none absolute top-0 z-10 w-48 rounded-lg border border-line bg-raised px-3 py-2 text-xs shadow-xl"
            style={sx(hover) > W / 2 ? { right: `${100 - (sx(hover) / W) * 100 + 2}%` } : { left: `${(sx(hover) / W) * 100 + 2}%` }}
          >
            <p className="text-ink-3">{tipFormat.format(new Date(tip.t))}</p>
            <p className="mt-0.5 font-semibold text-ink tabular">
              Forecast {tip.s.p >= 0.5 ? homeAbbr : awayAbbr} {pctLabel(Math.max(tip.s.p, 1 - tip.s.p))}
            </p>
            <p className="text-ink-2 tabular">{tip.s.line === null ? 'No line yet' : `Line ${tip.s.line >= 0.5 ? homeAbbr : awayAbbr} ${pctLabel(Math.max(tip.s.line, 1 - tip.s.line))}`}</p>
            {tipEvent && <p className="mt-1 font-medium text-warn">{tipEvent.text}</p>}
          </div>
        )}
      </div>
      {events.length > 0 && (
        <figcaption className="mt-3 space-y-1 text-xs text-ink-2">
          {events.slice(-4).map((e) => (
            <p key={e.t} className="flex gap-2">
              <span className="shrink-0 text-ink-3 tabular">{tipFormat.format(new Date(e.t))}</span>
              <span>
                {e.text} · forecast {homeAbbr} {pctLabel(e.p)}
              </span>
            </p>
          ))}
        </figcaption>
      )}
    </figure>
  );
}
