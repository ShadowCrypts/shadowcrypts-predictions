'use client';

import { useRef, useState } from 'react';
import type { CalibrationBucket } from '../../lib/model/metrics';
import { useWidth } from './useWidth';

const M = { top: 12, right: 12, bottom: 36, left: 40 };
const X_MIN = 0.5;
const Y_MIN = 0.3;
const pctLabel = (v: number) => `${Math.round(v * 100)}%`;

/**
 * Stated confidence (x) against how often those picks actually won (y).
 * Dots on the diagonal mean the percentages can be taken at face value.
 */
/** The chart's wording: game picks by default; prop lines say "lines" and "came in". */
type Words = { axis: string; units: string; hit: string };
const GAME_WORDS: Words = { axis: 'Model confidence in its pick', units: 'Games', hit: 'Won' };

export function CalibrationChart({ buckets, title, words = GAME_WORDS }: { buckets: CalibrationBucket[]; title: string; words?: Words }) {
  const box = useRef<HTMLDivElement>(null);
  const W = useWidth(box, 320);
  const H = Math.round(Math.min(280, Math.max(200, W * 0.7)));
  const [active, setActive] = useState<number | null>(null);
  const shown = buckets.filter((b) => b.games >= 5);
  const tip = active === null ? null : shown[active];

  const sx = (v: number) => M.left + ((v - X_MIN) / (1 - X_MIN)) * (W - M.left - M.right);
  const sy = (v: number) => M.top + (1 - (Math.max(Y_MIN, v) - Y_MIN) / (1 - Y_MIN)) * (H - M.top - M.bottom);

  return (
    <figure>
      <div ref={box} className="relative">
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="block max-w-full" role="img" aria-label={`${title}: stated chance versus how often it came true`}>
          {[0.3, 0.5, 0.7, 0.9].map((v) => (
            <g key={v}>
              <line x1={M.left} x2={W - M.right} y1={sy(v)} y2={sy(v)} stroke="var(--grid)" strokeWidth={1} />
              <text x={M.left - 6} y={sy(v)} dy="0.32em" textAnchor="end" fontSize={11} fill="var(--text-muted)" className="tabular">
                {pctLabel(v)}
              </text>
            </g>
          ))}
          {[0.5, 0.6, 0.7, 0.8, 0.9, 1].map((v) => (
            <text key={v} x={sx(v)} y={H - M.bottom + 15} textAnchor="middle" fontSize={11} fill="var(--text-muted)" className="tabular">
              {pctLabel(v)}
            </text>
          ))}
          <line x1={M.left} x2={W - M.right} y1={H - M.bottom} y2={H - M.bottom} stroke="var(--axis)" strokeWidth={1} />
          <text x={(M.left + W - M.right) / 2} y={H - 4} textAnchor="middle" fontSize={11} fill="var(--text-secondary)">
            {words.axis}
          </text>
          <line x1={sx(0.5)} y1={sy(0.5)} x2={sx(1)} y2={sy(1)} stroke="var(--axis)" strokeWidth={1} />
          <text x={sx(0.97)} y={sy(0.97) - 8} textAnchor="end" fontSize={11} fill="var(--text-muted)">
            perfect calibration
          </text>
          {shown.map((b, i) => (
            <g key={b.lo}>
              <circle cx={sx(b.predicted)} cy={sy(b.actual)} r={active === i ? 6 : 5} fill="var(--series-1)" stroke="var(--surface-1)" strokeWidth={2} />
              {/* Pointer target for the tooltip; keyboard and screen-reader users get the same numbers from the table below. */}
              <circle
                cx={sx(b.predicted)}
                cy={sy(b.actual)}
                r={14}
                fill="transparent"
                onPointerEnter={() => setActive(i)}
                onPointerLeave={() => setActive(null)}
                className="cursor-default"
              />
            </g>
          ))}
        </svg>
        {tip && (
          <div
            className="pointer-events-none absolute z-10 w-44 -translate-y-full rounded-lg border border-line bg-raised px-3 py-2 text-xs shadow-xl"
            style={{ left: Math.min(Math.max(sx(tip.predicted) - 88, 0), W - 176), top: sy(tip.actual) - 12 }}
          >
            <p className="text-base font-semibold text-ink tabular">
              {pctLabel(tip.actual)} {words.hit.toLowerCase()}
            </p>
            <p className="text-ink-2">
              {tip.games.toLocaleString()} {words.units.toLowerCase()} at {pctLabel(tip.lo)}–{pctLabel(tip.hi)}
            </p>
            <p className="text-ink-3">Average stated: {pctLabel(tip.predicted)}</p>
          </div>
        )}
      </div>
      <details className="mt-2 text-xs text-ink-3">
        <summary className="cursor-pointer select-none hover:text-ink-2">Show as table</summary>
        <table className="mt-2 w-full text-left tabular">
          <thead>
            <tr className="text-ink-3">
              <th className="py-1 font-medium">Confidence</th>
              <th className="py-1 font-medium">{words.units}</th>
              <th className="py-1 font-medium">Stated</th>
              <th className="py-1 font-medium">{words.hit}</th>
            </tr>
          </thead>
          <tbody className="text-ink-2">
            {buckets.map((b) => (
              <tr key={b.lo} className="border-t border-line">
                <td className="py-1">
                  {pctLabel(b.lo)}–{pctLabel(b.hi)}
                </td>
                <td className="py-1">{b.games.toLocaleString()}</td>
                <td className="py-1">{(b.predicted * 100).toFixed(1)}%</td>
                <td className="py-1">{(b.actual * 100).toFixed(1)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
