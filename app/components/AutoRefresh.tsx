'use client';

import { RefreshCw } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { LocalTime } from './LocalTime';

/**
 * Re-fetches the server-rendered page on an interval while games are live,
 * and whenever the tab comes back into view after a while. `at` is when the
 * server rendered the page, so the stamp moves on by itself with each refresh.
 */
export function AutoRefresh({ live, at, everyMs = 60_000 }: { live: boolean; at: string; everyMs?: number }) {
  const router = useRouter();

  useEffect(() => {
    let last = Date.now();
    const refresh = () => {
      last = Date.now();
      router.refresh();
    };
    const timer = live ? window.setInterval(() => document.visibilityState === 'visible' && refresh(), everyMs) : undefined;
    const onVisible = () => document.visibilityState === 'visible' && Date.now() - last > 5 * 60_000 && refresh();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [live, everyMs, router]);

  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs text-ink-3" aria-live="off">
      <RefreshCw className={`h-3 w-3 ${live ? 'text-good' : ''}`} aria-hidden />
      {live ? 'Live updating · ' : 'Updated '}
      <LocalTime iso={at} show="time" />
    </span>
  );
}
