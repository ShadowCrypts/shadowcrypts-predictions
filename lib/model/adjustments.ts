import type { Game, GameSide, InjuryEntry, SeasonLeader } from '../espn';
import type { LeagueId } from '../leagues';

// Injury adjustments only apply to upcoming games. ESPN doesn't publish
// historical injury reports, so they can't be backtested; they're kept
// deliberately small and every one is shown on the game page. (Starting
// pitchers and goalies are rated from history instead; see starters.ts.)

export type InjuryImpact = InjuryEntry & {
  /** Chance the player sits, from the report status. */
  missChance: number;
  /** Elo value of the player at full availability. */
  value: number;
  /** Applied adjustment (≤ 0). */
  elo: number;
  reason: string;
};

const TEAM_INJURY_CAP = 150;
const RECENT_GAMES = 10;

export function missChance(status: string) {
  const s = status.toLowerCase();
  if (s === 'out' || s.includes('injured reserve') || /\bil\b|-il\b/.test(s) || s.includes('suspen')) return 1;
  if (s.includes('doubtful')) return 0.8;
  if (s.includes('day-to-day')) return 0.4;
  if (s.includes('questionable')) return 0.35;
  return 0;
}

type Weights = Record<string, { elo: number; label: string }>;

// NFL: the team's top rusher and receiver, each well under a point of spread.
// Quarterbacks are valued by the quarterback model instead (quarterbacks.ts).
const NFL_SEASON_LEADERS: Weights = {
  rushingLeader: { elo: 15, label: 'Team rushing leader' },
  receivingLeader: { elo: 15, label: 'Team receiving leader' }
};

// NBA/NHL: value comes from how often the player led the team in a box-score
// category over its last 10 games. Recency matters: a player who's been out
// for weeks is already priced into the team's rating, and scores ~0 here.
const RECENT_LEADER_WEIGHTS: Partial<Record<LeagueId, { weights: Weights; cap: number }>> = {
  nba: {
    cap: 90,
    weights: {
      points: { elo: 70, label: 'scoring' },
      rebounds: { elo: 25, label: 'rebounding' },
      assists: { elo: 25, label: 'assists' }
    }
  },
  nhl: { cap: 30, weights: { points: { elo: 30, label: 'points' } } }
};

function sideFor(game: Game, teamId: string): GameSide {
  return game.home.teamId === teamId ? game.home : game.away;
}

function playerValues(league: LeagueId, side: GameSide, recentGames: Game[], seasonLeaders: SeasonLeader[]) {
  const values = new Map<string, { value: number; reason: string }>();

  if (league === 'nfl') {
    for (const [category, weight] of Object.entries(NFL_SEASON_LEADERS)) {
      const ranked = seasonLeaders.filter((l) => l.category === category);
      const leader = ranked[0];
      if (!leader || leader.value <= 0) continue;
      const reason = `${weight.label} (${leader.display})`;
      const current = values.get(leader.athleteId);
      values.set(leader.athleteId, {
        value: (current?.value ?? 0) + weight.elo,
        reason: current ? `${current.reason}; ${reason.charAt(0).toLowerCase()}${reason.slice(1)}` : reason
      });
    }
    return values;
  }

  const config = RECENT_LEADER_WEIGHTS[league];
  if (!config) return values;
  const games = recentGames.slice(-RECENT_GAMES);
  if (games.length === 0) return values;

  const counts = new Map<string, Record<string, number>>();
  for (const game of games) {
    for (const leader of sideFor(game, side.teamId).leaders) {
      if (!config.weights[leader.category]) continue;
      const tally = counts.get(leader.athleteId) ?? {};
      tally[leader.category] = (tally[leader.category] ?? 0) + 1;
      counts.set(leader.athleteId, tally);
    }
  }
  for (const [athleteId, tally] of counts) {
    let value = 0;
    const parts: string[] = [];
    for (const [category, count] of Object.entries(tally)) {
      value += (config.weights[category].elo * count) / games.length;
      parts.push(`${config.weights[category].label} ${count}/${games.length}`);
    }
    values.set(athleteId, { value: Math.min(config.cap, value), reason: `Led team in ${parts.join(', ')} recent games` });
  }
  return values;
}

export function injuryImpacts(league: LeagueId, side: GameSide, report: InjuryEntry[], recentGames: Game[], seasonLeaders: SeasonLeader[] = []) {
  const values = playerValues(league, side, recentGames, seasonLeaders);
  const impacts = report.map((entry): InjuryImpact => {
    const known = values.get(entry.athleteId);
    const chance = missChance(entry.status);
    const value = known?.value ?? 0;
    return {
      ...entry,
      missChance: chance,
      value,
      elo: -value * chance,
      reason: known?.reason ?? 'Not a recent statistical leader'
    };
  });
  impacts.sort((a, b) => a.elo - b.elo || b.missChance - a.missChance);

  const raw = impacts.reduce((sum, i) => sum + i.elo, 0);
  return { impacts, total: Math.max(-TEAM_INJURY_CAP, raw) };
}
