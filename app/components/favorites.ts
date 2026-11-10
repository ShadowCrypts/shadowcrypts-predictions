'use client';

import { useSyncExternalStore } from 'react';

export const teamKey = (league: string, teamId: string) => `${league}:${teamId}`;
export const playerKey = (league: string, playerId: string) => `${league}:${playerId}`;

/** A set of keys kept in this browser only, shared across every component on the page and across tabs. */
function setStore(key: string) {
  const event = `${key}-change`;
  // Used when storage is blocked (private mode), so following still works for the visit.
  let fallback = '[]';

  const read = (): string => {
    try {
      return localStorage.getItem(key) ?? '[]';
    } catch {
      return fallback;
    }
  };

  const subscribe = (onChange: () => void) => {
    window.addEventListener(event, onChange);
    window.addEventListener('storage', onChange);
    return () => {
      window.removeEventListener(event, onChange);
      window.removeEventListener('storage', onChange);
    };
  };

  const parsed = new Map<string, Set<string>>();
  const toSet = (raw: string) => {
    let set = parsed.get(raw);
    if (!set) {
      try {
        const list: unknown = JSON.parse(raw);
        set = new Set(Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string') : []);
      } catch {
        set = new Set();
      }
      parsed.set(raw, set);
    }
    return set;
  };

  const toggle = (item: string) => {
    const next = new Set(toSet(read()));
    if (next.has(item)) next.delete(item);
    else next.add(item);
    const value = JSON.stringify([...next]);
    try {
      localStorage.setItem(key, value);
    } catch {
      fallback = value;
    }
    window.dispatchEvent(new Event(event));
  };

  // `toggle` is made once per store, so it's as stable as a callback needs to be.
  return function useStore() {
    const raw = useSyncExternalStore(subscribe, read, () => '[]');
    return { items: toSet(raw), toggle };
  };
}

const useTeamStore = setStore('sc-favorites');
const usePlayerStore = setStore('sc-players');

/** Followed teams. */
export function useFavorites() {
  const { items, toggle } = useTeamStore();
  return { favorites: items, toggle };
}

/** Followed players. */
export function useFollowedPlayers() {
  const { items, toggle } = usePlayerStore();
  return { players: items, toggle };
}
