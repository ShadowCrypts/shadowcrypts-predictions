'use client';

import { useSyncExternalStore } from 'react';

const KEY = 'sc-visits';
/** Page views closer together than this are one visit. */
const SESSION_GAP_MS = 30 * 60_000;

type Visits = { previous: number | null; current: number };

// Read and recorded once per page load, so every component sees the same answer.
let lastVisit: number | null | undefined;

function readLastVisit(): number | null {
  if (lastVisit !== undefined) return lastVisit;
  const now = Date.now();
  try {
    const stored = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Visits | null;
    const next: Visits =
      !stored || typeof stored.current !== 'number'
        ? { previous: null, current: now }
        : now - stored.current > SESSION_GAP_MS
          ? { previous: stored.current, current: now }
          : { previous: stored.previous, current: now };
    localStorage.setItem(KEY, JSON.stringify(next));
    lastVisit = next.previous;
  } catch {
    lastVisit = null;
  }
  return lastVisit;
}

const noop = () => () => {};

/**
 * When this browser last visited, as opposed to this visit: null on a first
 * visit, while storage is blocked, and on the server. Kept in this browser only.
 */
export function useLastVisit() {
  return useSyncExternalStore(noop, readLastVisit, () => null);
}
