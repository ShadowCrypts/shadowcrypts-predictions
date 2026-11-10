'use client';

import { useEffect, useState } from 'react';
import { LegResult, legId } from '../../lib/legs';
import type { TrackedParlay } from './parlayLog';
import { useNow } from './useNow';

/** How often to ask again: every minute while a game is on, else every few. */
const LIVE_REFRESH_MS = 60_000;
const REFRESH_MS = 180_000;

/**
 * Results for the legs of tracked parlays whose games have started and aren't
 * graded yet, by leg id: the stat so far while a game is on, the final once
 * it's over (handed to `record`, which keeps it on the parlay for good).
 */
export function useLiveLegs(log: TrackedParlay[], record: (results: Record<string, LegResult>) => void) {
  const now = useNow();
  const [live, setLive] = useState<Record<string, LegResult>>({});
  const waiting = [
    ...new Set(log.flatMap((p) => p.legs.filter((l) => !p.results[l.key] && now > 0 && Date.parse(l.start) <= now).map((l) => legId(l))))
  ]
    .filter((id): id is string => id !== null)
    .sort()
    .join(',');
  useEffect(() => {
    if (!waiting) return;
    let timer: number | undefined;
    let stopped = false;
    const load = () =>
      fetch(`/api/legs?ids=${encodeURIComponent(waiting)}`)
        .then((r) => (r.ok ? r.json() : { results: {} }))
        .then((data: { results: Record<string, LegResult> }) => {
          if (stopped) return;
          record(data.results);
          setLive(data.results);
          timer = window.setTimeout(load, Object.values(data.results).some((r) => r.live) ? LIVE_REFRESH_MS : REFRESH_MS);
        })
        .catch(() => {
          if (!stopped) timer = window.setTimeout(load, REFRESH_MS);
        });
    load();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [waiting, record]);
  return { live, now };
}
