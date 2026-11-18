// Fantasy basketball's board: every rotation player's next game, projected, with what he's done this
// season and how many games his team has left this fantasy week (Monday to Sunday, the usual week).
import { type BoxScore, getBoxScores, getTeamRoster } from '../boxscores';
import type { Game } from '../espn';
import type { LeagueConfig } from '../leagues';
import { displayColor } from '../teamColor';
import { etDateKey, shiftDateKey } from '../time';
import type { LeagueModel } from './index';
import { averageNbaLine, nbaActualLine, nbaFantasyGroup, nbaFantasyPoints, NbaFantasyGroup, NbaFantasyLine, nbaFantasyRange, nbaProjectedLine } from './nbaFantasy';

export type NbaFantasyRow = {
  id: string;
  name: string;
  /** The roster's position ("PG", "SF", "C"…) and the fantasy group it falls in. */
  position: string | null;
  group: NbaFantasyGroup | null;
  team: { id: string; abbr: string; logo: string | null; color: string };
  opponent: string;
  home: boolean;
  gameId: string;
  start: string;
  /** His next game's day in Eastern time. */
  day: string;
  minutes: number;
  /** Chance he plays, from the injury report; the status when he's on it. */
  available: number;
  status: string | null;
  projected: NbaFantasyLine;
  /** His average over his last five games this season, and all of them. */
  recent: NbaFantasyLine | null;
  season: NbaFantasyLine | null;
  games: number;
  /** Games his team has left this fantasy week, counting this one, and games it plays next week. */
  weekLeft: number;
  nextWeek: number;
};

export type NbaScheduleTeam = {
  id: string;
  abbr: string;
  logo: string | null;
  /** This week, Monday first: the opponent ("@BOS", "vs NYK") or null, and whether that game has started. */
  days: ({ label: string; done: boolean } | null)[];
  total: number;
  left: number;
  nextWeek: number;
};

export type NbaFantasyBoard = {
  /** The first day with games still to tip off, in Eastern time. */
  day: string;
  rows: NbaFantasyRow[];
  /** Teams whose game that day has already started (their players' next game is a later one). */
  started: string[];
  week: { start: string; end: string; teams: NbaScheduleTeam[] };
};

/** A player's first few games leave a season average too thin to rank on. */
export const NBA_MIN_GAMES = 5;

/** Monday of the fantasy week a day falls in. */
export function weekStartOf(dateKey: string) {
  const dow = new Date(`${dateKey}T16:00:00Z`).getUTCDay();
  return shiftDateKey(dateKey, -((dow + 6) % 7));
}

