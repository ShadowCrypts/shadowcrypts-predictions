import type { BoxScore, NbaLine, RosterEntry } from '../boxscores';
import type { Game, InjuryEntry } from '../espn';
import type { PropMarket } from '../props';
import { LineupModel, LineupParams, seasonStartDates } from './lineups';
import type { Actuals, GameProjection, PlayerProjection, PropModelParams } from './propModel';

/** Box-score stats the NBA projection covers; combined markets add them up. */
export type StatKey = 'pts' | 'reb' | 'ast' | 'stl' | 'blk' | 'tov';
export const STATS: StatKey[] = ['pts', 'reb', 'ast', 'stl', 'blk', 'tov'];

export const NBA_MARKETS: Partial<Record<PropMarket, StatKey[]>> = {
  pts: ['pts'],
  reb: ['reb'],
  ast: ['ast'],
  pra: ['pts', 'reb', 'ast'],
  pr: ['pts', 'reb'],
  pa: ['pts', 'ast'],
  ar: ['ast', 'reb'],
  stl: ['stl'],
  blk: ['blk'],
  tov: ['tov']
};

export type NbaPlayerParams = PropModelParams & {
  /** Per-game decay of a player's older games, so recent form counts more. */
  decay: number;
  /** Minutes of league-average production every player starts with (shrinkage). */
  priorMinutes: number;
  /** How far points and assists follow the team's implied total (0 none, 1 fully). */
  teamShare: number;
  /** How far rebounds, steals, blocks and turnovers follow the game's pace (its implied total). */
  paceShare: number;
};

export const stat = (l: NbaLine, key: StatKey) => (key === 'reb' ? l.oreb + l.dreb : l[key]);

type Rates = { name: string; min: number; sums: Record<StatKey, number> };

const zero = (): Record<StatKey, number> => ({ pts: 0, reb: 0, ast: 0, stl: 0, blk: 0, tov: 0 });
const MAX_MINUTES = 42;
/** Players projected under this many minutes are left off the table unless a book lists them. */
const FEATURED_MINUTES = 10;

/** Points scored per team per game expected for each game, plus the league's average then. */
export type TeamContext = { teamPoints: Map<string, { home: number; away: number }>; leaguePoints: Map<string, number> };

function withMarkets(stats: Record<StatKey, number>): Partial<Record<PropMarket, number>> {
  return Object.fromEntries(Object.entries(NBA_MARKETS).map(([m, keys]) => [m, keys!.reduce((s, k) => s + stats[k], 0)]));
}

/**
 * NBA player projections, walked through the games in date order like the
 * rating replays: every projection uses only earlier games. Minutes come from
 * the lineup model (an absent player's minutes go to the rest of the
 * rotation); production per minute is each player's decayed history pulled
 * toward the league average; points and assists then lean toward the team's
 * implied scoring, which carries pace, the opponent's defense and who's out.
 */
export function nbaPlayerPass(
  games: Game[],
  box: Record<string, BoxScore | null>,
  params: NbaPlayerParams,
  lineupParams: LineupParams,
  context: TeamContext,
  live: { rosters: Record<string, RosterEntry[]>; injuries: Record<string, InjuryEntry[]> },
  keep: (game: Game) => boolean = () => true
) {
  const lineups = new LineupModel(lineupParams);
  const players = new Map<string, Rates>();
  const league = { min: 4800, sums: { pts: 2200, reb: 900, ast: 500, stl: 150, blk: 100, tov: 280 } as Record<StatKey, number> };
  const projections = new Map<string, GameProjection>();
  const starts = seasonStartDates(games);

  const rate = (id: string, key: StatKey) => {
    const p = players.get(id);
    const leagueRate = league.sums[key] / league.min;
    return p ? (p.sums[key] + params.priorMinutes * leagueRate) / (p.min + params.priorMinutes) : leagueRate;
  };

  const project = (game: Game, side: 'home' | 'away', view: ReturnType<LineupModel['view']>): PlayerProjection[] => {
    const teamId = game[side].teamId;
    const rows = view.players.map((p) => {
      // Props are void if a player sits, so a questionable player is projected as if he plays.
      const minutes = p.available > 0 ? Math.min(MAX_MINUTES, p.minutes / p.available) : 0;
      return { id: p.id, name: players.get(p.id)?.name ?? p.name, minutes, available: p.available, stats: Object.fromEntries(STATS.map((k) => [k, rate(p.id, k) * minutes])) as Record<StatKey, number> };
    });
    const expected = context.teamPoints.get(game.id);
    const average = context.leaguePoints.get(game.id);
    const raw = rows.reduce((s, r) => s + r.stats.pts * r.available, 0);
    const teamPoints = expected?.[side];
    const scoring = teamPoints && raw > 0 ? Math.pow(teamPoints / raw, params.teamShare) : 1;
    const pace = expected && average ? Math.pow((expected.home + expected.away) / (2 * average), params.paceShare) : 1;
    return rows
      .filter((r) => r.minutes >= 1)
      .map((r) => {
        r.stats.pts *= scoring;
        r.stats.ast *= scoring;
        r.stats.reb *= pace;
        r.stats.stl *= pace;
        r.stats.blk *= pace;
        r.stats.tov *= pace;
        return {
          id: r.id,
          name: r.name,
          teamId,
          detail: `${Math.round(r.minutes)} min`,
          featured: r.minutes >= FEATURED_MINUTES,
          available: r.available,
          mean: withMarkets(r.stats)
        };
      });
  };

  for (const game of games) {
    const b = box[game.id];
    const homeId = game.home.teamId;
    const awayId = game.away.teamId;
    if (game.completed && b?.league === 'nba') {
      if (keep(game)) {
        const home = lineups.viewFromBox(homeId, b.teams[homeId] ?? []);
        const away = lineups.viewFromBox(awayId, b.teams[awayId] ?? []);
        projections.set(game.id, { home: project(game, 'home', home), away: project(game, 'away', away), source: 'box score' });
      }
      lineups.record(game, b);
      for (const lines of Object.values(b.teams)) {
        for (const l of lines) {
          if (l.min <= 0) continue;
          const p = players.get(l.id) ?? { name: l.name, min: 0, sums: zero() };
          p.name = l.name;
          p.min = p.min * params.decay + l.min;
          for (const k of STATS) p.sums[k] = p.sums[k] * params.decay + stat(l, k);
          players.set(l.id, p);
          league.min = league.min * 0.9995 + l.min;
          for (const k of STATS) league.sums[k] = league.sums[k] * 0.9995 + stat(l, k);
        }
      }
    } else if (!game.completed && keep(game)) {
      const start = starts.get(game.seasonYear) ?? null;
      const home = lineups.project(homeId, game.date, live.rosters[homeId], live.injuries[homeId] ?? [], start);
      const away = lineups.project(awayId, game.date, live.rosters[awayId], live.injuries[awayId] ?? [], start);
      projections.set(game.id, { home: project(game, 'home', home), away: project(game, 'away', away), source: 'injury report' });
    }
  }
  return projections;
}

/** What each player who played did, per market. */
export function nbaActuals(box: BoxScore | null | undefined): Actuals | null {
  if (box?.league !== 'nba') return null;
  const out: Actuals = new Map();
  for (const l of Object.values(box.teams).flat()) {
    if (l.min <= 0) continue;
    const stats = Object.fromEntries(STATS.map((k) => [k, stat(l, k)])) as Record<StatKey, number>;
    out.set(l.id, withMarkets(stats));
  }
  return out;
}
