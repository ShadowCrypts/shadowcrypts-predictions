import { BoxScore, getBoxScores, getNflSkillBoxes, NflSkillBox } from '../boxscores';
import type { Game } from '../espn';
import type { LeagueConfig, LeagueId } from '../leagues';
import { marketLabel, PropMarket } from '../props';
import { displayColor } from '../teamColor';
import { appearances } from './playerIndex';
import { propEngine, PropInputs } from './propEngines';
import type { Actuals } from './propModel';

/** The headline stats a day's standouts are picked in, per league. */
const HEADLINE: Partial<Record<LeagueId, PropMarket[]>> = {
  nba: ['pts', 'reb', 'ast'],
  nhl: ['pts', 'sog', 'saves'],
  nfl: ['pass_yds', 'rush_yds', 'rec_yds']
};

export type Standout = {
  league: LeagueId;
  market: PropMarket;
  label: string;
  value: number;
  playerId: string;
  name: string;
  team: string;
  /** His team's color, for drawing. */
  color: string;
  gameId: string;
  game: string;
};

/**
 * The day's best line in each headline stat, from the stored box scores of
 * games that finished: one player per stat, nobody twice (his second-best
 * stat goes to the next in line).
 */
export function pickStandouts(league: LeagueId, games: Game[], stats: Map<string, Actuals | null>, who: Map<string, Map<string, { name: string; teamId: string }>>): Standout[] {
  const out: Standout[] = [];
  const taken = new Set<string>();
  for (const market of HEADLINE[league] ?? []) {
    let best: Standout | null = null;
    for (const g of games) {
      const players = who.get(g.id);
      for (const [playerId, s] of stats.get(g.id) ?? []) {
        const value = s[market];
        const p = players?.get(playerId);
        if (value === undefined || !(value > 0) || !p || taken.has(playerId)) continue;
        if (!best || value > best.value) {
          const team = g.home.teamId === p.teamId ? g.home : g.away;
          best = {
            league,
            market,
            label: marketLabel(market).long,
            value,
            playerId,
            name: p.name,
            team: team.abbr,
            color: displayColor(team.color, team.altColor),
            gameId: g.id,
            game: `${g.away.abbr} @ ${g.home.abbr}`
          };
        }
      }
    }
    if (best) {
      taken.add(best.playerId);
      out.push(best);
    }
  }
  return out;
}

/** Standouts among a league's finished games (the stored box scores only; nothing is fetched for a page view). */
export async function standouts(league: LeagueConfig, games: Game[]): Promise<Standout[]> {
  const engine = propEngine(league);
  const finished = games.filter((g) => g.completed);
  if (!engine || !finished.length) return [];
  const [box, skill] = await Promise.all([
    getBoxScores(league, finished, 0).catch(() => ({}) as Record<string, BoxScore | null>),
    getNflSkillBoxes(league, finished, 0).catch(() => ({}) as Record<string, NflSkillBox | null>)
  ]);
  const inputs: PropInputs = { games: finished, box, skill, context: { teamPoints: new Map(), leaguePoints: new Map() }, live: { rosters: {}, injuries: {}, starters: new Map() } };
  const stats = new Map(finished.map((g) => [g.id, engine.actuals(g.id, inputs)]));
  const who = new Map(finished.map((g) => [g.id, appearances(box[g.id], skill[g.id])]));
  return pickStandouts(league.id, finished, stats, who);
}
