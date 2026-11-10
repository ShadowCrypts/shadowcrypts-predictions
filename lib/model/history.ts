// How much of each league's past a host has on file. A new host answers within seconds
// from what it can fetch at once and fills the rest in the background, which takes a
// while; until it's done, player numbers and records are real but thinner, and the site
// says so rather than passing them off as the whole picture.
import { promises as fs } from 'node:fs';
import path from 'node:path';

type Counts = { have: number; total: number };
export type HistoryProgress = { share: number; loading: boolean; forecastsSettled: boolean; kinds: Record<string, string> };

const KEY = '__shadowcryptsHistory';
/** Route handlers and pages can load their own copies of a module; the process has one set of counts. */
const store = () => ((globalThis as unknown as Record<string, Map<string, Counts>>)[KEY] ??= new Map<string, Counts>());

/** Below this, the site says it's still filling in. A finished host stays above it: some games never had a box score or lines to get. */
export const HISTORY_READY = 0.9;
/**
 * Forecasts lean on closing lines and box scores, newest first. Measured on an empty
 * host against a full one (Nov 5, 2026): with 6-8% of those on file the biggest gap was
 * about 9 points of win chance, and with about half, 1.4. It's per league, the slowest
 * one counting: pooled together, MLB's 7,400 games hid other leagues still far behind.
 */
export const FORECASTS_READY = 0.5;
const FORECAST_KINDS = ['lines', 'boxes', 'skill'];

export function noteHistory(league: string, kind: string, have: number, total: number) {
  store().set(`${league}:${kind}`, { have, total });
}

/** The share on file across everything counted, in `entries`' terms. */
export function historyShare(entries: Iterable<Counts>) {
  let have = 0;
  let total = 0;
  for (const c of entries) {
    have += Math.min(c.have, c.total);
    total += c.total;
  }
  return total ? have / total : 1;
}

/** Whether every league counted so far has enough behind its forecasts. */
export function forecastsSettled(counts: [string, Counts][]) {
  const leagues = new Map<string, Counts[]>();
  for (const [key, c] of counts) {
    const [league, kind] = key.split(':');
    if (FORECAST_KINDS.includes(kind)) leagues.set(league, [...(leagues.get(league) ?? []), c]);
  }
  return [...leagues.values()].every((list) => historyShare(list) >= FORECASTS_READY);
}

export function historyProgress(): HistoryProgress {
  const counts = [...store()];
  const share = historyShare(counts.map(([, c]) => c));
  return { share, loading: share < HISTORY_READY, forecastsSettled: forecastsSettled(counts), kinds: Object.fromEntries(counts.map(([k, c]) => [k, `${c.have}/${c.total}`])) };
}

/** Stored months of box scores, more than an empty host's first few seconds would have (its first build reads a month or two per league). */
export const looksLikeHistory = (files: string[]) => files.filter((f) => /^espn-.*-box-/.test(f)).length >= 12;

const JUST_STARTED: HistoryProgress = { share: 0, loading: true, forecastsSettled: false, kinds: {} };

/**
 * As `historyProgress`, for the moment nothing's been counted yet: the first model build
 * is still running, and a page can render before it ends. On a disk with history that's
 * nothing to mention; on an empty one it's the worst moment of all, and its first visitor
 * should hear about it as much as the next one.
 */
export async function historyNow(dir = path.join(process.cwd(), '.cache')): Promise<HistoryProgress> {
  if (store().size) return historyProgress();
  const files = await fs.readdir(dir).catch(() => [] as string[]);
  return looksLikeHistory(files) ? historyProgress() : JUST_STARTED;
}
