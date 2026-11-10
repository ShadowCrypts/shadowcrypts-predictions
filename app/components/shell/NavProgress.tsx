'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';

type State = 'idle' | 'loading' | 'done';

/** A click that will move to another page of this site in this tab. */
function isNavigation(event: MouseEvent) {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;
  const link = (event.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
  if (!link || link.target && link.target !== '_self' || link.hasAttribute('download')) return false;
  const to = new URL(link.href, window.location.href);
  return to.origin === window.location.origin && (to.pathname !== window.location.pathname || to.search !== window.location.search);
}

/**
 * A thin bar across the top while the next page loads: it starts on any link
 * to another page of the site, eases toward the end while the server works,
 * and finishes when the new page is in. Pages arrive whole (no skeleton), so
 * this is the sign that something's happening.
 */
export function NavProgress() {
  const pathname = usePathname();
  const search = useSearchParams();
  const location = `${pathname}?${search}`;
  const [state, setState] = useState<State>('idle');
  const [shown, setShown] = useState(location);
  // The new page is in: finish the bar (adjusted during render, as React recommends for derived state).
  if (shown !== location) {
    setShown(location);
    if (state === 'loading') setState('done');
  }

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (isNavigation(event)) setState('loading');
    };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, []);

  useEffect(() => {
    if (state === 'idle') return;
    // Fade out after finishing; and never hang if a navigation is cancelled.
    const timer = window.setTimeout(() => setState(state === 'done' ? 'idle' : 'done'), state === 'done' ? 350 : 15_000);
    return () => window.clearTimeout(timer);
  }, [state]);

  return (
    <div aria-hidden className={`pointer-events-none fixed inset-x-0 top-0 z-[60] h-0.5 transition-opacity duration-300 ${state === 'idle' ? 'opacity-0' : 'opacity-100'}`}>
      <div
        className="h-full bg-gradient-to-r from-accent to-accent-2 shadow-[0_0_10px_rgb(var(--accent-2)/0.7)]"
        style={{
          width: state === 'loading' ? '88%' : state === 'done' ? '100%' : '0%',
          transition: state === 'loading' ? 'width 6s cubic-bezier(0.08, 0.82, 0.17, 1)' : state === 'done' ? 'width 200ms ease-out' : 'none'
        }}
      />
    </div>
  );
}
