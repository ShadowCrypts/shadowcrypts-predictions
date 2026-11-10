'use client';

import { Moon, Sun } from 'lucide-react';
import { useSyncExternalStore } from 'react';
import { THEME_KEY } from '../../../lib/theme';

const EVENT = 'sc-theme-change';

function subscribe(onChange: () => void) {
  window.addEventListener(EVENT, onChange);
  return () => window.removeEventListener(EVENT, onChange);
}

/** The theme lives on <html data-theme>, set before paint by the inline theme script. */
const current = () => (document.documentElement.dataset.theme === 'light' ? 'light' : 'dark');

export function ThemeToggle() {
  // Unknown on the server; the button shows the dark-theme icon until the browser says otherwise.
  const theme = useSyncExternalStore(subscribe, current, () => null);

  const toggle = () => {
    const next = theme === 'light' ? 'dark' : 'light';
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      // Private mode: the choice just won't persist.
    }
    window.dispatchEvent(new Event(EVENT));
  };

  return (
    <button
      type="button"
      onClick={toggle}
      className="flex h-9 w-9 items-center justify-center rounded-lg text-ink-2 ring-1 ring-line transition hover:bg-raised hover:text-ink"
      aria-label={theme === 'light' ? 'Switch to dark theme' : 'Switch to light theme'}
      title={theme === 'light' ? 'Dark theme' : 'Light theme'}
    >
      {theme === 'light' ? <Moon className="h-4 w-4" aria-hidden /> : <Sun className="h-4 w-4" aria-hidden />}
    </button>
  );
}
