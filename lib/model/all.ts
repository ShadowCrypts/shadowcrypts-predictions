import { LEAGUE_IDS, LeagueId } from '../leagues';
import { getLeagueModel, LeagueModel, Prediction } from './index';

export type AllModels = { models: LeagueModel[]; failed: LeagueId[] };

/** Loads every league; one league's outage shouldn't take down the whole page. */
export async function getAllModels(): Promise<AllModels> {
  const results = await Promise.allSettled(LEAGUE_IDS.map((id) => getLeagueModel(id)));
  const models: LeagueModel[] = [];
  const failed: LeagueId[] = [];
  results.forEach((result, i) => {
    if (result.status === 'fulfilled') models.push(result.value);
    else {
      failed.push(LEAGUE_IDS[i]);
      console.error(`Failed to build ${LEAGUE_IDS[i]} model`, result.reason);
    }
  });
  return { models, failed };
}

export function byStartTime(a: Prediction, b: Prediction) {
  return a.game.date.localeCompare(b.game.date);
}
