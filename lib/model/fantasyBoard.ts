import { getBoxScores, getNflSkillBoxes, getTeamRoster } from '../boxscores';
import type { LeagueConfig } from '../leagues';
import { displayColor } from '../teamColor';
import { actualLines, averageLine, FantasyLine, FantasyPosition, fantasyPosition, projectedLine, weekEnd } from './fantasy';
import type { LeagueModel } from './index';

export type FantasyRow = {
  id: string;
  name: string;
  position: FantasyPosition;
  team: { id: string; abbr: string; logo: string | null; color: string };
  opponent: string;
  home: boolean;
  gameId: string;
  start: string;
  /** Chance he plays, from the injury report; the status when he's on it. */
  available: number;
  status: string | null;
  projected: FantasyLine;
  /** His average over his last three games this season, and all of them. */
  recent: FantasyLine | null;
  season: FantasyLine | null;
  games: number;
};

export type FantasyBoard = {
  start: string;
  end: string;
  rows: FantasyRow[];
  /** Teams with no game this week, and those whose game has already kicked off (so their players are gone from the rows). */
  byes: string[];
  started: string[];
};

/** The next NFL week: every player projected in its games, with what he's done this season. Reads stored box scores and cached rosters. */
export async function fantasyBoard(league: LeagueConfig, model: LeagueModel, now = new Date()): Promise<FantasyBoard | null> {
  const coming = Object.keys(model.playerProjections)
    .map((id) => model.predictions[id]?.game)
    .filter((g) => g && g.state === 'pre' && g.seasonType === 2 && Date.parse(g.date) > now.getTime())
    .sort((a, b) => a.date.localeCompare(b.date));
  if (!coming.length) return null;
  const end = weekEnd(coming[0].date);
  const week = coming.filter((g) => g.date < end);

  const played = Object.values(model.predictions)
    .map((p) => p.game)
    .filter((g) => g.completed && g.seasonType === 2 && g.seasonYear === model.season.year)
    .sort((a, b) => a.date.localeCompare(b.date));
  const [box, skill, rosters] = await Promise.all([
    getBoxScores(league, played, 0).catch(() => ({})),
    getNflSkillBoxes(league, played, 0).catch(() => ({})),
    Promise.all(model.rankings.map((r) => getTeamRoster(league, r.team.id).catch(() => [])))
  ]);
  const positions = new Map(rosters.flat().map((p) => [p.id, p.position]));
  const history = new Map<string, FantasyLine[]>();
  for (const g of played) {
    for (const [id, line] of actualLines((box as Record<string, never>)[g.id], (skill as Record<string, never>)[g.id])) {
      const list = history.get(id);
      if (list) list.push(line);
      else history.set(id, [line]);
    }
  }

  const rows: FantasyRow[] = [];
  for (const game of week) {
    const projection = model.playerProjections[game.id];
    for (const side of ['home', 'away'] as const) {
      const team = model.teams[game[side].teamId];
      const opponent = side === 'home' ? game.away : game.home;
      // The report lists healthy returners as "Active": nothing to warn about.
      const report = new Map((model.injuries[game[side].teamId] ?? []).filter((i) => !/^active$/i.test(i.status)).map((i) => [i.athleteId, i.status]));
      for (const p of projection[side]) {
        const position = fantasyPosition(positions.get(p.id), p.detail);
        if (!position || !team) continue;
        const past = history.get(p.id) ?? [];
        rows.push({
          id: p.id,
          name: p.name,
          position,
          team: { id: team.id, abbr: team.abbr, logo: team.logo, color: displayColor(team.color, team.altColor) },
          opponent: opponent.abbr,
          home: side === 'home',
          gameId: game.id,
          start: game.date,
          available: p.available,
          status: report.get(p.id) ?? null,
          projected: projectedLine(p),
          recent: averageLine(past.slice(-3)),
          season: averageLine(past),
          games: past.length
        });
      }
    }
  }
  // The whole week, kicked off or not: a team that played Thursday isn't on a bye.
  const whole = Object.values(model.predictions)
    .map((p) => p.game)
    .filter((g) => g.seasonType === 2 && weekEnd(g.date) === end);
  const playing = new Set(whole.flatMap((g) => [g.home.teamId, g.away.teamId]));
  const abbrs = (games: typeof whole) => games.flatMap((g) => [g.away.abbr, g.home.abbr]).sort();
  return {
    start: whole.map((g) => g.date).sort()[0],
    end,
    rows,
    byes: model.rankings.filter((r) => !playing.has(r.team.id)).map((r) => r.team.abbr).sort(),
    started: abbrs(whole.filter((g) => g.state !== 'pre'))
  };
}
