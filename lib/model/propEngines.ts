import type { BoxScore, NflSkillBox, RosterEntry } from '../boxscores';
import type { Game, InjuryEntry } from '../espn';
import type { LeagueConfig } from '../leagues';
import type { PropMarket } from '../props';
import { NBA_MARKETS, nbaActuals, nbaPlayerPass, NbaPlayerParams, TeamContext } from './nbaPlayers';
import { NFL_MARKETS, nflActuals, nflPlayerPass, NflPlayerParams } from './nflPlayers';
import { NHL_MARKETS, nhlActuals, nhlPlayerPass, NhlPlayerParams } from './nhlPlayers';
import type { Actuals, GameProjection, PropModelParams } from './propModel';

/** Everything a league's player model reads. */
export type PropInputs = {
  games: Game[];
  box: Record<string, BoxScore | null>;
  /** NFL rushing and receiving box scores. */
  skill: Record<string, NflSkillBox | null>;
  context: TeamContext;
  live: {
    rosters: Record<string, RosterEntry[]>;
    injuries: Record<string, InjuryEntry[]>;
    /** Projected starting quarterbacks for upcoming NFL games. */
    starters: Map<string, { home: RosterEntry | null; away: RosterEntry | null }>;
  };
};

/** One league's player model, in the shape the model build and the backtest share. */
export type PropEngine<P extends PropModelParams = PropModelParams> = {
  params: P;
  markets: PropMarket[];
  project(params: P, inputs: PropInputs, keep: (game: Game) => boolean): Map<string, GameProjection>;
  actuals(gameId: string, inputs: PropInputs): Actuals | null;
  /** Tuning stages, each proposing settings around the best found so far. */
  stages: ((best: P) => P[])[];
  /** Markets whose average miss (relative to their size) drives tuning. */
  tuneMarkets: PropMarket[];
};

const around = <P,>(best: P, key: keyof P, values: number[]) => values.map((v) => ({ ...best, [key]: v }));

export function propEngine(league: LeagueConfig): PropEngine | null {
  if (league.id === 'nba' && league.players && league.lineups) {
    const lineups = league.lineups;
    const engine: PropEngine<NbaPlayerParams> = {
      params: league.players,
      markets: Object.keys(NBA_MARKETS) as PropMarket[],
      project: (params, i, keep) => nbaPlayerPass(i.games, i.box, params, lineups, i.context, i.live, keep),
      actuals: (id, i) => nbaActuals(i.box[id]),
      stages: [
        (best) => [0.95, 0.96, 0.97, 0.98, 0.99].flatMap((decay) => around({ ...best, decay }, 'priorMinutes', [5, 15, 30, 60])),
        (best) => [0, 0.25, 0.5, 0.75, 1].flatMap((teamShare) => around({ ...best, teamShare }, 'paceShare', [0, 0.5, 1]))
      ],
      tuneMarkets: ['pts', 'reb', 'ast']
    };
    return engine as unknown as PropEngine;
  }
  if (league.id === 'nhl' && league.nhlPlayers) {
    const engine: PropEngine<NhlPlayerParams> = {
      params: league.nhlPlayers,
      markets: NHL_MARKETS,
      project: (params, i, keep) => nhlPlayerPass(i.games, i.box, params, i.context, i.live, keep),
      actuals: (id, i) => nhlActuals(i.box[id]),
      stages: [
        (best) => [0.97, 0.98, 0.99, 0.995].flatMap((decay) => around({ ...best, decay }, 'priorToi', [60, 150, 300, 600])),
        (best) => around(best, 'toiAlpha', [0.1, 0.2, 0.35, 0.5, 0.7]),
        (best) => [0, 0.5, 1].flatMap((teamShare) => around({ ...best, teamShare }, 'shotShare', [0, 0.5, 1])),
        (best) => around(best, 'priorShots', [300, 1000, 2000, 5000, 20000])
      ],
      tuneMarkets: ['pts', 'sog', 'saves']
    };
    return engine as unknown as PropEngine;
  }
  if (league.id === 'nfl' && league.nflPlayers) {
    const engine: PropEngine<NflPlayerParams> = {
      params: league.nflPlayers,
      markets: NFL_MARKETS,
      project: (params, i, keep) => nflPlayerPass(i.games, i.box, i.skill, params, i.context, i.live, keep),
      actuals: (id, i) => nflActuals(i.box[id], i.skill[id]),
      stages: [
        (best) => [0.8, 0.85, 0.9, 0.95].flatMap((decay) => around({ ...best, decay }, 'volumeAlpha', [0.03, 0.06, 0.1, 0.2])),
        (best) => [3, 10, 25, 50].flatMap((priorTargets) => around({ ...best, priorTargets }, 'priorCarries', [5, 10, 20, 50])),
        (best) => around(best, 'priorAttempts', [50, 150, 300, 600]),
        (best) => around(best, 'teamShare', [0, 0.5, 1])
      ],
      tuneMarkets: ['rec_yds', 'rush_yds', 'pass_yds', 'rec']
    };
    return engine as unknown as PropEngine;
  }
  return null;
}
