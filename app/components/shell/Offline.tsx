'use client';

import { WifiOff } from 'lucide-react';
import { useEffect, useState } from 'react';

/**
 * Registers the service worker in production (in development it would serve
 * stale builds, so any old one is removed) and shows a banner while offline.
 */
export function OfflineSupport() {
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    if ('serviceWorker' in navigator) {
      if (process.env.NODE_ENV === 'production') {
        navigator.serviceWorker.register('/sw.js').catch(() => undefined);
      } else {
        navigator.serviceWorker.getRegistrations().then((list) => list.forEach((r) => r.unregister()));
      }
    }
    const update = () => setOffline(!navigator.onLine);
    update();
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  if (!offline) return null;
  return (
    <div role="status" className="sticky top-16 z-30 border-b border-warn/40 bg-warn/15 backdrop-blur-xl">
      <p className="mx-auto flex max-w-7xl items-center gap-2 px-4 py-2 text-sm text-ink sm:px-6">
        <WifiOff className="h-4 w-4 shrink-0 text-warn" aria-hidden />
        You&apos;re offline. You&apos;re seeing the last saved version of this page; scores and forecasts update when you reconnect.
      </p>
    </div>
  );
}
