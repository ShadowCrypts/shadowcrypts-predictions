'use client';

import { useCallback, useSyncExternalStore } from 'react';
import type { LegLink } from '../../lib/model/correlation';

// Your parlay lives in this browser only, like your picks and followed teams.

const KEY = 'sc-parlay';
const EVENT = 'sc-parlay-change';

export type ParlayLeg = {
  /** One per selection; the opposite side of the same bet shares `group`. */
  key: string;
  group: string;
  league: string;
  gameId: string;
  /** "WSH @ CHA" */
  game: string;
  start: string;
  /** "Brandon Miller over 24.5 points" */
  label: string;
  /** Chance it wins: the forecast (the book's own number, margin removed, for props and lines). */
  prob: number;
  /** The book's American price when one was posted; null for a number you typed in. */
  price: number | null;
  book: string | null;
  /** Who and what the leg is about (player, stat and side, or the team to win), for same-game math and grading. Missing on legs saved before it existed. */
  link?: LegLink;
  /** A prop leg's line. */
  line?: number;
};

let fallback = '[]';

function read(): string {
  try {
    return localStorage.getItem(KEY) ?? '[]';
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

const parsed = new Map<string, ParlayLeg[]>();
function toLegs(raw: string): ParlayLeg[] {
  let legs = parsed.get(raw);
  if (!legs) {
    try {
      legs = JSON.parse(raw) as ParlayLeg[];
      if (!Array.isArray(legs)) legs = [];
    } catch {
      legs = [];
    }
    parsed.set(raw, legs);
  }
  return legs;
}

function write(legs: ParlayLeg[]) {
  const value = JSON.stringify(legs);
  try {
    localStorage.setItem(KEY, value);
  } catch {
    fallback = value;
  }
  window.dispatchEvent(new Event(EVENT));
}

export function useParlay() {
  const raw = useSyncExternalStore(subscribe, read, () => '[]');
  const legs = toLegs(raw);
  /** Adds a leg, or removes it if it's already in; picking the other side of a bet replaces it. */
  const toggle = useCallback((leg: ParlayLeg) => {
    const current = toLegs(read());
    if (current.some((l) => l.key === leg.key)) write(current.filter((l) => l.key !== leg.key));
    else write([...current.filter((l) => l.group !== leg.group), leg]);
  }, []);
  const remove = useCallback((key: string) => write(toLegs(read()).filter((l) => l.key !== key)), []);
  const clear = useCallback(() => write([]), []);
  /** Puts these legs in place of whatever was there (a shared parlay). */
  const replace = useCallback((next: ParlayLeg[]) => write(next), []);
  return { legs, toggle, remove, clear, replace };
}
