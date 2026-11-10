import type { GameSide, InjuryEntry, TeamInfo } from '../espn';
import type { InjuryImpact } from './adjustments';
import { missChance } from './adjustments';

/** A team's next game, as far as an injury report cares. */
export type InjuryNextGame = { gameId: string; opponent: string; home: boolean; date: string };

export type InjuryReportRow = {
  id: string;
  name: string;
  position: string | null;
  status: string;
  comment: string | null;
  date: string | null;
  /** What he takes off the team's rating for its next game (≤ 0); null with no game on the board. */
  elo: number | null;
  reason: string | null;
};

export type InjuryReportTeam = {
  id: string;
  name: string;
  abbr: string;
  logo: string | null;
  color: string;
  next: InjuryNextGame | null;
  rows: InjuryReportRow[];
};

type TeamEntry = Pick<TeamInfo, 'id' | 'name' | 'shortName' | 'abbr' | 'logo'> & { color: string };
type NextPrediction = { game: { id: string; date: string; home: GameSide; away: GameSide }; injuries: { home: InjuryImpact[]; away: InjuryImpact[] } | null };

/** How much a change in rating moves an even game's chances, in points of win chance. */
export const eloToPoints = (elo: number) => (1 / (1 + 10 ** (-elo / 400)) - 0.5) * 100;

/** "Active" on the report is a player back from it: nothing to report. */
const listed = (entry: InjuryEntry) => !/^active$/i.test(entry.status);

/** Worst first: what he costs, then how likely he is to sit, then by name. */
const byCost = (a: InjuryReportRow, b: InjuryReportRow) => (a.elo ?? 0) - (b.elo ?? 0) || missChance(b.status) - missChance(a.status) || a.name.localeCompare(b.name);

/** One team's report, each entry priced by the forecast for its next game when it has one. */
export function teamInjuryReport(team: TeamEntry, report: InjuryEntry[], nextGame: NextPrediction | null): InjuryReportTeam {
  const home = nextGame?.game.home.teamId === team.id;
  const impacts = new Map((nextGame?.injuries ? (home ? nextGame.injuries.home : nextGame.injuries.away) : []).map((i) => [i.athleteId, i]));
  const rows = report.filter(listed).map((entry): InjuryReportRow => {
    const impact = impacts.get(entry.athleteId);
    return { id: entry.athleteId, name: entry.name, position: entry.position, status: entry.status, comment: entry.comment, date: entry.date, elo: nextGame?.injuries ? (impact?.elo ?? 0) : null, reason: impact?.reason ?? null };
  });
  return {
    id: team.id,
    name: team.shortName,
    abbr: team.abbr,
    logo: team.logo,
    color: team.color,
    next: nextGame ? { gameId: nextGame.game.id, opponent: (home ? nextGame.game.away : nextGame.game.home).abbr, home, date: nextGame.game.date } : null,
    rows: rows.sort(byCost)
  };
}

/** The costliest absences across a league. A cost under half an Elo point isn't one anybody could notice. */
export function biggestAbsences(teams: InjuryReportTeam[], shown = 8) {
  return teams
    .flatMap((team) => team.rows.filter((r) => r.elo !== null && r.elo <= -0.5).map((row) => ({ team, row })))
    .sort((a, b) => byCost(a.row, b.row))
    .slice(0, shown);
}
