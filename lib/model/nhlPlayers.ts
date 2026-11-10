import type { BoxScore, NhlGoalieLine, NhlSkaterLine, RosterEntry } from '../boxscores';
import type { Game, InjuryEntry } from '../espn';
import type { PropMarket } from '../props';
import { missChance } from './adjustments';
import type { TeamContext } from './nbaPlayers';
import type { Actuals, GameProjection, PlayerProjection, PropModelParams } from './propModel';

export const NHL_MARKETS: PropMarket[] = ['pts', 'goals', 'ast', 'sog', 'blk', 'saves'];

export type NhlPlayerParams = PropModelParams & {
  /** Per-game decay of a player's older games, so recent form counts more. */
  decay: number;
  /** Minutes of league-average production every skater starts with (shrinkage). */
  priorToi: number;
  /** How fast a skater's usual ice time follows recent games. */
  toiAlpha: number;
  /** How far goals and assists follow the team's implied goals (0 none, 1 fully). */
  teamShare: number;
  /** How far shots follow the team's expected shots (its own shooting against the opponent's shots allowed). */
  shotShare: number;
  /** Shots of league-average saving every goalie starts with (shrinkage). */
  priorShots: number;
};

type Skater = { name: string; team: string; toi: number; seen: number; sums: { toi: number; g: number; a: number; sog: number; bs: number }; lastDate: string };
type Goalie = { name: string; team: string; sa: number; saves: number; starts: number; lastDate: string };

/** Ice time a newcomer is assumed to play, about a third-pair or fourth-line role. */
const NEW_SKATER_TOI = 13;
const FEATURED_TOI = 10;
const ROSTER_DAYS = 30;
/** How fast team shot rates follow recent games. */
const TEAM_ALPHA = 0.08;

/**
 * NHL player projections, walked through the games in date order: every
 * projection uses only earlier games. A skater's goals, assists and shots per
 * minute come from his decayed history pulled toward the league average, times
 * his usual ice time; goals and assists then lean toward the team's implied
 * goals, and shots toward the team's expected shots. A goalie's saves are the
 * opponent's expected shots times his save percentage, pulled toward average.
 */
