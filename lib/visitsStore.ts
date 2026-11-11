// Keeps the day's visit totals in memory and adds them to `.cache/visits/<day>.json` about once a
// minute (days in UTC). Counting is best effort: a disk problem, or a restart losing the last minute,
// never touches a page. `npm run visits` prints them.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { addRobot, addVisit, DayCounts, emptyDay, mergeDays, RobotReason } from './visits';

const FLUSH_MS = 60_000;
const KEY = '__shadowcryptsVisits';
type State = { pending: Map<string, DayCounts>; timer: ReturnType<typeof setTimeout> | null; flushing: Promise<void> | null };
/** One set of totals for the whole process, however its parts were bundled. */
const state = () => ((globalThis as unknown as Record<string, State>)[KEY] ??= { pending: new Map(), timer: null, flushing: null });

export const visitsDir = () => path.join(process.cwd(), '.cache', 'visits');

export function recordVisit(page: string, from: string | null, now = new Date()) {
  record(now, (counts) => addVisit(counts, page, from));
}

/** A page load set aside as a robot: a separate total, so the people count stays people. */
export function recordRobot(page: string, why: RobotReason, now = new Date()) {
  record(now, (counts) => addRobot(counts, page, why));
}

function record(now: Date, add: (counts: DayCounts) => void) {
  const s = state();
  const day = now.toISOString().slice(0, 10);
  const counts = s.pending.get(day) ?? emptyDay();
  add(counts);
  s.pending.set(day, counts);
  if (!s.timer) {
    s.timer = setTimeout(() => {
      s.timer = null;
      void flushVisits();
    }, FLUSH_MS);
    // A pending count never keeps the server from shutting down.
    s.timer.unref?.();
  }
}

/** Adds what's counted so far to the files on disk. */
export async function flushVisits(dir = visitsDir()) {
  const s = state();
  if (s.flushing) await s.flushing;
  const batch = s.pending;
  if (!batch.size) return;
  s.pending = new Map();
  s.flushing = (async () => {
    try {
      await fs.mkdir(dir, { recursive: true });
      for (const [day, counts] of batch) {
        const file = path.join(dir, `${day}.json`);
        const stored = await fs
          .readFile(file, 'utf8')
          .then((text) => JSON.parse(text) as DayCounts)
          .catch(() => emptyDay());
        const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
        await fs.writeFile(tmp, JSON.stringify(mergeDays(stored, counts)));
        await fs.rename(tmp, file);
      }
    } catch {
      // Best effort: these counts are lost, and the site carries on.
    }
  })();
  try {
    await s.flushing;
  } finally {
    s.flushing = null;
  }
}
