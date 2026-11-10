import { promises as fs } from 'fs';
import path from 'path';
import type { LeagueId } from '../leagues';
import { fairOver, profitPerUnit, PropMarket } from '../props';

/**
 * A prop line the model disagreed with by 10+ points, logged before the game
 * at the line and price on offer then. The last one logged before the start
 * is the one graded: a forward test of the model's disagreements that the
 * backtest can't fake.
 */
export type PropLedgerEntry = {
  takenAt: string;
  start: string;
  gameId: string;
  athleteId: string;
  name: string;
  teamId: string;
  market: PropMarket;
  line: number;
  over: number;
  under: number;
  book: string;
  projected: number;
  /** Our model's over chance. */
  model: number;
  side: 'over' | 'under';
  /** How far the model's chance on that side beat the price's (margin included). */
  edge: number;
  /** The line and prices when the model first tagged it (kept from November 2026 on), for closing line value. */
  first?: { takenAt: string; line: number; over: number; under: number };
};

/** The first-tagged snapshot of an entry: its own `first`, or the entry itself for one logged before those were kept. */
const firstOf = (e: PropLedgerEntry) => e.first ?? { takenAt: e.takenAt, line: e.line, over: e.over, under: e.under };

/** An entry carrying the earliest first-tagged snapshot of the two. */
export function withFirst(entry: PropLedgerEntry, other: PropLedgerEntry | undefined): PropLedgerEntry {
  const mine = firstOf(entry);
  if (!other) return { ...entry, first: mine };
  const theirs = firstOf(other);
  return { ...entry, first: theirs.takenAt < mine.takenAt ? theirs : mine };
}

export type PropLedger = Record<string, PropLedgerEntry>;

export const propLedgerKey = (gameId: string, athleteId: string, market: PropMarket) => `${gameId}|${athleteId}|${market}`;

const DIR = path.join(process.cwd(), '.cache', 'prop-ledger');
const fileFor = (league: LeagueId) => path.join(DIR, `${league}.json`);

export async function readPropLedger(league: LeagueId): Promise<PropLedger> {
  try {
    return JSON.parse(await fs.readFile(fileFor(league), 'utf8')) as PropLedger;
  } catch {
    return {};
  }
}

/** Of two entries for one line, the one that counts: the latest taken before the start (or, if neither was, the earlier). */
function lockedEntry(a: PropLedgerEntry, b: PropLedgerEntry) {
  const start = Date.parse(a.start);
  const ta = Date.parse(a.takenAt);
  const tb = Date.parse(b.takenAt);
  const aBefore = ta < start;
  const bBefore = tb < start;
  if (aBefore !== bBefore) return aBefore ? a : b;
  if (aBefore) return ta >= tb ? a : b;
  return ta <= tb ? a : b;
}

/** How long logged lines are kept: the forward record covers this window. */
export const PROP_LEDGER_DAYS = 180;

/**
 * Merges with what's on disk, like the game ledger: the site and the refresher
 * can both write it. Lines older than the window are dropped to keep it small.
 */
