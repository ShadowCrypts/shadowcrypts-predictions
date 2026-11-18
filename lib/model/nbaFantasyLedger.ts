// Fantasy basketball projections saved before each tip-off and graded after. The backtest on the page
// rebuilds past nights knowing who dressed; this doesn't, so it's the fairer test, and a player who was
// expected to play and didn't counts against us. One file a month keeps each write small.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { type BoxScore, getBoxScores } from '../boxscores';
import type { Game } from '../espn';
import type { LeagueConfig } from '../leagues';
import { etDateKey } from '../time';
import { rankCorrelation } from './fantasy';
import type { LeagueModel } from './index';
import { nbaActualLine, nbaFantasyPoints } from './nbaFantasy';
import { NBA_MIN_GAMES, nbaFantasyBoardFor, type NbaFantasyRow } from './nbaFantasyBoard';

/** id, projected points if he plays, chance he plays, season average going in (or null), games behind it. */
export type NbaFantasyPick = [string, number, number, number | null, number];
export type NbaFantasyLedger = Record<string, { start: string; takenAt: string; picks: NbaFantasyPick[] }>;

export type NbaFantasyForward = { nights: number; players: number; sat: number; miss: number; averageMiss: number; order: number | null; averageOrder: number | null };

const DIR = path.join(process.cwd(), '.cache');
const PREFIX = 'nba-fantasy-ledger-';
const fileFor = (month: string) => path.join(DIR, `${PREFIX}${month}.json`);
/** Only games this close to tip-off are saved: the last copy before the start is the one graded. */
const SAVE_WITHIN_MS = 12 * 3_600_000;
const MIN_NIGHT = 8;

async function readMonth(month: string): Promise<NbaFantasyLedger> {
  try {
    return JSON.parse(await fs.readFile(fileFor(month), 'utf8')) as NbaFantasyLedger;
  } catch {
    return {};
  }
}

