// The UFC forecasts the site showed before each fight, locked at the last refresh before it started and graded
// once it's over: the forward record, which nothing chosen afterwards can touch. Kept in .cache/ufc-ledger.json.
import { promises as fs } from 'fs';
import path from 'path';

export type UfcLedgerEntry = {
  takenAt: string;
  eventId: string;
  /** The fight's scheduled start when logged. */
  date: string;
  aId: string;
  bId: string;
  /** The forecast shown for fighter A (blended with the market when there was a line). */
  chanceA: number;
  /** The ratings alone, and the market's no-margin chance (null with no line). */
  ratingsA: number;
  marketA: number | null;
};

export type UfcLedger = Record<string, UfcLedgerEntry>;

const file = () => path.join(process.cwd(), '.cache', 'ufc-ledger.json');

export async function readUfcLedger(): Promise<UfcLedger> {
  try {
    return JSON.parse(await fs.readFile(file(), 'utf8')) as UfcLedger;
  } catch {
    return {};
  }
}

/** Of two forecasts for one fight, the one that counts: the latest taken before it started (else the earliest after). */
export function lockedUfcEntry(x: UfcLedgerEntry, y: UfcLedgerEntry, start: number) {
  const tx = Date.parse(x.takenAt);
  const ty = Date.parse(y.takenAt);
  const xBefore = tx < start;
  const yBefore = ty < start;
  if (xBefore !== yBefore) return xBefore ? x : y;
  if (xBefore) return tx >= ty ? x : y;
  return tx <= ty ? x : y;
}

/**
 * Logs forecasts for fights still to come. The site and the refresher can both write, so this merges with
 * what's on disk: every fight from both is kept, and where both logged one, the locked entry wins.
 */
export async function logUfcForecasts(entries: UfcLedger) {
  if (!Object.keys(entries).length) return;
  try {
    let onDisk: UfcLedger = {};
    try {
      onDisk = JSON.parse(await fs.readFile(file(), 'utf8')) as UfcLedger;
    } catch (error) {
      // One that can't be read is left alone rather than overwritten; the next build tries again.
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return;
    }
    const merged: UfcLedger = { ...onDisk };
    for (const [id, entry] of Object.entries(entries)) {
      merged[id] = onDisk[id] ? lockedUfcEntry(onDisk[id], entry, Date.parse(entry.date)) : entry;
    }
    await fs.mkdir(path.dirname(file()), { recursive: true });
    const tmp = `${file()}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(merged));
    await fs.rename(tmp, file());
  } catch {
    // Without a writable disk the site still works; it just can't keep the forward record.
  }
}
