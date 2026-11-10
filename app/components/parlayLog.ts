'use client';

import { useCallback, useSyncExternalStore } from 'react';
import { LegResult, legId } from '../../lib/legs';
import type { ParlayLeg } from './parlay';

// Parlays you saved to track, in this browser only, like your picks. Each leg's
// result is stored here once its game is final, so it's only asked for once.

const KEY = 'sc-parlay-log';
const EVENT = 'sc-parlay-log-change';
const MAX_SAVED = 200;

export type TrackedParlay = {
  id: string;
  savedAt: string;
  legs: ParlayLeg[];
  /** Chance every leg hits when saved, and what treating the legs as independent said. */
  chance: number;
  independent: number;
  /** American price: the one you were offered, or every leg's price multiplied. */
  price: number | null;
  /** Final results by leg key. */
  results: Record<string, LegResult>;
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

const parsed = new Map<string, TrackedParlay[]>();
function toLog(raw: string): TrackedParlay[] {
  let log = parsed.get(raw);
  if (!log) {
    try {
      log = JSON.parse(raw) as TrackedParlay[];
      if (!Array.isArray(log)) log = [];
    } catch {
      log = [];
    }
    parsed.set(raw, log);
  }
  return log;
}

function write(log: TrackedParlay[]) {
  const value = JSON.stringify(log.slice(0, MAX_SAVED));
  try {
    localStorage.setItem(KEY, value);
  } catch {
    fallback = value;
  }
  window.dispatchEvent(new Event(EVENT));
}

export function useParlayLog() {
  const raw = useSyncExternalStore(subscribe, read, () => '[]');
  const log = toLog(raw);
  /** Saves a parlay at the top of the list. */
  const save = useCallback((parlay: Omit<TrackedParlay, 'id' | 'savedAt' | 'results'>) => {
    const savedAt = new Date().toISOString();
    write([{ ...parlay, id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, savedAt, results: {} }, ...toLog(read())]);
  }, []);
  const remove = useCallback((id: string) => write(toLog(read()).filter((p) => p.id !== id)), []);
  /** Stores final leg results (by leg id) on every saved parlay that has those legs. */
  const record = useCallback((results: Record<string, LegResult>) => {
    let changed = false;
    const next = toLog(read()).map((p) => {
      const add: Record<string, LegResult> = {};
      for (const leg of p.legs) {
        const id = legId(leg);
        const r = id ? results[id] : undefined;
        if (r && r.state !== 'pending' && !p.results[leg.key]) add[leg.key] = r;
      }
      if (!Object.keys(add).length) return p;
      changed = true;
      return { ...p, results: { ...p.results, ...add } };
    });
    if (changed) write(next);
  }, []);
  return { log, save, remove, record };
}
