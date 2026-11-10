import type { OddsPoint } from '../../lib/model/oddsHistory';
import { formatShortDate } from '../../lib/time';

const W = 640;
const H = 180;
const M = { top: 12, right: 12, bottom: 24, left: 36 };

/** A team's playoff chances, one reading a day, as a line in its color on a 0–100% scale. */
export function OddsChart({ points, color, label }: { points: OddsPoint[]; color: string; label: string }) {
  const x = (i: number) => M.left + (points.length === 1 ? 0 : (i / (points.length - 1)) * (W - M.left - M.right));
  const y = (p: number) => M.top + (1 - p) * (H - M.top - M.bottom);
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.playoffs).toFixed(1)}`).join('');
  const area = `${line}L${x(points.length - 1).toFixed(1)},${y(0).toFixed(1)}L${x(0).toFixed(1)},${y(0).toFixed(1)}Z`;
  const first = points[0];
  const last = points[points.length - 1];
  const gradient = `odds-${label.replace(/[^a-z0-9]/gi, '')}`;
  return (
    <figure className="max-w-3xl">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="block h-auto w-full"
        role="img"
        aria-label={`${label}: playoff chances went from ${Math.round(first.playoffs * 100)}% on ${formatShortDate(`${first.date}T16:00:00Z`)} to ${Math.round(last.playoffs * 100)}% on ${formatShortDate(`${last.date}T16:00:00Z`)}`}
      >
        <defs>
          <linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.35} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        {[0, 0.5, 1].map((v) => (
          <g key={v}>
            <line x1={M.left} x2={W - M.right} y1={y(v)} y2={y(v)} stroke="var(--grid)" strokeDasharray={v === 0.5 ? '4 4' : undefined} />
            <text x={M.left - 6} y={y(v)} dy="0.32em" textAnchor="end" fontSize={11} fill="var(--text-muted)">
              {Math.round(v * 100)}%
            </text>
          </g>
        ))}
        <path d={area} fill={`url(#${gradient})`} />
        <path d={line} fill="none" stroke={color} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={x(points.length - 1)} cy={y(last.playoffs)} r={4} fill={color} stroke="var(--surface-1)" strokeWidth={2} />
        <text x={M.left} y={H - 6} fontSize={11} fill="var(--text-muted)">
          {formatShortDate(`${first.date}T16:00:00Z`)}
        </text>
        <text x={W - M.right} y={H - 6} textAnchor="end" fontSize={11} fill="var(--text-muted)">
          {formatShortDate(`${last.date}T16:00:00Z`)}
        </text>
      </svg>
    </figure>
  );
}
