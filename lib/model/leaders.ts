import { getBoxScores, getNflSkillBoxes } from '../boxscores';
import type { LeagueConfig, LeagueId } from '../leagues';
import type { PropMarket } from '../props';
import type { LeagueModel } from './index';
import { playerDirectory } from './playerIndex';
import { propEngine, PropInputs } from './propEngines';

export type RankBy = 'average' | 'total';

/**
 * The stats a fan looks up, per league (no combos, and nobody wants a turnover
 * leader), ranked the way each league's fans read them: basketball per game,
 * football and hockey by the season total. Checked against ESPN's leaders.
 */
const BOARDS: Partial<Record<LeagueId, { markets: PropMarket[]; by: RankBy }>> = {
  nba: { markets: ['pts', 'reb', 'ast', 'stl', 'blk'], by: 'average' },
  nfl: { markets: ['pass_yds', 'pass_td', 'rush_yds', 'rec_yds', 'rec'], by: 'total' },
  nhl: { markets: ['pts', 'goals', 'ast', 'sog', 'saves'], by: 'total' }
};
export const LEADERS_SHOWN = 5;
/** Share of his own team's games a player needs for a per-game board, so a few big nights can't top it. Totals need no such rule. */
const MIN_SHARE = 0.7;
/** Team games this season before it replaces last season. */
const MIN_SEASON_GAMES = 3;

export type Leader = { id: string; name: string; team: string; value: number; games: number };
export type LeaderBoard = { market: PropMarket; leaders: Leader[] };
export type SeasonLeaders = { seasonYear: number; by: RankBy; boards: LeaderBoard[] };

/**
 * The top players in each stat, per game or in total, from each game's player
 * lines. A game counts for a stat when the player has a number in it; ties go
 * to whoever has played more, then by name. Players nobody can name are left out.
 */
export function leaderBoards(
  lines: Iterable<Map<string, Partial<Record<PropMarket, number>>>>,
  markets: PropMarket[],
  { by, minGames }: { by: RankBy; minGames: (id: string) => number },
  who: (id: string) => { name: string; team: string } | undefined,
  shown = LEADERS_SHOWN
): LeaderBoard[] {
  const totals = new Map(markets.map((m) => [m, new Map<string, { total: number; games: number }>()]));
  for (const game of lines) {
    for (const [id, stats] of game) {
      for (const m of markets) {
        const value = stats[m];
        if (value === undefined) continue;
        const board = totals.get(m)!;
        const seen = board.get(id) ?? board.set(id, { total: 0, games: 0 }).get(id)!;
        seen.total += value;
        seen.games += 1;
      }
    }
  }
  return markets.map((market) => ({
    market,
    leaders: [...totals.get(market)!]
      .flatMap(([id, { total, games }]) => {
        const person = who(id);
        return person && games >= minGames(id) && total > 0 ? [{ id, name: person.name, team: person.team, value: by === 'total' ? total : total / games, games }] : [];
      })
      .sort((a, b) => b.value - a.value || b.games - a.games || a.name.localeCompare(b.name))
      .slice(0, shown)
  }));
}

const cache = new WeakMap<LeagueModel, Promise<SeasonLeaders | null>>();

/** The regular season's leaders, this season once teams have played a few, else last season. Reads only stored box scores. */
export function seasonLeaders(league: LeagueConfig, model: LeagueModel): Promise<SeasonLeaders | null> {
  const board = BOARDS[league.id];
  const engine = propEngine(league);
  if (!board || !engine) return Promise.resolve(null);
  let found = cache.get(model);
  if (!found) {
    found = (async () => {
      const regular = Object.values(model.predictions)
        .map((p) => p.game)
        .filter((g) => g.completed && g.seasonType === 2);
      const mostTeamGames = (year: number) => {
        const counts = new Map<string, number>();
        for (const g of regular) {
          if (g.seasonYear !== year) continue;
          for (const id of [g.home.teamId, g.away.teamId]) counts.set(id, (counts.get(id) ?? 0) + 1);
        }
        return Math.max(0, ...counts.values());
      };
      const seasonYear = mostTeamGames(model.season.year) >= MIN_SEASON_GAMES ? model.season.year : model.season.year - 1;
      const most = mostTeamGames(seasonYear);
      if (!most) return null;
      const games = regular.filter((g) => g.seasonYear === seasonYear);
      const [box, skill, directory] = await Promise.all([getBoxScores(league, games, 0), getNflSkillBoxes(league, games, 0), playerDirectory(league, model)]);
      const inputs: PropInputs = { games, box, skill, context: { teamPoints: new Map(), leaguePoints: new Map() }, live: { rosters: {}, injuries: {}, starters: new Map() } };
      const people = new Map(directory.map((p) => [p.id, p]));
      const teamGames = new Map<string, number>();
      for (const g of games) for (const side of [g.home, g.away]) teamGames.set(side.abbr, (teamGames.get(side.abbr) ?? 0) + 1);
      const minGames = (id: string) => (board.by === 'average' ? Math.ceil((teamGames.get(people.get(id)?.team ?? '') ?? most) * MIN_SHARE) : 1);
      const lines = games.flatMap((g) => {
        const actuals = engine.actuals(g.id, inputs);
        return actuals ? [actuals] : [];
      });
      return { seasonYear, by: board.by, boards: leaderBoards(lines, board.markets, { by: board.by, minGames }, (id) => people.get(id)) };
    })().catch(() => {
      cache.delete(model);
      return null;
    });
    cache.set(model, found);
  }
  return found;
}