export async function writePropLedger(league: LeagueId, ledger: PropLedger, now = new Date()) {
  try {
    let onDisk: PropLedger = {};
    try {
      onDisk = JSON.parse(await fs.readFile(fileFor(league), 'utf8')) as PropLedger;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return;
    }
    const merged: PropLedger = { ...onDisk };
    for (const [key, entry] of Object.entries(ledger)) {
      const disk = onDisk[key];
      if (!disk) {
        merged[key] = entry;
        continue;
      }
      // Graded on the latest before the start, carrying the earliest tag either one saw (for closing line value).
      const locked = lockedEntry(disk, entry);
      merged[key] = entry.first || disk.first ? withFirst(locked, locked === disk ? entry : disk) : locked;
    }
    const cutoff = now.getTime() - PROP_LEDGER_DAYS * 86_400_000;
    for (const [key, entry] of Object.entries(merged)) if (Date.parse(entry.start) < cutoff) delete merged[key];
    await fs.mkdir(DIR, { recursive: true });
    const tmp = `${fileFor(league)}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(merged));
    await fs.rename(tmp, fileFor(league));
  } catch {
    // Without a writable disk the site still works; it just can't log prop picks.
  }
}

export type GradedPick = { entry: PropLedgerEntry; actual: number; result: 'won' | 'lost' | 'push' };

/** The forward-tested record of the model's logged disagreements, graded once their games are final. */
export type LivePropRecord = {
  bets: number;
  won: number;
  lost: number;
  pushes: number;
  profit: number;
  returnPerBet: number;
  pending: number;
  /** The latest graded picks, newest first (30 unless asked for more). */
  recent: GradedPick[];
  /** Closing line value of the picks that know when they were first tagged. */
  clv?: ClvRecord;
};

const RECENT_PICKS = 30;

/** Of the model's logged picks, how many the market moved toward between its first tag and the close, away from, or neither. */
export type ClvRecord = { picks: number; beat: number; same: number; worse: number };

/** A pick tagged within this long of the start had no time to see the market move, so it isn't counted. */
const CLV_MIN_LEAD_MS = 3_600_000;

/**
 * Closing line value: for each logged pick that knows when it was first
 * tagged, did the closing line move toward its side (a higher line on an
 * over, a lower one on an under) or, at the same line, did the price? Beating
 * the close is the standard test of whether picks know something the market
 * didn't yet; it needs far fewer bets than a win-loss record to say anything.
 * `closingFor` gives the book's closing main line for that player and stat.
 */
export function gradeClv(ledger: PropLedger, closingFor: (entry: PropLedgerEntry) => { line: number; over: number; under: number } | null): ClvRecord {
  const r: ClvRecord = { picks: 0, beat: 0, same: 0, worse: 0 };
  for (const entry of Object.values(ledger)) {
    const first = entry.first;
    if (!first || Date.parse(entry.start) - Date.parse(first.takenAt) < CLV_MIN_LEAD_MS) continue;
    const close = closingFor(entry);
    if (!close) continue;
    const toward = entry.side === 'over' ? 1 : -1;
    const ours = (l: { over: number; under: number }) => (entry.side === 'over' ? fairOver(l) : 1 - fairOver(l));
    const lineMove = (close.line - first.line) * toward;
    const priceMove = ours(close) - ours(first);
    const moved = lineMove !== 0 ? lineMove : Math.abs(priceMove) < 0.005 ? 0 : priceMove;
    r.picks += 1;
    if (moved > 0) r.beat += 1;
    else if (moved < 0) r.worse += 1;
    else r.same += 1;
  }
  return r;
}

/**
 * Grades logged entries against what happened. `actualFor` returns the player's
 * number for a finished game, or undefined while it's pending; a player who
 * didn't play gets null, and the bet is void, as the books settle it.
 */
export function gradePropLedger(ledger: PropLedger, actualFor: (entry: PropLedgerEntry) => number | null | undefined, keep = RECENT_PICKS): LivePropRecord {
  const r = { bets: 0, won: 0, lost: 0, pushes: 0, profit: 0, pending: 0 };
  const graded: GradedPick[] = [];
  for (const entry of Object.values(ledger)) {
    if (Date.parse(entry.takenAt) >= Date.parse(entry.start)) continue;
    const actual = actualFor(entry);
    if (actual === undefined) {
      r.pending += 1;
      continue;
    }
    if (actual === null) continue;
    if (actual === entry.line) {
      r.pushes += 1;
      graded.push({ entry, actual, result: 'push' });
      continue;
    }
    r.bets += 1;
    const hit = entry.side === 'over' ? actual > entry.line : actual < entry.line;
    if (hit) {
      r.won += 1;
      r.profit += profitPerUnit(entry.side === 'over' ? entry.over : entry.under);
    } else {
      r.lost += 1;
      r.profit -= 1;
    }
    graded.push({ entry, actual, result: hit ? 'won' : 'lost' });
  }
  const recent = graded.sort((a, b) => b.entry.start.localeCompare(a.entry.start) || b.entry.edge - a.entry.edge).slice(0, keep);
  return { ...r, returnPerBet: r.bets ? r.profit / r.bets : 0, recent };
}
