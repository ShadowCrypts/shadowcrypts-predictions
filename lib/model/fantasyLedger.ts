// Fantasy projections saved before each kickoff and graded after. The backtest on the
// page rebuilds past weeks knowing who was active; this doesn't, so it's the fairer
// test, and a player who was expected to play and didn't counts against us.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { getBoxScores, getNflSkillBoxes } from '../boxscores';
import type { Game } from '../espn';
import type { LeagueConfig } from '../leagues';
import { actualLines, FantasyLine, fantasyPoints, FantasyPosition, projectedPoints, rankCorrelation, weekEnd } from './fantasy';
import { fantasyBoard, FantasyRow } from './fantasyBoard';
import type { LeagueModel } from './index';

export type FantasyPick = {
  id: string;
  position: FantasyPosition;
  /** Corrected PPR points if he plays, the chance he does, and his season average going in. */
  points: number;
  available: number;
  average: number | null;
  games: number;
};
export type FantasyLedger = Record<string, { start: string; takenAt: string; picks: FantasyPick[] }>;

export type FantasyForward = {
  since: string | null;
  weeks: number;
  players: number;
  /** Expected to play and didn't (he counts as scoring nothing, for both sides). */
  sat: number;
  miss: number;
  averageMiss: number;
  order: number | null;
  averageOrder: number | null;
};

const FILE = path.join(process.cwd(), '.cache', 'fantasy-ledger.json');
/** Same bar as the backtest: a player's first three games leave nothing fair to compare with. */
const MIN_GAMES = 3;
const MIN_GROUP = 8;

export async function readFantasyLedger(): Promise<FantasyLedger> {
  try {
    return JSON.parse(await fs.readFile(FILE, 'utf8')) as FantasyLedger;
  } catch {
    return {};
  }
}

async function writeFantasyLedger(ledger: FantasyLedger) {
  try {
    await fs.mkdir(path.dirname(FILE), { recursive: true });
    const tmp = `${FILE}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(ledger));
    await fs.rename(tmp, FILE);
  } catch {
    // Without a writable disk the site still works; the forward test just doesn't grow.
  }
}

const pickOf = (r: FantasyRow): FantasyPick => ({
  id: r.id,
  position: r.position,
  points: Number(projectedPoints(r.projected, r.position).toFixed(2)),
  available: r.available,
  average: r.season ? Number(fantasyPoints(r.season).toFixed(2)) : null,
  games: r.games
});

/** Takes in this week's rows. Only a game that hasn't started can change, so what's on file at kickoff stays. */
export function withBoard(ledger: FantasyLedger, rows: FantasyRow[], now: Date): FantasyLedger {
  const next = { ...ledger };
  const byGame = new Map<string, FantasyRow[]>();
  for (const r of rows) (byGame.get(r.gameId) ?? byGame.set(r.gameId, []).get(r.gameId)!).push(r);
  for (const [gameId, players] of byGame) {
    const start = players[0].start;
    if (now.getTime() < Date.parse(start)) next[gameId] = { start, takenAt: now.toISOString(), picks: players.map(pickOf) };
  }
  return next;
}

/** Saves this week's board. Quietly does nothing if it can't be read. */
export async function recordFantasyBoard(league: LeagueConfig, model: LeagueModel, now: Date) {
  const board = await fantasyBoard(league, model, now);
  if (board?.rows.length) await writeFantasyLedger(withBoard(await readFantasyLedger(), board.rows, now));
}

const group = (p: FantasyPosition) => (p === 'QB' || p === 'RB' ? p : 'WR/TE');
const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / Math.max(1, xs.length);

/** Grades the games whose box scores are in. `linesFor` gives a game's real lines, or null until it's played. */
export function gradeFantasyLedger(ledger: FantasyLedger, linesFor: (gameId: string) => Map<string, FantasyLine> | null): FantasyForward {
  const rows: { key: string; ours: number; average: number; actual: number }[] = [];
  const weeks = new Set<string>();
  let sat = 0;
  for (const [gameId, entry] of Object.entries(ledger)) {
    const lines = linesFor(gameId);
    if (!lines) continue;
    weeks.add(weekEnd(entry.start));
    for (const p of entry.picks) {
      if (p.average === null || p.games < MIN_GAMES) continue;
      const line = lines.get(p.id);
      // Someone the report had out isn't a miss by anyone: nobody starts him.
      if (!line && p.available < 0.5) continue;
      if (!line) sat += 1;
      rows.push({ key: `${weekEnd(entry.start)}|${group(p.position)}`, ours: p.points * p.available, average: p.average, actual: line ? fantasyPoints(line) : 0 });
    }
  }
  const groups = new Map<string, typeof rows>();
  for (const r of rows) (groups.get(r.key) ?? groups.set(r.key, []).get(r.key)!).push(r);
  const full = [...groups.values()].filter((g) => g.length >= MIN_GROUP);
  const orderBy = (f: (r: (typeof rows)[number]) => number) => (full.length ? mean(full.map((g) => rankCorrelation(g.map(f), g.map((r) => r.actual)))) : null);
  const taken = Object.values(ledger).map((e) => e.takenAt).sort();
  return {
    since: taken[0] ?? null,
    weeks: weeks.size,
    players: rows.length,
    sat,
    miss: mean(rows.map((r) => Math.abs(r.ours - r.actual))),
    averageMiss: mean(rows.map((r) => Math.abs(r.average - r.actual))),
    order: orderBy((r) => r.ours),
    averageOrder: orderBy((r) => r.average)
  };
}

/** The forward test so far, from the stored box scores. */
export async function fantasyForward(league: LeagueConfig, model: LeagueModel): Promise<FantasyForward> {
  const ledger = await readFantasyLedger();
  const played = Object.keys(ledger)
    .map((id) => model.predictions[id]?.game)
    .filter((g): g is Game => !!g && g.completed);
  const [box, skill] = await Promise.all([getBoxScores(league, played, 0).catch(() => ({})), getNflSkillBoxes(league, played, 0).catch(() => ({}))]);
  const done = new Set(played.map((g) => g.id));
  return gradeFantasyLedger(ledger, (id) => {
    const lines = done.has(id) ? actualLines((box as Record<string, never>)[id], (skill as Record<string, never>)[id]) : null;
    return lines?.size ? lines : null;
  });
}
