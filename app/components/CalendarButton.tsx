'use client';

import { CalendarPlus, Check } from 'lucide-react';
import { useState } from 'react';
import { useFavorites } from './favorites';

/**
 * Subscribes a calendar app to a team's games (or every followed team's, when
 * no team is given). webcal:// opens Apple Calendar and Outlook directly; the
 * copied https link works in Google Calendar's "From URL".
 */
export function CalendarButton({ team, label }: { team?: string; label?: string }) {
  const { favorites } = useFavorites();
  const [copied, setCopied] = useState(false);
  const teams = team ? [team] : [...favorites];
  if (!teams.length) return null;

  const path = `/api/calendar?teams=${teams.join(',')}`;
  const subscribe = () => {
    const https = `${window.location.origin}${path}`;
    navigator.clipboard?.writeText(https).then(
      () => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 2500);
      },
      () => undefined
    );
    // Apple Calendar and Outlook take webcal:// directly; elsewhere this is a no-op and the copied link does the job.
    if (/Mac|iPhone|iPad|Windows/.test(navigator.userAgent)) window.location.href = https.replace(/^https?:/, 'webcal:');
  };

  return (
    <button
      type="button"
      onClick={subscribe}
      className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium text-ink-2 ring-1 ring-line transition hover:bg-raised hover:text-ink"
      title="Adds the games to your calendar with forecasts, kept up to date. The link is also copied for Google Calendar (Other calendars, From URL)."
    >
      {copied ? <Check className="h-4 w-4 text-good" aria-hidden /> : <CalendarPlus className="h-4 w-4" aria-hidden />}
      {copied ? 'Link copied' : label ?? 'Add to calendar'}
    </button>
  );
}
