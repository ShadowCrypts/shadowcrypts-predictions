'use client';

import { useSyncExternalStore } from 'react';

const TICK_MS = 30_000;

let now = 0;
const listeners = new Set<() => void>();
let timer: number | undefined;

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  if (timer === undefined) {
    timer = window.setInterval(() => {
      now = Date.now();
      for (const l of listeners) l();
    }, TICK_MS);
  }
  return () => {
    listeners.delete(onChange);
    if (!listeners.size) {
      window.clearInterval(timer);
      timer = undefined;
    }
  };
}

function snapshot() {
  // First read on the page: start from the real time; after that it moves on the shared tick.
  if (!now) now = Date.now();
  return now;
}

/** The current time, shared by every component and updated every 30 seconds (0 on the server). */
export function useNow() {
  return useSyncExternalStore(subscribe, snapshot, () => 0);
}
