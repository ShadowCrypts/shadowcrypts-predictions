import { getBoxScores, getNflSkillBoxes } from '../boxscores';
import type { Game } from '../espn';
import type { LeagueConfig } from '../leagues';
import { METRICS, TeamMetricValues, teamMetrics } from './teamMetrics';

/** Each team's metrics over a season's regular season before `before`, from stored box scores (nothing is fetched). */
export async function seasonTeamMetrics(league: LeagueConfig, games: Game[], seasonYear: number | null, before: string): Promise<TeamMetricValues | undefined> {
  if (!METRICS[league.id] || seasonYear === null) return undefined;
  const played = games.filter((g) => g.seasonYear === seasonYear && g.seasonType === 2 && g.completed && g.date < before);
  const [box, skill] = await Promise.all([getBoxScores(league, played, 0).catch(() => ({})), getNflSkillBoxes(league, played, 0).catch(() => ({}))]);
  return teamMetrics(league.id, played, box, skill);
}
