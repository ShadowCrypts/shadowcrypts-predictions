'use client';

import dynamic from 'next/dynamic';
import { usePathname } from 'next/navigation';
import { useParlay } from './parlay';

// The parlay math (league settings, the correlation table, the copula) loads only for visitors who have a parlay,
// not with every page.
const ParlayDockPill = dynamic(() => import('./ParlayDockPill').then((m) => m.ParlayDockPill), { ssr: false });

/** A floating link to your parlay, shown once it has legs (and not on the parlay page itself). */
export function ParlayDock() {
  const { legs } = useParlay();
  const path = usePathname();
  if (!legs.length || path === '/parlay') return null;
  return <ParlayDockPill legs={legs} />;
}
