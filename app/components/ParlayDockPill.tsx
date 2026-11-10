'use client';

import { Layers } from 'lucide-react';
import Link from 'next/link';
import { useMemo } from 'react';
import { pct } from '../../lib/format';
import { summarize } from '../../lib/parlay';
import type { ParlayLeg } from './parlay';

/** The dock's pill: legs and the chance to cash, which needs the parlay math (loaded only once there's a parlay). */
export function ParlayDockPill({ legs }: { legs: ParlayLeg[] }) {
  const summary = useMemo(() => summarize(legs), [legs]);
  if (!summary) return null;
  return (
    <Link
      href="/parlay"
      className="fixed right-4 z-40 inline-flex items-center gap-2 rounded-full bg-accent px-4 py-2 text-sm font-semibold text-on-accent shadow-glow transition hover:brightness-110 bottom-[calc(env(safe-area-inset-bottom,0px)_+_5rem)] md:bottom-6"
    >
      <Layers className="h-4 w-4" aria-hidden />
      Parlay · {summary.legs} {summary.legs === 1 ? 'leg' : 'legs'} · <span className="tabular">{pct(summary.chance, summary.chance < 0.1 ? 1 : 0)}</span>
    </Link>
  );
}
