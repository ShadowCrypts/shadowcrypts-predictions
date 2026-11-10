import { promises as fs } from 'fs';
import path from 'path';
import type { LeagueId } from '../leagues';
import type { Prediction } from './index';
import { Absent, injuryNews, keyAbsences } from './injuryNews';

/**
 * How each upcoming game's forecast moved before it started: a snapshot every
 * time it changes (or every few hours), so game pages can show the line being
 * posted and injury news landing. Written by the site and the refresher alike,
 * so writes merge with what's on disk.
 */
export type Snapshot = {
  /** When it was taken. */
  t: string;
  /** The forecast's home win probability then. */
  p: number;
  /** The market's vig-free home probability then, if a line was posted. */
  line: number | null;
  /** Whether the forecast was following the line or the pre-line model. */
  basis: 'market' | 'model';
  /** Players the forecast counted as likely out then, worth a real amount to their team, as "id|TEAM|Name" (missing on readings from before this was kept). */
  out?: string[];
};

export type Movement = Record<string, Snapshot[]>;

const DIR = path.join(process.cwd(), '.cache', 'movement');
const fileFor = (league: LeagueId) => path.join(DIR, `${league}.json`);
const MIN_CHANGE = 0.005;
const MAX_GAP_MS = 3 * 3_600_000;
const MAX_POINTS = 240;
const KEEP_DAYS = 45;

export async function readMovement(league: LeagueId): Promise<Movement> {
  try {
    return JSON.parse(await fs.readFile(fileFor(league), 'utf8')) as Movement;
  } catch {
    return {};
  }
}

/** Should a new reading be kept, given the last one on file? */
export function worthKeeping(last: Snapshot | undefined, next: Snapshot) {
  if (!last) return true;
  return (
    Math.abs(next.p - last.p) >= MIN_CHANGE ||
    next.basis !== last.basis ||
    (next.line === null) !== (last.line === null) ||
    (next.out !== undefined && (next.out ?? []).join() !== (last.out ?? []).join()) ||
    Date.parse(next.t) - Date.parse(last.t) >= MAX_GAP_MS
  );
}

/** Two histories of one game combined: every distinct snapshot, oldest first. */
export function mergeSnapshots(a: Snapshot[], b: Snapshot[]) {
  const byTime = new Map<string, Snapshot>();
  for (const s of [...a, ...b]) byTime.set(s.t, s);
  return [...byTime.values()].sort((x, y) => x.t.localeCompare(y.t)).slice(-MAX_POINTS);
}

/** The reading in effect at `time`: the last one taken at or before it, or the first one if tracking began later. */
export function readingAt(history: Snapshot[], time: number): Snapshot | null {
  let found: Snapshot | null = history[0] ?? null;
  for (const s of history) {
    if (Date.parse(s.t) <= time) found = s;
    else break;
  }
  return found;
}

export type MoveReason = 'line posted' | 'line moved' | 'line pulled' | 'model update';

/** Why a forecast moved between two readings, as far as the readings can tell. */
export function moveReason(from: Snapshot, to: Pick<Snapshot, 'basis' | 'line'>): MoveReason {
  if (from.basis === 'model') return to.basis === 'market' ? 'line posted' : 'model update';
  // Books take a line down on big uncertainty (a starter's status), and the pre-line forecast takes over.
  return to.basis === 'market' ? 'line moved' : 'line pulled';
}

export type Mover = {
  league: LeagueId;
  gameId: string;
  from: Snapshot;
  to: { p: number; line: number | null; basis: Snapshot['basis'] };
  reason: MoveReason;
  /** Key players who went out or came back in that time, when the readings know. */
  news: { out: Absent[]; back: Absent[] } | null;
};

/**
 * Games whose forecast moved at least `min` (in home win probability) since
 * `since`, biggest first. `current` is each game's forecast right now.
 */
export function biggestMovers(
  movement: Movement,
  current: Pick<Prediction, 'homeProb' | 'basis' | 'market' | 'game' | 'injuries'>[],
  since: number,
  min = 0.03
): Mover[] {
  return current
    .flatMap((p): Mover[] => {
      const from = readingAt(movement[p.game.id] ?? [], since);
      if (!from) return [];
      const to = { p: p.homeProb, line: p.market?.homeProb ?? null, basis: p.basis };
      if (Math.abs(to.p - from.p) < min) return [];
      return [{ league: p.game.league, gameId: p.game.id, from, to, reason: moveReason(from, to), news: injuryNews(from.out, keyAbsences(p)) }];
    })
    .sort((a, b) => Math.abs(b.to.p - b.from.p) - Math.abs(a.to.p - a.from.p));
}

/** Adds this build's readings for games that haven't started, and drops games long finished. */
export async function recordMovement(league: LeagueId, predictions: Prediction[], now = new Date()) {
  const fresh: Movement = {};
  for (const p of predictions) {
    if (p.game.state !== 'pre' || Date.parse(p.game.date) <= now.getTime()) continue;
    fresh[p.game.id] = [
      { t: now.toISOString(), p: Number(p.homeProb.toFixed(4)), line: p.market ? Number(p.market.homeProb.toFixed(4)) : null, basis: p.basis, out: keyAbsences(p) }
    ];
  }
  if (!Object.keys(fresh).length) return;
  try {
    const onDisk = await readMovement(league);
    let changed = false;
    for (const [id, [snapshot]] of Object.entries(fresh)) {
      const history = onDisk[id] ?? [];
      if (!worthKeeping(history[history.length - 1], snapshot)) continue;
      onDisk[id] = mergeSnapshots(history, [snapshot]);
      changed = true;
    }
    const cutoff = new Date(now.getTime() - KEEP_DAYS * 86_400_000).toISOString();
    for (const [id, history] of Object.entries(onDisk)) {
      if (!history.length || history[history.length - 1].t < cutoff) {
        delete onDisk[id];
        changed = true;
      }
    }
    if (!changed) return;
    // Re-read right before writing, so a write from the other process in between isn't lost.
    const latest = await readMovement(league);
    for (const [id, history] of Object.entries(latest)) if (onDisk[id]) onDisk[id] = mergeSnapshots(history, onDisk[id]);
    await fs.mkdir(DIR, { recursive: true });
    const tmp = `${fileFor(league)}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(onDisk));
    await fs.rename(tmp, fileFor(league));
  } catch {
    // History is a nice-to-have; a read-only disk just means no movement chart.
  }
}
