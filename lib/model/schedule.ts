import type { LeagueModel } from './index';

/** Games looked ahead for schedule strength. */
export const AHEAD = 5;

export type ScheduleStrength = {
  /** The opponents' average Elo over the team's next games. */
  average: number;
  games: number;
  /** 1 = the toughest coming stretch in the league. */
  rank: number;
  of: number;
};

/** Each team's average opponent rating over its next few games (teams with none coming are left out). */
function averages(model: Pick<LeagueModel, 'rankings' | 'teamGames' | 'predictions'>, ahead: number) {
  const rating = new Map(model.rankings.map((r) => [r.team.id, r.rating]));
  const out = new Map<string, { average: number; games: number }>();
  for (const r of model.rankings) {
    const next = (model.teamGames[r.team.id] ?? [])
      .map((id) => model.predictions[id])
      .filter((p) => p && !p.game.completed && p.game.state === 'pre')
      .sort((a, b) => a.game.date.localeCompare(b.game.date))
      .slice(0, ahead);
    const opponents = next.flatMap((p) => {
      const opp = p.game.home.teamId === r.team.id ? p.game.away.teamId : p.game.home.teamId;
      return rating.has(opp) ? [rating.get(opp)!] : [];
    });
    if (opponents.length) out.set(r.team.id, { average: opponents.reduce((a, b) => a + b, 0) / opponents.length, games: opponents.length });
  }
  return out;
}

/**
 * How hard a team's next few games are, by its opponents' current Elo, and
 * where that ranks among every team's next few. Null with nothing scheduled.
 */
export function scheduleStrength(model: Pick<LeagueModel, 'rankings' | 'teamGames' | 'predictions'>, teamId: string, ahead = AHEAD): ScheduleStrength | null {
  const all = averages(model, ahead);
  const mine = all.get(teamId);
  if (!mine) return null;
  const rank = [...all.values()].filter((x) => x.average > mine.average).length + 1;
  return { ...mine, rank, of: all.size };
}
