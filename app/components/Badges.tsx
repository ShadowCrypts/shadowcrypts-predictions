import { Check, X } from 'lucide-react';
import type { Band } from '../../lib/model/metrics';

const BAND_LEVEL: Record<Band, number> = { Strong: 3, Solid: 2, Lean: 1, 'Toss-up': 0 };

/** Confidence band; the bar count carries the level so it never relies on color alone. */
export function BandChip({ band }: { band: Band }) {
  const level = BAND_LEVEL[band];
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-raised px-2 py-0.5 text-xs font-medium text-ink-2 ring-1 ring-line">
      <span className="flex items-end gap-[2px]" aria-hidden>
        {[1, 2, 3].map((i) => (
          <span key={i} className={`w-[3px] rounded-full ${i <= level ? 'bg-accent' : 'bg-track'}`} style={{ height: 4 + i * 2 }} />
        ))}
      </span>
      {band}
    </span>
  );
}

export function ResultBadge({ correct }: { correct: boolean | null }) {
  if (correct === null) return null;
  return correct ? (
    <span className="inline-flex items-center gap-1 rounded-full bg-good/15 py-0.5 pl-0.5 pr-2 text-xs font-semibold text-good">
      <span className="flex h-4 w-4 items-center justify-center rounded-full bg-good">
        <Check className="h-3 w-3 text-surface" strokeWidth={3.5} aria-hidden />
      </span>
      Hit
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-full bg-bad/15 py-0.5 pl-0.5 pr-2 text-xs font-semibold text-bad">
      <span className="flex h-4 w-4 items-center justify-center rounded-full bg-bad">
        <X className="h-3 w-3 text-surface" strokeWidth={3.5} aria-hidden />
      </span>
      Miss
    </span>
  );
}

export function LiveDot({ label = 'Live' }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-bad">
      <span className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-bad opacity-60" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-bad" />
      </span>
      {label}
    </span>
  );
}

export function LeagueTag({ league }: { league: string }) {
  return <span className="rounded-md bg-raised px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-ink-2 ring-1 ring-line">{league}</span>;
}