async function writeMonth(month: string, ledger: NbaFantasyLedger) {
  try {
    await fs.mkdir(DIR, { recursive: true });
    const file = fileFor(month);
    const tmp = `${file}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(ledger));
    await fs.rename(tmp, file);
  } catch {
    // Without a writable disk the site still works; the forward test just doesn't grow.
  }
}

const round = (n: number) => Math.round(n * 100) / 100;
const pickOf = (r: NbaFantasyRow): NbaFantasyPick => [r.id, round(nbaFantasyPoints(r.projected)), round(r.available), r.season ? round(nbaFantasyPoints(r.season)) : null, r.games];
const monthOf = (iso: string) => etDateKey(iso).slice(0, 7).replace('-', '');

/** Takes in the board's games that start soon. Only a game that hasn't started can change, so what's on file at tip-off stays. */
export function withNbaBoard(ledger: NbaFantasyLedger, rows: NbaFantasyRow[], now: Date): { ledger: NbaFantasyLedger; changed: boolean } {
  const next = { ...ledger };
  let changed = false;
  const byGame = new Map<string, NbaFantasyRow[]>();
  for (const r of rows) {
    const until = Date.parse(r.start) - now.getTime();
    if (until > 0 && until <= SAVE_WITHIN_MS) (byGame.get(r.gameId) ?? byGame.set(r.gameId, []).get(r.gameId)!).push(r);
  }
  for (const [gameId, players] of byGame) {
    const picks = players.map(pickOf);
    if (JSON.stringify(next[gameId]?.picks) === JSON.stringify(picks)) continue;
    next[gameId] = { start: players[0].start, takenAt: now.toISOString(), picks };
    changed = true;
  }
  return { ledger: next, changed };
}

/** Saves the games about to start. Quietly does nothing if it can't. */
export async function recordNbaFantasyBoard(league: LeagueConfig, model: LeagueModel, now: Date) {
  const board = await nbaFantasyBoardFor(league, model);
  if (!board?.rows.length) return;
  const byMonth = new Map<string, NbaFantasyRow[]>();
  for (const r of board.rows) (byMonth.get(monthOf(r.start)) ?? byMonth.set(monthOf(r.start), []).get(monthOf(r.start))!).push(r);
  for (const [month, rows] of byMonth) {
    const { ledger, changed } = withNbaBoard(await readMonth(month), rows, now);
    if (changed) await writeMonth(month, ledger);
  }
}

const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / Math.max(1, xs.length);

/** Grades the games whose box scores are in. `pointsFor` gives each player's real points in a game, or null until it's played. */
export function gradeNbaFantasyLedger(ledger: NbaFantasyLedger, pointsFor: (gameId: string) => Map<string, number> | null): NbaFantasyForward {
  const rows: { night: string; ours: number; average: number; actual: number }[] = [];
  let sat = 0;
  for (const [gameId, entry] of Object.entries(ledger)) {
    const points = pointsFor(gameId);
    if (!points) continue;
    for (const [id, projected, available, average, games] of entry.picks) {
      if (average === null || games < NBA_MIN_GAMES) continue;
      const scored = points.get(id);
      // Someone the report had out isn't a miss by anyone: nobody starts him.
      if (scored === undefined && available < 0.5) continue;
      if (scored === undefined) sat += 1;
      rows.push({ night: etDateKey(entry.start), ours: projected * available, average, actual: scored ?? 0 });
    }
  }
  const nights = new Map<string, typeof rows>();
  for (const r of rows) (nights.get(r.night) ?? nights.set(r.night, []).get(r.night)!).push(r);
  const full = [...nights.values()].filter((n) => n.length >= MIN_NIGHT);
  const orderBy = (f: (r: (typeof rows)[number]) => number) => (full.length ? mean(full.map((n) => rankCorrelation(n.map(f), n.map((r) => r.actual)))) : null);
  return {
    nights: nights.size,
    players: rows.length,
    sat,
    miss: mean(rows.map((r) => Math.abs(r.ours - r.actual))),
    averageMiss: mean(rows.map((r) => Math.abs(r.average - r.actual))),
    order: orderBy((r) => r.ours),
    averageOrder: orderBy((r) => r.average)
  };
}

/** Every month on file, merged. */
async function readAll(): Promise<NbaFantasyLedger> {
  let names: string[] = [];
  try {
    names = (await fs.readdir(DIR)).filter((n) => n.startsWith(PREFIX) && n.endsWith('.json'));
  } catch {
    return {};
  }
  const months = await Promise.all(names.map((n) => readMonth(n.slice(PREFIX.length, -'.json'.length))));
  return Object.assign({}, ...months) as NbaFantasyLedger;
}

async function forward(league: LeagueConfig, model: LeagueModel): Promise<NbaFantasyForward> {
  const ledger = await readAll();
  const played = Object.keys(ledger)
    .map((id) => model.predictions[id]?.game)
    .filter((g): g is Game => !!g && g.completed);
  const box = (await getBoxScores(league, played, 0).catch(() => ({}))) as Record<string, BoxScore | null>;
  return gradeNbaFantasyLedger(ledger, (id) => {
    const b = box[id];
    if (b?.league !== 'nba') return null;
    const lines = Object.values(b.teams).flat().filter((l) => l.min > 0);
    return lines.length ? new Map(lines.map((l) => [l.id, nbaFantasyPoints(nbaActualLine(l))])) : null;
  });
}

/** The forward test so far, worked out once per model build. */
const forwards = new WeakMap<LeagueModel, Promise<NbaFantasyForward>>();
export function nbaFantasyForward(league: LeagueConfig, model: LeagueModel) {
  let result = forwards.get(model);
  if (!result) {
    result = forward(league, model).catch(() => ({ nights: 0, players: 0, sat: 0, miss: 0, averageMiss: 0, order: null, averageOrder: null }));
    forwards.set(model, result);
  }
  return result;
}