export function nhlPlayerPass(
  games: Game[],
  box: Record<string, BoxScore | null>,
  params: NhlPlayerParams,
  context: TeamContext,
  live: { rosters: Record<string, RosterEntry[]>; injuries: Record<string, InjuryEntry[]> },
  keep: (game: Game) => boolean = () => true
) {
  const skaters = new Map<string, Skater>();
  const goalies = new Map<string, Goalie>();
  const league = { toi: 6000, g: 50, a: 85, sog: 1100, bs: 500, sa: 3000, saves: 2700 };
  const teams = new Map<string, { shotsFor: number; shotsAgainst: number }>();
  let leagueShots = 29;
  const projections = new Map<string, GameProjection>();

  const rate = (s: Skater | undefined, key: 'g' | 'a' | 'sog' | 'bs') => {
    const leagueRate = league[key] / league.toi;
    return s ? (s.sums[key] + params.priorToi * leagueRate) / (s.sums.toi + params.priorToi) : leagueRate;
  };
  const savePct = (id: string) => {
    const g = goalies.get(id);
    const leagueSv = league.saves / league.sa;
    return g ? (g.saves + params.priorShots * leagueSv) / (g.sa + params.priorShots) : leagueSv;
  };
  /** Shots a team should get: its own shooting and the opponent's shots allowed, each against the league rate. */
  const expectedShots = (teamId: string, oppId: string) => {
    const t = teams.get(teamId);
    const o = teams.get(oppId);
    return leagueShots * ((t?.shotsFor ?? leagueShots) / leagueShots) * ((o?.shotsAgainst ?? leagueShots) / leagueShots);
  };

  const project = (
    game: Game,
    side: 'home' | 'away',
    lineup: { id: string; name: string; available: number }[],
    goalie: { id: string; name: string } | null
  ): PlayerProjection[] => {
    const teamId = game[side].teamId;
    const oppId = side === 'home' ? game.away.teamId : game.home.teamId;
    const rows = lineup.map((r) => {
      const s = skaters.get(r.id);
      const toi = s?.toi ?? NEW_SKATER_TOI;
      return { ...r, name: s?.name ?? r.name, toi, g: rate(s, 'g') * toi, a: rate(s, 'a') * toi, sog: rate(s, 'sog') * toi, bs: rate(s, 'bs') * toi };
    });
    const expected = context.teamPoints.get(game.id)?.[side];
    const rawGoals = rows.reduce((sum, r) => sum + r.g * r.available, 0);
    const scoring = expected && rawGoals > 0 ? Math.pow(expected / rawGoals, params.teamShare) : 1;
    const rawShots = rows.reduce((sum, r) => sum + r.sog * r.available, 0);
    const shooting = rawShots > 0 ? Math.pow(expectedShots(teamId, oppId) / rawShots, params.shotShare) : 1;
    const out: PlayerProjection[] = rows.map((r) => {
      const goals = r.g * scoring;
      const assists = r.a * scoring;
      return {
        id: r.id,
        name: r.name,
        teamId,
        detail: `${Math.round(r.toi)} min`,
        featured: r.toi >= FEATURED_TOI,
        available: r.available,
        mean: { goals, ast: assists, pts: goals + assists, sog: r.sog * shooting, blk: r.bs }
      };
    });
    if (goalie) {
      const shotsAgainst = expectedShots(oppId, teamId);
      out.push({
        id: goalie.id,
        name: goalies.get(goalie.id)?.name ?? goalie.name,
        teamId,
        detail: 'Starting goalie',
        featured: true,
        available: 1,
        mean: { saves: shotsAgainst * savePct(goalie.id) }
      });
    }
    return out;
  };

  /** The current roster, when there is one: past games have none to read, so they go by the team he last played for. */
  const onRosterOf = (teamId: string) => {
    const roster = live.rosters[teamId];
    return roster?.length ? new Set(roster.map((r) => r.id)) : null;
  };

  /**
   * Skaters who've played lately and are on this team now, with each one's chance
   * of playing: a player traded here counts, and one traded away or sent down doesn't.
   */
  const lineupFor = (teamId: string, asOf: string) => {
    const cutoff = new Date(Date.parse(asOf) - ROSTER_DAYS * 86_400_000).toISOString();
    const onRoster = onRosterOf(teamId);
    const report = new Map((live.injuries[teamId] ?? []).map((i) => [i.athleteId, i]));
    return [...skaters]
      .filter(([id, s]) => (onRoster ? onRoster.has(id) : s.team === teamId) && s.lastDate >= cutoff)
      .map(([id, s]) => {
        const injury = report.get(id);
        return { id, name: s.name, available: injury ? 1 - missChance(injury.status) : 1 };
      })
      .filter((r) => r.available > 0);
  };

  /** The announced starter, or else the goalie who's started most lately. */
  const goalieFor = (game: Game, side: 'home' | 'away') => {
    const probable = game[side].probable;
    if (probable?.role === 'goalie') return { id: probable.athleteId, name: probable.name };
    const cutoff = new Date(Date.parse(game.date) - ROSTER_DAYS * 86_400_000).toISOString();
    const onRoster = onRosterOf(game[side].teamId);
    const best = [...goalies].filter(([id, g]) => (onRoster ? onRoster.has(id) : g.team === game[side].teamId) && g.lastDate >= cutoff).sort((a, b) => b[1].starts - a[1].starts)[0];
    return best ? { id: best[0], name: best[1].name } : null;
  };

  const record = (game: Game, teamId: string, oppId: string, lines: { goalies: NhlGoalieLine[]; skaters: NhlSkaterLine[] }) => {
    const starter = [...lines.goalies].sort((a, b) => b.toi - a.toi)[0];
    for (const g of lines.goalies) {
      const state = goalies.get(g.id) ?? { name: g.name, team: teamId, sa: 0, saves: 0, starts: 0, lastDate: game.date };
      state.name = g.name;
      state.team = teamId;
      state.lastDate = game.date;
      state.sa = state.sa * params.decay + g.sa;
      state.saves = state.saves * params.decay + (g.sa - g.ga);
      state.starts = state.starts * 0.9 + (g === starter ? 1 : 0);
      goalies.set(g.id, state);
      league.sa = league.sa * 0.9995 + g.sa;
      league.saves = league.saves * 0.9995 + (g.sa - g.ga);
    }
    let shots = 0;
    for (const l of lines.skaters) {
      shots += l.sog;
      if (l.toi <= 0) continue;
      const s = skaters.get(l.id) ?? { name: l.name, team: teamId, toi: l.toi, seen: 0, sums: { toi: 0, g: 0, a: 0, sog: 0, bs: 0 }, lastDate: game.date };
      s.name = l.name;
      s.team = teamId;
      s.lastDate = game.date;
      s.toi = s.seen ? s.toi + params.toiAlpha * (l.toi - s.toi) : l.toi;
      s.seen += 1;
      s.sums.toi = s.sums.toi * params.decay + l.toi;
      s.sums.g = s.sums.g * params.decay + l.g;
      s.sums.a = s.sums.a * params.decay + l.a;
      s.sums.sog = s.sums.sog * params.decay + l.sog;
      s.sums.bs = s.sums.bs * params.decay + l.bs;
      skaters.set(l.id, s);
      league.toi = league.toi * 0.9995 + l.toi;
      league.g = league.g * 0.9995 + l.g;
      league.a = league.a * 0.9995 + l.a;
      league.sog = league.sog * 0.9995 + l.sog;
      league.bs = league.bs * 0.9995 + l.bs;
    }
    // A box score without shots (a feed gap) shouldn't drag the team and league shot rates to zero.
    if (shots <= 0) return;
    const t = teams.get(teamId) ?? { shotsFor: leagueShots, shotsAgainst: leagueShots };
    const o = teams.get(oppId) ?? { shotsFor: leagueShots, shotsAgainst: leagueShots };
    t.shotsFor += TEAM_ALPHA * (shots - t.shotsFor);
    o.shotsAgainst += TEAM_ALPHA * (shots - o.shotsAgainst);
    teams.set(teamId, t);
    teams.set(oppId, o);
    leagueShots += 0.01 * (shots - leagueShots);
  };

  for (const game of games) {
    const b = box[game.id];
    const homeId = game.home.teamId;
    const awayId = game.away.teamId;
    if (game.completed && b?.league === 'nhl') {
      const home = b.teams[homeId];
      const away = b.teams[awayId];
      if (!home || !away) continue;
      if (keep(game)) {
        const fromBox = (lines: typeof home, side: 'home' | 'away') => {
          const starter = [...lines.goalies].sort((x, y) => y.toi - x.toi)[0];
          return project(
            game,
            side,
            lines.skaters.filter((l) => l.toi > 0).map((l) => ({ id: l.id, name: l.name, available: 1 })),
            starter ? { id: starter.id, name: starter.name } : null
          );
        };
        projections.set(game.id, { home: fromBox(home, 'home'), away: fromBox(away, 'away'), source: 'box score' });
      }
      record(game, homeId, awayId, home);
      record(game, awayId, homeId, away);
    } else if (!game.completed && keep(game)) {
      projections.set(game.id, {
        home: project(game, 'home', lineupFor(homeId, game.date), goalieFor(game, 'home')),
        away: project(game, 'away', lineupFor(awayId, game.date), goalieFor(game, 'away')),
        source: 'injury report'
      });
    }
  }
  return projections;
}

/** What each player did, per market: skaters' points, goals, assists and shots, the starting goalie's saves. */
export function nhlActuals(box: BoxScore | null | undefined): Actuals | null {
  if (box?.league !== 'nhl') return null;
  const out: Actuals = new Map();
  for (const team of Object.values(box.teams)) {
    for (const l of team.skaters) if (l.toi > 0) out.set(l.id, { goals: l.g, ast: l.a, pts: l.g + l.a, sog: l.sog, blk: l.bs });
    const starter = [...team.goalies].sort((a, b) => b.toi - a.toi)[0];
    if (starter) out.set(starter.id, { saves: starter.sa - starter.ga });
  }
  return out;
}
