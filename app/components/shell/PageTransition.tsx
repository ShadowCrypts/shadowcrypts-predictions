'use client';

import { usePathname } from 'next/navigation';
import { ViewTransition } from 'react';

/**
 * Pages fade out and rise in when you move to another one (the header and
 * ticker hold still). Keyed by path, so refreshes and filter changes on the
 * same page don't animate. Browsers without view transitions just swap.
 */
export function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <ViewTransition key={pathname} enter="page-in" exit="page-out" default="none">
      <div>{children}</div>
    </ViewTransition>
  );
}
