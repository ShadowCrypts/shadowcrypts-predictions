'use client';

import { useId, useRef, useState } from 'react';
import type { PlayPoint } from '../../lib/model/turningPoints';
import { useWidth } from './useWidth';

const H = 240;
const M = { top: 18, right: 16, bottom: 28, left: 44 };
// Only the final point is certain; anything earlier never reads as 0% or 100%.
const pctLabel = (v: number) => (v > 0.99 && v < 1 ? '>99%' : v < 0.01 && v > 0 ? '<1%' : `${Math.round(v * 100)}%`);

/**
 * Home win probability through a game, after every scoring play, placed on the
 * game clock: a step line that holds between scores, with the period breaks
 * marked. Above the midline favors the home team. `end` is how far the game
 * has gone (1 at the end of regulation; less while it's on).
 */
export function PlayFlowChart({
  points,
  end,
  periods,
  periodName,
  homeAbbr,
  awayAbbr,
  colors
}: {
  points: PlayPoint[];
  end: number;
  periods: number;
  periodName: string;
  homeAbbr: string;
  awayAbbr: string;
  colors: { home: string; away: string };
}) {
  const box = useRef<HTMLDivElement>(null);
  const W = useWidth(box, 640);
  const id = useId().replace(/:/g, '');
  const [active, setActive] = useState<number | null>(null);

  const xMax = Math.max(1, end, points[points.length - 1]?.x ?? 0);
  const sx = (x: number) => M.left + (x / xMax) * (W - M.left - M.right);
  const sy = (p: number) => M.top + (1 - p) * (H - M.top - M.bottom);
  const mid = sy(0.5);
  // A step line: each chance holds until the next score, then to where the game is now.
  let line = `M${sx(0).toFixed(1)},${sy(points[0].homeProb).toFixed(1)}`;
  for (const p of points.slice(1)) line += `H${sx(p.x).toFixed(1)}V${sy(p.homeProb).toFixed(1)}`;
  line += `H${sx(Math.max(end, points[points.length - 1].x)).toFixed(1)}`;
  const area = `${line}V${mid}H${sx(0).toFixed(1)}Z`;
  const breaks = Array.from({ length: Math.ceil(xMax * periods) - 1 }, (_, i) => (i + 1) / periods);
  const tip = active === null ? null : points[active];

  const pick = (clientX: number, rect: DOMRect) => {
    const x = (((clientX - rect.left) / rect.width) * W - M.left) / (W - M.left - M.right) * xMax;
    // The last score at or before the pointer.
    let found = 0;
    points.forEach((p, i) => {
      if (p.x <= x) found = i;
    });
    setActive(found);
  };

  return (
    <figure>
      <div className="mb-2 flex flex-wrap gap-4 text-xs text-ink-2">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-4 rounded-full" style={{ background: colors.home }} aria-hidden /> {homeAbbr} favored
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-4 rounded-full" style={{ background: colors.away }} aria-hidden /> {awayAbbr} favored
        </span>
        <span className="text-ink-3">{points.length - 1} scoring plays</span>
      </div>
      <div ref={box} className="relative">
        <svg
          width={W}
          height={H}
          viewBox={`0 0 ${W} ${H}`}
          className="block max-w-full touch-pan-y"
          role="img"
          aria-label={`${homeAbbr} win chance after every score: from ${pctLabel(points[0].homeProb)} before the game to ${pctLabel(points[points.length - 1].homeProb)} after the last one`}
          onPointerMove={(e) => pick(e.clientX, e.currentTarget.getBoundingClientRect())}
          onPointerLeave={() => setActive(null)}
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
          {breaks.map((b) => (
            <line key={b} x1={sx(b)} x2={sx(b)} y1={M.top} y2={H - M.bottom} stroke="var(--grid)" strokeWidth={1} />
          ))}
          {Array.from({ length: Math.ceil(xMax * periods) }, (_, i) => (
            <text key={i} x={sx((i + 0.5) / periods)} y={H - 8} textAnchor="middle" fontSize={11} fill="var(--text-muted)">
              {i < periods ? `${periodName}${i + 1}` : 'OT'}
            </text>
          ))}
          <text x={M.left - 8} y={sy(1)} dy="0.32em" textAnchor="end" fontSize={11} fontWeight={600} fill="var(--text-secondary)">
            {homeAbbr}
          </text>
          <text x={M.left - 8} y={mid} dy="0.32em" textAnchor="end" fontSize={11} fill="var(--text-muted)">
            50%
          </text>
          <text x={M.left - 8} y={sy(0)} dy="0.32em" textAnchor="end" fontSize={11} fontWeight={600} fill="var(--text-secondary)">
            {awayAbbr}
          </text>
          <path d={area} fill={colors.home} fillOpacity={0.22} clipPath={`url(#${id}-top)`} />
          <path d={area} fill={colors.away} fillOpacity={0.22} clipPath={`url(#${id}-bottom)`} />
          <path d={line} fill="none" stroke="var(--text-secondary)" strokeWidth={1.75} strokeLinejoin="round" />
          {tip && (
            <g>
              <line x1={sx(tip.x)} x2={sx(tip.x)} y1={M.top} y2={H - M.bottom} stroke="var(--axis)" />
              <circle cx={sx(tip.x)} cy={sy(tip.homeProb)} r={5} fill={tip.homeProb >= 0.5 ? colors.home : colors.away} stroke="var(--surface-1)" strokeWidth={2} />
            </g>
          )}
        </svg>
        {tip && (
          <div
            className="pointer-events-none absolute top-0 z-10 w-56 rounded-lg border border-line bg-raised px-3 py-2 text-xs shadow-xl"
            style={sx(tip.x) > W / 2 ? { right: `${100 - (sx(tip.x) / W) * 100 + 2}%` } : { left: `${(sx(tip.x) / W) * 100 + 2}%` }}
          >
            <p className="text-ink-3">{tip.label}</p>
            <p className="mt-0.5 line-clamp-2 text-ink-2">{tip.text}</p>
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
