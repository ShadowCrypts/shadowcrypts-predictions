// This NFL week's start 'em, sit 'em page: the picks from the board, the starters on the injury report, the
// picker's player list, and how last week's calls did, from the projections locked before those games.
import { getBoxScores, getNflSkillBoxes } from '../boxscores';
import type { Game } from '../espn';
import type { LeagueConfig } from '../leagues';
import { actualLines, FANTASY_RANGE, fantasyPoints, projectedPoints, weekEnd, type FantasyPosition } from './fantasy';
import { fantasyBoard, type FantasyRow } from './fantasyBoard';
import { readFantasyLedger } from './fantasyLedger';
import type { LeagueModel } from './index';
import { gradeStartSit, MIN_GAMES, nflWeekNumber, pickStartSit, type StartSitCandidate, type StartSitGrade, type StartSitPick } from './startSit';

/** A 12-team league's starters at each position: who counts as a regular starter for the injury watch. */
const STARTERS: Record<FantasyPosition, number> = { QB: 12, RB: 24, WR: 30, TE: 12 };

export type StartSitEntry = StartSitPick & { row: FantasyRow };
export type StartSitWeek = {
  week: number | null;
  start: string;
  end: string;
  /** Everyone on this week's board, for player pages' fantasy box. */
  rows: FantasyRow[];
  picks: Record<FantasyPosition, { start: StartSitEntry[]; sit: StartSitEntry[] }>;
  /** Regular starters on the injury report this week, by position rank. */
  injuries: { row: FantasyRow; rank: number }[];
  /** Everyone projected, for the picker: PPR points if he plays, best first. */
  players: { id: string; name: string; position: FantasyPosition; team: string; opponent: string; home: boolean; points: number; available: number; status: string | null; projected: FantasyRow['projected'] }[];
  byes: string[];
  started: string[];
  lastWeek: { week: number | null; grade: StartSitGrade } | null;
};

const candidate = (r: FantasyRow): StartSitCandidate => ({
  id: r.id,
  position: r.position,
  points: projectedPoints(r.projected, r.position),
  available: r.available,
  average: r.season ? fantasyPoints(r.season) : null,
  games: r.games,
  status: r.status
});

/** The regular season's game dates, for numbering weeks. */
const seasonDates = (model: LeagueModel) =>
  Object.values(model.predictions)
    .map((p) => p.game)
    .filter((g) => g.seasonType === 2 && g.seasonYear === model.season.year)
    .map((g) => g.date);

/** Last week's calls, made again from what was locked before its games, and graded once they're all over. */
async function gradeLastWeek(league: LeagueConfig, model: LeagueModel, thisWeekEnd: string): Promise<StartSitWeek['lastWeek']> {
  const ledger = await readFantasyLedger();
  const weeks = [...new Set(Object.values(ledger).map((e) => weekEnd(e.start)))].filter((w) => w < thisWeekEnd).sort();
  const last = weeks[weeks.length - 1];
  if (!last) return null;
  const entries = Object.entries(ledger).filter(([, e]) => weekEnd(e.start) === last);
  const games = entries.map(([id]) => model.predictions[id]?.game).filter((g): g is Game => !!g);
  // Every game of that week has to be over, with its box score in.
  if (games.length !== entries.length || games.some((g) => !g.completed)) return null;
  const [box, skill] = await Promise.all([getBoxScores(league, games, 0).catch(() => ({})), getNflSkillBoxes(league, games, 0).catch(() => ({}))]);
  const scored = new Map<string, number>();
  for (const g of games) {
    const lines = actualLines((box as Record<string, never>)[g.id], (skill as Record<string, never>)[g.id]);
    if (!lines.size) return null;
    for (const [id, line] of lines) scored.set(id, fantasyPoints(line));
  }
  const picks = pickStartSit(entries.flatMap(([, e]) => e.picks.map((p) => ({ id: p.id, position: p.position, points: p.points, available: p.available, average: p.average, games: p.games }))));
  return { week: nflWeekNumber(seasonDates(model), last), grade: gradeStartSit(picks, (id) => scored.get(id) ?? null) };
}

/**
 * The week, worked out once per model build and shared by every page that asks (the start/sit page and every
 * NFL player page's fantasy box), rather than once a request.
 */
