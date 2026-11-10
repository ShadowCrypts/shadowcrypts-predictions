'use client';

import { useId, useRef, useState } from 'react';
import type { FlowPoint } from '../../lib/model/live';
import { useWidth } from './useWidth';

const H = 220;
const M = { top: 18, right: 16, bottom: 28, left: 44 };
// Only the final point is certain; anything earlier never reads as 0% or 100%.
const pctLabel = (v: number) => (v > 0.99 && v < 1 ? '>99%' : v < 0.01 && v > 0 ? '<1%' : `${Math.round(v * 100)}%`);

/** Home win probability through a game, one point per finished period. Above the midline favors the home team. */
export function WinProbChart({ points, homeAbbr, awayAbbr }: { points: FlowPoint[]; homeAbbr: string; awayAbbr: string }) {
  const box = useRef<HTMLDivElement>(null);
  const W = useWidth(box, 640);
  const id = useId().replace(/:/g, '');
  const [active, setActive] = useState<number | null>(null);

  const sx = (i: number) => M.left + (i / Math.max(1, points.length - 1)) * (W - M.left - M.right);
  const sy = (p: number) => M.top + (1 - p) * (H - M.top - M.bottom);
  const mid = sy(0.5);
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${sx(i).toFixed(1)},${sy(p.homeProb).toFixed(1)}`).join('');
  const area = `${line}L${sx(points.length - 1).toFixed(1)},${mid}L${sx(0).toFixed(1)},${mid}Z`;
  const tip = active === null ? null : points[active];

  return (
    <figure>
      <div ref={box} className="relative">
        <svg
          width={W}
          height={H}
          viewBox={`0 0 ${W} ${H}`}
          className="block max-w-full"
          role="img"
          aria-label={`Win probability through the game: ${points.map((p) => `${p.label} ${homeAbbr} ${pctLabel(p.homeProb)}`).join(', ')}`}
        >
          <defs>
            <clipPath id={`${id}-top`}>
              <rect x={0} y={0} width={W} height={mid} />
            </clipPath>
            <clipPath id={`${id}-bottom`}>
              <rect x={0} y={mid} width={W} height={H - mid} />
            </clipPath>
          </defs>
          {[0, 0.25, 0.75, 1].map((v) => (
            <line key={v} x1={M.left} x2={W - M.right} y1={sy(v)} y2={sy(v)} stroke="var(--grid)" strokeWidth={1} />
          ))}
          <line x1={M.left} x2={W - M.right} y1={mid} y2={mid} stroke="var(--axis)" strokeWidth={1} strokeDasharray="4 4" />
          <text x={M.left - 8} y={sy(1)} dy="0.32em" textAnchor="end" fontSize={11} fontWeight={600} fill="var(--text-secondary)">
            {homeAbbr}
          </text>
          <text x={M.left - 8} y={sy(0.75)} dy="0.32em" textAnchor="end" fontSize={11} fill="var(--text-muted)">
            75%
          </text>
          <text x={M.left - 8} y={mid} dy="0.32em" textAnchor="end" fontSize={11} fill="var(--text-muted)">
            50%
          </text>
          <text x={M.left - 8} y={sy(0.25)} dy="0.32em" textAnchor="end" fontSize={11} fill="var(--text-muted)">
            75%
          </text>
          <text x={M.left - 8} y={sy(0)} dy="0.32em" textAnchor="end" fontSize={11} fontWeight={600} fill="var(--text-secondary)">
            {awayAbbr}
          </text>
          <path d={area} fill="var(--series-1)" fillOpacity={0.16} clipPath={`url(#${id}-top)`} />
          <path d={area} fill="var(--series-2)" fillOpacity={0.16} clipPath={`url(#${id}-bottom)`} />
          <path d={line} fill="none" stroke="var(--text-secondary)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          {points.map((p, i) => (
            <g key={p.label + i}>
              <circle
                cx={sx(i)}
                cy={sy(p.homeProb)}
                r={active === i ? 6 : 4}
                fill={p.homeProb >= 0.5 ? 'var(--series-1)' : 'var(--series-2)'}
                stroke="var(--surface-1)"
                strokeWidth={2}
              />
              <text x={sx(i)} y={H - 8} textAnchor="middle" fontSize={11} fill={active === i ? 'var(--text-secondary)' : 'var(--text-muted)'}>
                {p.label}
              </text>
              {/* Pointer target for the tooltip; the chart's label reads every point for screen readers. */}
              <rect
                x={sx(i) - 18}
                y={M.top}
                width={36}
                height={H - M.top - M.bottom}
                fill="transparent"
                onPointerEnter={() => setActive(i)}
                onPointerLeave={() => setActive(null)}
              />
            </g>
          ))}
        </svg>
        {tip && (
          <div
            className="pointer-events-none absolute z-10 w-40 rounded-lg border border-line bg-raised px-3 py-2 text-xs shadow-xl"
            style={{ left: Math.min(Math.max(sx(active!) - 80, 0), W - 160), top: Math.max(0, sy(tip.homeProb) - 78) }}
          >
            <p className="text-ink-3">{tip.label === 'Start' ? 'Pregame forecast' : tip.label === 'Final' ? 'Final' : `After ${tip.label}`}</p>
            {tip.label !== 'Start' && (
              <p className="tabular text-ink-2">
                {awayAbbr} {tip.awayScore} – {homeAbbr} {tip.homeScore}
              </p>
            )}
            <p className="mt-0.5 font-semibold text-ink tabular">
              {tip.homeProb >= 0.5 ? homeAbbr : awayAbbr} {pctLabel(Math.max(tip.homeProb, 1 - tip.homeProb))}
            </p>
          </div>
        )}
      </div>
    </figure>
  );
}
