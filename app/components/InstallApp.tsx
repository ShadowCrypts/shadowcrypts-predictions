'use client';

import { Download, Share } from 'lucide-react';
import { useEffect, useState, useSyncExternalStore } from 'react';

type InstallPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> };

const noop = () => () => {};
/** Already running as the installed app (home screen or desktop window). */
const installed = () => window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
/** iPhone and iPad Safari, which has no install prompt: adding to the home screen is done from the Share menu. */
const appleMobile = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

/**
 * Put the site on the home screen or desktop as an app: the browser's own
 * install prompt where there is one (Chrome, Edge, Android), and the steps on
 * iPhone and iPad, where it's also what lets background alerts through.
 * Nothing shows once it's installed.
 */
export function InstallApp({ reason = 'Opens like an app, works offline for pages you’ve seen, and gets alerts with the site closed.' }: { reason?: string }) {
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null);
  const [done, setDone] = useState(false);
  const isInstalled = useSyncExternalStore(noop, installed, () => true);
  const apple = useSyncExternalStore(noop, appleMobile, () => false);

  useEffect(() => {
    const onPrompt = (event: Event) => {
      event.preventDefault();
      setPrompt(event as InstallPrompt);
    };
    const onInstalled = () => setDone(true);
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  if (isInstalled || done) return null;
  if (prompt) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={async () => {
            await prompt.prompt();
            const { outcome } = await prompt.userChoice;
            if (outcome === 'accepted') setDone(true);
            setPrompt(null);
          }}
          className="inline-flex min-h-8 items-center gap-1.5 rounded-lg bg-raised px-3 py-1.5 text-xs font-semibold text-ink ring-1 ring-line transition hover:bg-line"
        >
          <Download className="h-3.5 w-3.5" aria-hidden />
          Install the app
        </button>
        <span className="text-xs text-ink-3">{reason}</span>
      </div>
    );
  }
  if (apple) {
    return (
      <p className="text-xs text-ink-3">
        <span className="font-semibold text-ink-2">On iPhone and iPad:</span> tap <Share className="inline h-3.5 w-3.5 align-text-bottom" aria-label="Share" /> then
        “Add to Home Screen”. {reason}
      </p>
    );
  }
  return null;
}