const weeks = new WeakMap<LeagueModel, Promise<StartSitWeek | null>>();
export function startSitWeekFor(league: LeagueConfig, model: LeagueModel): Promise<StartSitWeek | null> {
  let week = weeks.get(model);
  if (!week) {
    week = startSitWeek(league, model).catch(() => null);
    weeks.set(model, week);
  }
  return week;
}

/** One player's fantasy week, for his page: his projection and its likely range, where it ranks, and the start/sit call. */
export type FantasyCard = {
  week: number | null;
  row: FantasyRow;
  points: number;
  range: [number, number];
  /** Rank at his position this week by expected points (discounted for the chance he sits), and by season average. */
  weekRank: number;
  seasonRank: number | null;
  average: number | null;
  recent: number | null;
  verdict: 'start' | 'sit' | null;
  gap: number | null;
};

export function fantasyCard(week: StartSitWeek, id: string): FantasyCard | null {
  const row = week.rows.find((r) => r.id === id);
  if (!row) return null;
  const points = projectedPoints(row.projected, row.position);
  const [lo, hi] = FANTASY_RANGE[row.position];
  const same = week.rows.filter((r) => r.position === row.position);
  const expected = (r: FantasyRow) => projectedPoints(r.projected, r.position) * r.available;
  const weekRank = same.filter((r) => expected(r) > expected(row)).length + 1;
  const average = row.season ? fantasyPoints(row.season) : null;
  const seasoned = same.filter((r) => r.season && r.games >= MIN_GAMES);
  const seasonRank = average !== null && row.games >= MIN_GAMES ? seasoned.filter((r) => fantasyPoints(r.season!) > average).length + 1 : null;
  const { start, sit } = week.picks[row.position];
  const verdict = start.some((e) => e.id === id) ? 'start' : sit.some((e) => e.id === id) ? 'sit' : null;
  return {
    week: week.week,
    row,
    points,
    range: [points * lo, points * hi],
    weekRank,
    seasonRank,
    average,
    recent: row.recent ? fantasyPoints(row.recent) : null,
    verdict,
    gap: average === null ? null : points - average
  };
}

export async function startSitWeek(league: LeagueConfig, model: LeagueModel, now = new Date()): Promise<StartSitWeek | null> {
  const board = await fantasyBoard(league, model, now);
  if (!board?.rows.length) return null;
  const byId = new Map(board.rows.map((r) => [r.id, r]));
  const candidates = board.rows.map(candidate);
  const chosen = pickStartSit(candidates);
  const withRow = (list: StartSitPick[]) => list.map((p) => ({ ...p, row: byId.get(p.id)! }));
  const picks = Object.fromEntries(Object.entries(chosen).map(([pos, { start, sit }]) => [pos, { start: withRow(start), sit: withRow(sit) }])) as StartSitWeek['picks'];

  // Regular starters by season average, at each position, who are on the report.
  const injuries: StartSitWeek['injuries'] = [];
  for (const position of Object.keys(STARTERS) as FantasyPosition[]) {
    const ranked = candidates.filter((c) => c.position === position && c.average !== null && c.games >= MIN_GAMES).sort((a, b) => b.average! - a.average!);
    ranked.slice(0, STARTERS[position]).forEach((c, i) => {
      const row = byId.get(c.id)!;
      if (row.status) injuries.push({ row, rank: i + 1 });
    });
  }

  return {
    week: nflWeekNumber(seasonDates(model), board.end),
    start: board.start,
    end: board.end,
    rows: board.rows,
    picks,
    injuries,
    // Anyone a lineup might hold: projected 3 points or more (deep backups only clutter the picker).
    players: board.rows
      .filter((r) => projectedPoints(r.projected, r.position) >= 3)
      .map((r) => ({ id: r.id, name: r.name, position: r.position, team: r.team.abbr, opponent: r.opponent, home: r.home, points: projectedPoints(r.projected, r.position), available: r.available, status: r.status, projected: r.projected }))
      .sort((a, b) => b.points - a.points),
    byes: board.byes,
    started: board.started,
    lastWeek: await gradeLastWeek(league, model, board.end).catch(() => null)
  };
}
