'use client';

import { useId } from 'react';
import { pctCapped } from '../../lib/format';
import { AnimatedNumber } from './AnimatedNumber';

/**
 * A chance as a ring that fills clockwise, with the number in the middle;
 * both glide when it changes. `tone` colors it for a win, a loss or neither.
 */
export function ChanceRing({
  value,
  size = 112,
  label,
  tone = 'accent',
  caption = 'to cash',
  decimals = 0
}: {
  value: number | null;
  size?: number;
  label: string;
  tone?: 'accent' | 'good' | 'bad';
  /** The small word under the number. */
  caption?: string;
  /** Decimal places on the percentage (0 shows unsettled extremes as ">99%"). */
  decimals?: number;
}) {
  const format = decimals ? (v: number) => `${(v * 100).toFixed(decimals)}%` : pctCapped;
  // Each ring its own gradient id, made safe for url(#…).
  const gradient = `ring${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const stroke = Math.round(size / 11);
  const r = (size - stroke) / 2;
  const around = 2 * Math.PI * r;
  const color = tone === 'good' ? 'rgb(var(--good))' : tone === 'bad' ? 'rgb(var(--bad))' : `url(#${gradient})`;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} role="img" aria-label={`${label}: ${value === null ? 'not known yet' : format(value)}`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" aria-hidden>
        <defs>
          <linearGradient id={gradient} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="rgb(var(--accent))" />
            <stop offset="100%" stopColor="rgb(var(--accent-2))" />
          </linearGradient>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgb(var(--track))" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={around.toFixed(2)}
          strokeDashoffset={(around * (1 - Math.max(0, Math.min(1, value ?? 0)))).toFixed(2)}
          style={{ transition: 'stroke-dashoffset 0.9s cubic-bezier(0.22, 1, 0.36, 1)' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-display font-bold tabular text-ink" style={{ fontSize: Math.round(size / 4.4) }}>
          {value === null ? '—' : <AnimatedNumber value={value} format={format} />}
        </span>
        <span className="text-[10px] font-medium uppercase tracking-wider text-ink-3">{caption}</span>
      </div>
    </div>
  );
}