export async function nbaFantasyBoard(league: LeagueConfig, model: LeagueModel, now = new Date()): Promise<NbaFantasyBoard | null> {
  const coming = Object.keys(model.playerProjections)
    .map((id) => model.predictions[id]?.game)
    .filter((g): g is Game => !!g && g.state === 'pre' && Date.parse(g.date) > now.getTime())
    .sort((a, b) => a.date.localeCompare(b.date));
  if (!coming.length) return null;
  const day = etDateKey(coming[0].date);
  const weekStart = weekStartOf(day);
  const weekEnd = shiftDateKey(weekStart, 6);
  const nextStart = shiftDateKey(weekStart, 7);
  const nextEnd = shiftDateKey(weekStart, 13);

  const all = Object.values(model.predictions)
    .map((p) => p.game)
    .filter((g) => g.seasonType === 2);
  const played = all.filter((g) => g.completed && g.seasonYear === model.season.year).sort((a, b) => a.date.localeCompare(b.date));
  const [box, rosters] = await Promise.all([getBoxScores(league, played, 0).catch(() => ({})), Promise.all(model.rankings.map((r) => getTeamRoster(league, r.team.id).catch(() => [])))]);
  const positions = new Map(rosters.flat().map((p) => [p.id, p.position]));
  const history = new Map<string, NbaFantasyLine[]>();
  for (const g of played) {
    const b = (box as Record<string, BoxScore | null>)[g.id];
    if (b?.league !== 'nba') continue;
    for (const line of Object.values(b.teams).flat()) {
      if (line.min <= 0) continue;
      const list = history.get(line.id);
      if (list) list.push(nbaActualLine(line));
      else history.set(line.id, [nbaActualLine(line)]);
    }
  }

  // The schedule grid: this week and next, from the whole season's schedule.
  const inRange = (g: Game, from: string, to: string) => {
    const key = etDateKey(g.date);
    return key >= from && key <= to;
  };
  const thisWeek = all.filter((g) => inRange(g, weekStart, weekEnd));
  const nextWeekGames = all.filter((g) => inRange(g, nextStart, nextEnd));
  const isLeft = (g: Game) => g.state === 'pre' && Date.parse(g.date) > now.getTime();
  const teams: NbaScheduleTeam[] = model.rankings
    .map((r) => {
      const id = r.team.id;
      const mine = thisWeek.filter((g) => g.home.teamId === id || g.away.teamId === id);
      const days = Array.from({ length: 7 }, (_, i) => {
        const key = shiftDateKey(weekStart, i);
        const g = mine.find((x) => etDateKey(x.date) === key);
        if (!g) return null;
        const home = g.home.teamId === id;
        return { label: `${home ? 'vs' : '@'} ${home ? g.away.abbr : g.home.abbr}`, done: !isLeft(g) };
      });
      return {
        id,
        abbr: r.team.abbr,
        logo: model.teams[id]?.logo ?? null,
        days,
        total: mine.length,
        left: mine.filter(isLeft).length,
        nextWeek: nextWeekGames.filter((g) => g.home.teamId === id || g.away.teamId === id).length
      };
    })
    .sort((a, b) => b.left - a.left || b.total - a.total || a.abbr.localeCompare(b.abbr));
  const byTeam = new Map(teams.map((t) => [t.id, t]));

  const rows: NbaFantasyRow[] = [];
  const seen = new Set<string>();
  for (const game of coming) {
    const projection = model.playerProjections[game.id];
    for (const side of ['home', 'away'] as const) {
      const teamId = game[side].teamId;
      const team = model.teams[teamId];
      if (!team) continue;
      const opponent = side === 'home' ? game.away : game.home;
      const report = new Map((model.injuries[teamId] ?? []).filter((i) => !/^active$/i.test(i.status)).map((i) => [i.athleteId, i.status]));
      for (const p of projection[side]) {
        // Rotation players only: deep bench minutes don't move a fantasy lineup.
        if (!p.featured || seen.has(p.id)) continue;
        seen.add(p.id);
        const past = history.get(p.id) ?? [];
        const position = positions.get(p.id) ?? null;
        const schedule = byTeam.get(teamId);
        rows.push({
          id: p.id,
          name: p.name,
          position,
          group: nbaFantasyGroup(position ?? undefined),
          team: { id: team.id, abbr: team.abbr, logo: team.logo, color: displayColor(team.color, team.altColor) },
          opponent: opponent.abbr,
          home: side === 'home',
          gameId: game.id,
          start: game.date,
          day: etDateKey(game.date),
          minutes: Number.parseFloat(p.detail) || 0,
          available: p.available,
          status: report.get(p.id) ?? null,
          projected: nbaProjectedLine(p),
          recent: averageNbaLine(past.slice(-5)),
          season: averageNbaLine(past),
          games: past.length,
          // His next game is a later week's when the team's games this week are all done.
          weekLeft: etDateKey(game.date) <= weekEnd ? (schedule?.left ?? 1) : 0,
          nextWeek: schedule?.nextWeek ?? 0
        });
      }
    }
  }

  return {
    day,
    rows,
    started: [...new Set(all.filter((g) => etDateKey(g.date) === day && !isLeft(g)).flatMap((g) => [g.away.abbr, g.home.abbr]))].sort(),
    week: { start: weekStart, end: weekEnd, teams }
  };
}

/** Worked out once per model build and shared by every page that asks (the rankings page and every NBA player page). */
const boards = new WeakMap<LeagueModel, Promise<NbaFantasyBoard | null>>();
export function nbaFantasyBoardFor(league: LeagueConfig, model: LeagueModel): Promise<NbaFantasyBoard | null> {
  let board = boards.get(model);
  if (!board) {
    board = nbaFantasyBoard(league, model).catch(() => null);
    boards.set(model, board);
  }
  return board;
}

/** One player's fantasy outlook, for his page. */
export type NbaFantasyCard = {
  row: NbaFantasyRow;
  points: number;
  range: [number, number];
  /** Rank among everyone playing that day by expected points (discounted for the chance he sits), and in the league by season average. */
  dayRank: number;
  dayPlayers: number;
  seasonRank: number | null;
  average: number | null;
  recent: number | null;
};

export function nbaFantasyCard(board: NbaFantasyBoard, id: string): NbaFantasyCard | null {
  const row = board.rows.find((r) => r.id === id);
  if (!row) return null;
  const points = nbaFantasyPoints(row.projected);
  const expected = (r: NbaFantasyRow) => nbaFantasyPoints(r.projected) * r.available;
  const sameDay = board.rows.filter((r) => r.day === row.day);
  const average = row.season ? nbaFantasyPoints(row.season) : null;
  const seasoned = board.rows.filter((r) => r.season && r.games >= NBA_MIN_GAMES);
  return {
    row,
    points,
    range: nbaFantasyRange(points),
    dayRank: sameDay.filter((r) => expected(r) > expected(row)).length + 1,
    dayPlayers: sameDay.length,
    seasonRank: average !== null && row.games >= NBA_MIN_GAMES ? seasoned.filter((r) => nbaFantasyPoints(r.season!) > average).length + 1 : null,
    average,
    recent: row.recent ? nbaFantasyPoints(row.recent) : null
  };
}
