'use client';

import { useSyncExternalStore } from 'react';
import type { LiveBoard } from '../../lib/model/liveBoard';

// One copy of the live board for the whole page (the ticker and live mode
// both read it), read again every 15 seconds while games are on (every minute
// otherwise) as long as something shows it and the tab is visible, and right
// away when the tab comes back after a while. The server's scores are at most
// 15 seconds old.

const LIVE_MS = 15_000;
const QUIET_MS = 60_000;
const REFRESH_MS = LIVE_MS;

let board: LiveBoard | null = null;
let fetchedAt = 0;
let loading = false;
let timer: number | undefined;
const listeners = new Set<() => void>();

function load() {
  if (loading) return;
  loading = true;
  fetch('/api/live')
    .then((r) => (r.ok ? (r.json() as Promise<LiveBoard>) : null))
    .then((data) => {
      if (!data) return;
      board = data;
      for (const listener of listeners) listener();
    })
    .catch(() => undefined)
    .finally(() => {
      loading = false;
      fetchedAt = Date.now();
    });
}

function onVisible() {
  if (document.visibilityState === 'visible' && Date.now() - fetchedAt > REFRESH_MS / 2) load();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) {
    if (Date.now() - fetchedAt > REFRESH_MS / 2) load();
    // Ticks every 15 seconds; reads only when games are on, or once a minute when nothing is.
    timer = window.setInterval(() => {
      const wait = board?.live.length ? LIVE_MS : QUIET_MS;
      if (document.visibilityState === 'visible' && Date.now() - fetchedAt >= wait - 1_000) load();
    }, REFRESH_MS);
    document.addEventListener('visibilitychange', onVisible);
  }
  return () => {
    listeners.delete(listener);
    if (!listeners.size) {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    }
  };
}

/** The latest live board: the one the server rendered (`initial`) until a newer read arrives, else null until the first. */
export function useLiveBoard(initial: LiveBoard | null = null) {
  return useSyncExternalStore(
    subscribe,
    () => (board && (!initial || board.generatedAt >= initial.generatedAt) ? board : initial),
    () => initial
  );
}
