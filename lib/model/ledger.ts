import { promises as fs } from 'fs';
import path from 'path';
import { getLeagueGames } from '../espn';
import { LEAGUES, LeagueId } from '../leagues';
import type { MarketView } from './market';

/**
 * The forecast the app actually showed before a game, locked in at the last
 * pregame refresh. Grading these gives a forward-tested record that includes
 * the live-only injury adjustments and pre-close lines the backtest can't see.
 */
export type LedgerEntry = {
  takenAt: string;
  /** The forecast shown (market-anchored when a line was posted). */
  homeProb: number;
  /** The rating model alone. Missing on entries logged before the market blend existed. */
  modelHomeProb?: number;
  /** Market-implied ratings. Missing on entries logged before they existed. */
  marketRatingHomeProb?: number;
  netElo: number;
  factors: {
    label: string;
    detail: string;
    home: number;
    away: number;
    kind: 'rating' | 'adjustment';
    /** Quarterbacks: "Joe Fagnano instead of Lamar Jackson", per team, when it isn't the usual starter. Missing on older entries. */
    change?: { home: string | null; away: string | null };
  }[];
  market: MarketView | null;
};

export type Ledger = Record<string, LedgerEntry>;

const DIR = path.join(process.cwd(), '.cache', 'ledger');
const fileFor = (league: LeagueId) => path.join(DIR, `${league}.json`);

export async function readLedger(league: LeagueId): Promise<Ledger> {
  try {
    return JSON.parse(await fs.readFile(fileFor(league), 'utf8')) as Ledger;
  } catch {
    return {};
  }
}

/** Scheduled start times by game id. The build that's writing just loaded these, so they come from memory. */
async function gameStarts(league: LeagueId) {
  try {
    const games = await getLeagueGames(LEAGUES[league]);
    return new Map(games.map((g) => [g.id, Date.parse(g.date)]));
  } catch {
    return new Map<string, number>();
  }
}

/**
 * Of two forecasts logged for one game, the one that counts: the latest taken
 * before the scheduled start. If both came after it (the game was still listed
 * as upcoming), the earlier one, which is the closer to a pregame lock.
 */
function lockedEntry(a: LedgerEntry, b: LedgerEntry, start: number | undefined) {
  const ta = Date.parse(a.takenAt);
  const tb = Date.parse(b.takenAt);
  const aBefore = start === undefined || ta < start;
  const bBefore = start === undefined || tb < start;
  if (aBefore !== bBefore) return aBefore ? a : b;
  if (aBefore) return ta >= tb ? a : b;
  return ta <= tb ? a : b;
}

/**
 * The dev/prod server and `npm run refresh` can both write a league's ledger,
 * so a write merges with what's on disk instead of replacing it: every game
 * from both is kept, and where both logged a game the locked entry wins.
 */
export async function writeLedger(league: LeagueId, ledger: Ledger) {
  try {
    let onDisk: Ledger = {};
    try {
      onDisk = JSON.parse(await fs.readFile(fileFor(league), 'utf8')) as Ledger;
    } catch (error) {
      // A ledger we can't read is skipped rather than overwritten; the next build retries.
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return;
    }

    const merged: Ledger = { ...onDisk, ...ledger };
    const conflicts = Object.keys(ledger).filter((id) => onDisk[id] && onDisk[id].takenAt !== ledger[id].takenAt);
    if (conflicts.length) {
      const starts = await gameStarts(league);
      for (const id of conflicts) merged[id] = lockedEntry(onDisk[id], ledger[id], starts.get(id));
    }

    await fs.mkdir(DIR, { recursive: true });
    const tmp = `${fileFor(league)}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(merged));
    await fs.rename(tmp, fileFor(league));
  } catch {
    // Without a writable disk the app still works; it just can't log live picks.
  }
}
