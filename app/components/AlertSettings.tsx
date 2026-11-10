'use client';

import { Bell, BellOff, Check } from 'lucide-react';
import { useState } from 'react';
import { useAlerts } from './alerts';
import { InstallApp } from './InstallApp';

function Choice({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className={`chip cursor-pointer select-none text-xs ${checked ? 'chip-active' : 'chip-idle'} has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent`}>
      <input type="checkbox" className="sr-only" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {checked && <Check className="h-3 w-3" aria-hidden />}
      {label}
    </label>
  );
}

/**
 * Alerts on or off, and what to be told about. With push available (the
 * installed service worker), the server sends them, so they arrive with the
 * site closed; otherwise the page announces what it sees while it's open.
 */
export function AlertSettings({ compact = false }: { compact?: boolean }) {
  const { mode, permission, prefs, toggle, setPrefs } = useAlerts();
  const [busy, setBusy] = useState(false);
  if (permission === 'unsupported') return null;
  const on = mode !== 'off';
  const run = async () => {
    setBusy(true);
    try {
      await toggle();
    } finally {
      setBusy(false);
    }
  };
  if (compact) {
    // A small switch beside a heading; the full choices live in live mode.
    return (
      <button
        type="button"
        onClick={run}
        disabled={busy || permission === 'denied'}
        aria-pressed={on}
        title={
          permission === 'denied'
            ? 'Notifications are blocked for this site in your browser settings.'
            : 'Alerts when your games start and finish, when your players’ lines post, and when parlay legs hit or miss'
        }
        className={`inline-flex min-h-8 items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold ring-1 transition disabled:cursor-not-allowed disabled:opacity-60 ${
          on ? 'bg-accent/15 text-ink ring-accent/50' : 'text-ink-2 ring-line hover:bg-raised hover:text-ink'
        }`}
      >
        {on ? <Bell className="h-3.5 w-3.5" aria-hidden /> : <BellOff className="h-3.5 w-3.5" aria-hidden />}
        {busy ? 'Setting up…' : on ? 'Alerts on' : 'Get alerts'}
      </button>
    );
  }
  const status =
    permission === 'denied'
      ? 'Notifications are blocked for this site in your browser settings.'
      : mode === 'push'
        ? 'Arriving even with the site closed. To send them, the server keeps your browser’s push address and what you watch, nothing else, until it’s over.'
        : mode === 'page'
          ? 'Arriving while live mode is open (parlay legs only): this browser can’t take alerts with the site closed.'
          : 'Hear when your parlay legs hit or miss, when your teams’ games start, come down to the wire or finish, when a key player in them is ruled out, and when your players’ lines post, even with the site closed.';
  return (
    <div className="max-w-sm space-y-2">
      <button
        type="button"
        onClick={run}
        disabled={busy || permission === 'denied'}
        aria-pressed={on}
        className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold ring-1 transition disabled:cursor-not-allowed disabled:opacity-60 ${
          on ? 'bg-accent text-on-accent ring-accent' : 'bg-surface text-ink ring-line hover:bg-raised'
        }`}
      >
        {on ? <Bell className="h-4 w-4" aria-hidden /> : <BellOff className="h-4 w-4" aria-hidden />}
        {busy ? 'Setting up…' : on ? 'Alerts on' : 'Turn on alerts'}
      </button>
      {mode === 'push' && (
        <div className="flex flex-wrap gap-2" role="group" aria-label="What to be alerted about">
          <Choice label="Parlay legs" checked={prefs.legs} onChange={(legs) => setPrefs({ ...prefs, legs })} />
          <Choice label="My teams and players" checked={prefs.games} onChange={(games) => setPrefs({ ...prefs, games })} />
        </div>
      )}
      <p className="text-xs text-ink-3">{status}</p>
      {mode !== 'push' && <InstallApp reason="Installed, it can get alerts with the site closed (on iPhone, only installed)." />}
    </div>
  );
}
