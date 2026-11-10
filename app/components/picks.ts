'use client';

import { useCallback, useSyncExternalStore } from 'react';

// Your picks live in this browser only, like followed teams. A pick counts only
// if it was made before the game's scheduled start.

const KEY = 'sc-picks';
const EVENT = 'sc-picks-change';

export type Pick = { side: 'home' | 'away'; at: string };
export type PickMap = Record<string, Pick>;

export const pickKey = (league: string, gameId: string) => `${league}:${gameId}`;

let fallback = '{}';

function read(): string {
  try {
    return localStorage.getItem(KEY) ?? '{}';
  } catch {
    return fallback;
  }
}

function subscribe(onChange: () => void) {
  window.addEventListener(EVENT, onChange);
  window.addEventListener('storage', onChange);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener('storage', onChange);
  };
}

const parsed = new Map<string, PickMap>();
function toMap(raw: string): PickMap {
  let map = parsed.get(raw);
  if (!map) {
    try {
      map = JSON.parse(raw) as PickMap;
    } catch {
      map = {};
    }
    parsed.set(raw, map);
  }
  return map;
}

function write(map: PickMap) {
  const value = JSON.stringify(map);
  try {
    localStorage.setItem(KEY, value);
  } catch {
    fallback = value;
  }
  window.dispatchEvent(new Event(EVENT));
}

export function usePicks() {
  const raw = useSyncExternalStore(subscribe, read, () => '{}');
  const picks = toMap(raw);
  /** Picks, changes or clears a side; refused once the game has started. */
  const choose = useCallback((key: string, side: Pick['side'], start: string) => {
    if (Date.now() >= Date.parse(start)) return;
    const next = { ...toMap(read()) };
    if (next[key]?.side === side) delete next[key];
    else next[key] = { side, at: new Date().toISOString() };
    write(next);
  }, []);
  return { picks, choose };
}

/** A pick that counts: made before the game's scheduled start. */
export const counts = (pick: Pick | undefined, start: string) => !!pick && Date.parse(pick.at) < Date.parse(start);
