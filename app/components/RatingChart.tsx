'use client';

import { useMemo, useRef, useState } from 'react';
import { useWidth } from './useWidth';

type Point = { date: string; rating: number };
type Series = { label: string; points: Point[]; color: string };

const H = 240;
const M = { top: 12, right: 16, bottom: 26, left: 44 };
/** The second team's line is dashed: two teams' colors can look alike to a color-blind reader. */
const SECOND = 1;
const monthFormat = new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: 'America/New_York' });
const dayFormat = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/New_York' });

/** Last known rating at or before time t (ratings are step values between games). */
function valueAt(points: { t: number; rating: number }[], t: number) {
  let lo = 0;
  let hi = points.length - 1;
  if (hi < 0 || points[0].t > t) return null;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (points[mid].t <= t) lo = mid;
    else hi = mid - 1;
  }
  return points[lo].rating;
}

export function RatingChart({ series }: { series: Series[] }) {
  const ref = useRef<SVGSVGElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const W = useWidth(box, 640);
  const [hoverT, setHoverT] = useState<number | null>(null);

  const prepared = useMemo(() => series.map((s) => ({ ...s, pts: s.points.map((p) => ({ t: Date.parse(p.date), rating: p.rating })) })), [series]);
  const all = prepared.flatMap((s) => s.pts);
  if (all.length < 2) {
    return (
      <div ref={box} className="text-sm text-ink-3">
        Not enough games yet to chart.
      </div>
    );
  }

  const tMin = Math.min(...all.map((p) => p.t));
  const tMax = Math.max(...all.map((p) => p.t));
  const rMin = Math.floor((Math.min(...all.map((p) => p.rating)) - 10) / 50) * 50;
  const rMax = Math.ceil((Math.max(...all.map((p) => p.rating)) + 10) / 50) * 50;
  const sx = (t: number) => M.left + ((t - tMin) / (tMax - tMin || 1)) * (W - M.left - M.right);
  const sy = (r: number) => M.top + (1 - (r - rMin) / (rMax - rMin || 1)) * (H - M.top - M.bottom);
  const ticks: number[] = [];
  const step = rMax - rMin > 300 ? 100 : 50;
  for (let r = rMin; r <= rMax; r += step) ticks.push(r);
  const showAverage = rMin < 1500 && rMax > 1500;

  const monthTicks: number[] = [];
  const cursor = new Date(tMin);
  cursor.setUTCDate(1);
  cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  while (cursor.getTime() <= tMax) {
    monthTicks.push(cursor.getTime());
    // Roughly one label per 90px keeps month names from colliding on phones.
    const monthsAcross = (tMax - tMin) / (30 * 86_400_000);
    cursor.setUTCMonth(cursor.getUTCMonth() + Math.max(1, Math.ceil(monthsAcross / Math.max(1, (W - M.left - M.right) / 90))));
  }

  const path = (pts: { t: number; rating: number }[]) =>
    pts.map((p, i) => `${i ? 'H' + sx(p.t).toFixed(1) + 'V' : 'M' + sx(p.t).toFixed(1) + ','}${sy(p.rating).toFixed(1)}`).join('');

  const onMove = (event: React.PointerEvent<SVGSVGElement>) => {
    const box = ref.current?.getBoundingClientRect();
    if (!box) return;
    const x = ((event.clientX - box.left) / box.width) * W;
    const t = tMin + ((x - M.left) / (W - M.left - M.right)) * (tMax - tMin);
    setHoverT(Math.max(tMin, Math.min(tMax, t)));
  };

  return (
    <figure>
      <div className="mb-2 flex flex-wrap gap-4 text-xs text-ink-2">
        {series.map((s, i) => (
          <span key={s.label} className="inline-flex items-center gap-1.5">
            <span className="w-4 border-t-2" style={{ borderColor: s.color, borderTopStyle: i === SECOND ? 'dashed' : 'solid' }} aria-hidden />
            {s.label}
          </span>
        ))}
      </div>
      <div ref={box} className="relative">
        <svg
          ref={ref}
          width={W}
          height={H}
          viewBox={`0 0 ${W} ${H}`}
          className="block max-w-full touch-pan-y"
          role="img"
          aria-label={`Elo rating history for ${series.map((s) => s.label).join(' and ')}`}
          onPointerMove={onMove}
          onPointerLeave={() => setHoverT(null)}
        >
          {ticks.map((r) => (
            <g key={r}>
              <line x1={M.left} x2={W - M.right} y1={sy(r)} y2={sy(r)} stroke="var(--grid)" strokeWidth={1} />
              <text x={M.left - 8} y={sy(r)} dy="0.32em" textAnchor="end" fontSize={11} fill="var(--text-muted)" className="tabular">
                {r}
              </text>
            </g>
          ))}
          {showAverage && (
            <g>
              <line x1={M.left} x2={W - M.right} y1={sy(1500)} y2={sy(1500)} stroke="var(--axis)" strokeWidth={1} strokeDasharray="4 4" />
              <text x={W - M.right} y={sy(1500) - 5} textAnchor="end" fontSize={10} fill="var(--text-muted)">
                league average
              </text>
            </g>
          )}
          {monthTicks.map((t) => (
            <text key={t} x={sx(t)} y={H - 6} textAnchor="middle" fontSize={11} fill="var(--text-muted)">
              {monthFormat.format(new Date(t))}
            </text>
          ))}
          {prepared.map((s, i) => (
            <path key={s.label} d={path(s.pts)} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" strokeDasharray={i === SECOND ? '6 4' : undefined} />
          ))}
          {prepared.map((s) => {
            const last = s.pts[s.pts.length - 1];
            return last ? <circle key={s.label} cx={sx(last.t)} cy={sy(last.rating)} r={4} fill={s.color} stroke="var(--surface-1)" strokeWidth={2} /> : null;
          })}
          {hoverT !== null && (
            <g>
              <line x1={sx(hoverT)} x2={sx(hoverT)} y1={M.top} y2={H - M.bottom} stroke="var(--axis)" strokeWidth={1} />
              {prepared.map((s) => {
                const v = valueAt(s.pts, hoverT);
                return v === null ? null : <circle key={s.label} cx={sx(hoverT)} cy={sy(v)} r={4} fill={s.color} stroke="var(--surface-1)" strokeWidth={2} />;
              })}
            </g>
          )}
        </svg>
        {hoverT !== null && (
          <div
            className="pointer-events-none absolute top-0 z-10 w-40 rounded-lg border border-line bg-raised px-3 py-2 text-xs shadow-xl"
            style={sx(hoverT) > W / 2 ? { right: `${100 - (sx(hoverT) / W) * 100 + 2}%` } : { left: `${(sx(hoverT) / W) * 100 + 2}%` }}
          >
            <p className="mb-1 text-ink-3">{dayFormat.format(new Date(hoverT))}</p>
            {prepared.map((s, i) => {
              const v = valueAt(s.pts, hoverT);
              return (
                <p key={s.label} className="flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1.5 text-ink-2">
                    <span className="w-3 border-t-2" style={{ borderColor: s.color, borderTopStyle: i === SECOND ? 'dashed' : 'solid' }} aria-hidden />
                    {s.label}
                  </span>
                  <span className="font-semibold text-ink tabular">{v === null ? '—' : Math.round(v)}</span>
                </p>
              );
            })}
          </div>
        )}
      </div>
    </figure>
  );
}
