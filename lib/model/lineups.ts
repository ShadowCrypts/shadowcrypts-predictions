import type { BoxScore, NbaLine, RosterEntry } from '../boxscores';
import type { Game, InjuryEntry } from '../espn';
import { missChance } from './adjustments';

export type LineupParams = {
  /** Per-game decay of a player's older games, so recent form counts more. */
  decay: number;
  /** Minutes of league-average play every player starts with (shrinkage). */
  priorMinutes: number;
  /** Weight of plus-minus next to Game Score in a player's rating. */
  pmWeight: number;
  /** How fast a player's usual minute share follows recent games. */
  shareAlpha: number;
  /** How fast a team's baseline lineup strength follows recent games. */
  baselineAlpha: number;
  /** Elo points per point of lineup strength (Game Score per 48 minutes). */
  eloPerPoint: number;
};

export type LineupPlayer = {
  id: string;
  name: string;
  /** Rating in Game Score per 48 minutes, plus-minus included. */
  rating: number;
  /** Usual share of the team's minutes when healthy (0.2 = 48 of 240). */
  share: number;
  /** Expected minutes tonight, after absent players' minutes are handed out. */
  minutes: number;
  /** Chance of playing: 1 available, 0 out. */
  available: number;
  reason: string | null;
};

export type LineupView = {
  /** Elo adjustment against the team's recent typical lineup (negative = weaker today). */
  elo: number;
  strength: number;
  baseline: number;
  players: LineupPlayer[];
};

type PlayerState = { name: string; team: string; gs: number; pm: number; min: number; share: number; lastDate: string };

const MAX_SHARE = 42 / 240;
const NEW_PLAYER_SHARE = 0.03;
const ROSTER_DAYS = 45;
/** Team games into a season after which a roster player who hasn't dressed in any of them is read as not dressing. */
const SEASON_GAMES_TO_TRUST = 3;

/**
 * How a game's 240 minutes are handed out from each player's usual share
 * (times his chance of playing). Usual shares are learned on nights teammates
 * sit too, so a full roster's add up to more than the game has, and a
 * short-handed one's to less. Scaling everyone alike gave stars about 4.5
 * minutes too many on short-handed nights and 2 to 3.5 too few on full ones,
 * so: a full roster's excess comes partly off the bottom of the rotation
 * (`FULL_FILL` of the way to filling from the top), and a short-handed one's
 * missing minutes go out leaning toward the bench (share to the power
 * `SHORT_POWER`). Both were fitted on 2024-25 box scores by average minutes
 * missed and were better on both later seasons. In the backtests they also
 * improved pre-line game forecasts (log loss 0.5868 → 0.5861) and the prop
 * model (holdout log loss 0.7262 → 0.7224, points missed by 4.44 not 4.49).
 */
const FULL_FILL = 0.25;
const SHORT_POWER = -0.25;

export function allocateMinutes(weights: number[]): number[] {
  const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);
  const total = sum(weights);
  if (total <= 0) return weights.map(() => 0);
  let w = weights;
  if (total < 1) {
    const lean = weights.map((x) => (x > 0 ? Math.pow(x, SHORT_POWER) : 0));
    const leanSum = sum(lean);
    w = weights.map((x, i) => x + ((1 - total) * lean[i]) / leanSum);
  }
  const wTotal = sum(w);
  const capped = w.map((x) => Math.min(MAX_SHARE, x / wTotal));
  const cappedSum = sum(capped);
  const scaled = capped.map((x) => (x / cappedSum) * 240);
  if (total <= 1) return scaled;
  // Filled from the top: the biggest roles keep their usual minutes until the game's are used up.
  const fill = weights.map(() => 0);
  let left = 1;
  for (const i of weights.map((_, i) => i).sort((a, b) => weights[b] - weights[a])) {
    const take = Math.min(Math.min(MAX_SHARE, weights[i]), left);
    fill[i] = take * 240;
    left -= take;
  }
  return scaled.map((m, i) => (1 - FULL_FILL) * m + FULL_FILL * fill[i]);
}

/** Hollinger's Game Score: one number for a box-score line. */
export function gameScore(l: NbaLine) {
  return l.pts + 0.4 * l.fgm - 0.7 * l.fga - 0.4 * (l.fta - l.ftm) + 0.7 * l.oreb + 0.3 * l.dreb + l.stl + 0.7 * l.ast + 0.7 * l.blk - 0.4 * l.pf - l.tov;
}

/** DNP reasons that mean the player was unavailable rather than benched. */
export function ruledOut(line: Pick<NbaLine, 'dnp' | 'reason'>) {
  return line.dnp && !/coach/i.test(line.reason ?? '');
}

/**
 * Rates every NBA player from box scores and compares each game's available
 * lineup with the one the team has been playing lately. The team ratings
 * already reflect recent lineups, so only the difference moves the forecast:
 * a star sitting tonight lowers it, a star coming back raises it.
 */
export class LineupModel {
  private players = new Map<string, PlayerState>();
  private baselines = new Map<string, number>();
  // Dates of each team's games with a box score, for counting how far into a season it is.
  private teamDates = new Map<string, string[]>();
  // League-average Game Score per 48, from slowly decaying totals over every minute played.
  private leagueGs = 15;
  private leagueMin = 48;

  private get leagueRate() {
    return (48 * this.leagueGs) / this.leagueMin;
  }

  constructor(private params: LineupParams) {}

  rating(id: string) {
    const p = this.players.get(id);
    const { priorMinutes, pmWeight } = this.params;
    if (!p) return this.leagueRate;
    return (48 * (p.gs + pmWeight * p.pm) + priorMinutes * this.leagueRate) / (p.min + priorMinutes);
  }

  /** Lineup strength when each listed player plays with the given probability. */
  view(teamId: string, roster: { id: string; name: string; available: number; reason: string | null }[]): LineupView {
    const players: LineupPlayer[] = roster.map((r) => ({
      id: r.id,
      name: this.players.get(r.id)?.name ?? r.name,
      rating: this.rating(r.id),
      share: this.players.get(r.id)?.share ?? NEW_PLAYER_SHARE,
      minutes: 0,
      available: r.available,
      reason: r.reason
    }));
    // Minutes of absent players go to the available ones (see allocateMinutes).
    const weights = players.map((p) => p.share * p.available);
    let strength = this.leagueRate;
    if (weights.some((w) => w > 0)) {
      const minutes = allocateMinutes(weights);
      strength = players.reduce((s, p, i) => s + (minutes[i] / 240) * p.rating, 0);
      players.forEach((p, i) => (p.minutes = minutes[i]));
    }
    const baseline = this.baselines.get(teamId) ?? strength;
    return { elo: this.params.eloPerPoint * (strength - baseline), strength, baseline, players };
  }

  /** The view for a finished game, with availability read from its box score. */
  viewFromBox(teamId: string, lines: NbaLine[]) {
    return this.view(
      teamId,
      lines.map((l) => ({ id: l.id, name: l.name, available: ruledOut(l) ? 0 : 1, reason: l.dnp ? l.reason : null }))
    );
  }

  /**
   * Every player with real recent minutes, best first: rating, usual minutes
   * and current team. `since` drops players who haven't played lately.
   */
  leaderboard(since: string, minMinutes = 400) {
    return [...this.players]
      .filter(([, p]) => p.lastDate >= since && p.min >= minMinutes)
      .map(([id, p]) => ({ id, name: p.name, teamId: p.team, rating: this.rating(id), vsAverage: this.rating(id) - this.leagueRate, minutes: p.share * 240, lastDate: p.lastDate }))
      .sort((a, b) => b.rating - a.rating);
  }

  /** Players who appeared for a team recently, for projecting a lineup before its box score exists. */
  roster(teamId: string, asOf: string): RosterEntry[] {
    const cutoff = new Date(Date.parse(asOf) - ROSTER_DAYS * 86_400_000).toISOString();
    return [...this.players]
      .filter(([, p]) => p.team === teamId && p.lastDate >= cutoff)
      .map(([id, p]) => ({ id, name: p.name }));
  }

  /**
   * Projects an upcoming game: the current roster (or, without one, whoever
   * played for the team recently), with each player's chance of playing read
   * from the injury report. Box scores list only the players who dress, which
   * is what the ratings and minute shares learn from; a full roster also
   * carries two-way and G League players whose shares are a season stale.
   * So once the team is a few games into the season (`seasonStart`), a player
   * who hasn't dressed in any of them and isn't on the injury report is left
   * out, as he'd be left out of the box score. One back from an injury he
   * picked up this season has dressed before, or is on the report.
   */
  project(teamId: string, asOf: string, roster: RosterEntry[] | undefined, injuries: InjuryEntry[], seasonStart: string | null = null) {
    const report = new Map(injuries.map((i) => [i.athleteId, i]));
    const intoSeason = seasonStart !== null && (this.teamDates.get(teamId) ?? []).filter((d) => d >= seasonStart && d < asOf).length >= SEASON_GAMES_TO_TRUST;
    const listed = (roster?.length ? roster : this.roster(teamId, asOf)).filter(
      (r) => !intoSeason || report.has(r.id) || (this.players.get(r.id)?.lastDate ?? '') >= seasonStart!
    );
    return this.view(
      teamId,
      listed.map((r) => {
        const injury = report.get(r.id);
        return { id: r.id, name: r.name, available: injury ? 1 - missChance(injury.status) : 1, reason: injury?.status ?? null };
      })
    );
  }

  /** Elo a player's absence costs: the lineup with him available minus without him. */
  absenceCost(teamId: string, view: LineupView, playerId: string) {
    const roster = view.players.map((p) => ({ id: p.id, name: p.name, available: p.available, reason: p.reason }));
    const withHim = this.view(teamId, roster.map((p) => (p.id === playerId ? { ...p, available: 1 } : p)));
    const without = this.view(teamId, roster.map((p) => (p.id === playerId ? { ...p, available: 0 } : p)));
    return withHim.elo - without.elo;
  }

  /** Updates baselines and player ratings after a game, using ratings from before it. */
  record(game: Game, box: Extract<BoxScore, { league: 'nba' }>) {
    const { decay, shareAlpha, baselineAlpha } = this.params;
    for (const teamId of [game.home.teamId, game.away.teamId]) {
      const lines = box.teams[teamId] ?? [];
      const totalMin = lines.reduce((s, l) => s + l.min, 0);
      if (totalMin <= 0) continue;
      (this.teamDates.get(teamId) ?? this.teamDates.set(teamId, []).get(teamId)!).push(game.date);
      const actual = lines.reduce((s, l) => s + (l.min / totalMin) * this.rating(l.id), 0);
      const base = this.baselines.get(teamId);
      this.baselines.set(teamId, base === undefined ? actual : base + baselineAlpha * (actual - base));

      for (const l of lines) {
        const p = this.players.get(l.id) ?? { name: l.name, team: teamId, gs: 0, pm: 0, min: 0, share: NEW_PLAYER_SHARE, lastDate: game.date };
        p.team = teamId;
        p.name = l.name;
        p.lastDate = game.date;
        if (l.min > 0) {
          p.gs = p.gs * decay + gameScore(l);
          p.pm = p.pm * decay + l.pm;
          p.min = p.min * decay + l.min;
          p.share += shareAlpha * (l.min / totalMin - p.share);
          this.leagueGs = this.leagueGs * 0.9995 + gameScore(l);
          this.leagueMin = this.leagueMin * 0.9995 + l.min;
        } else if (!ruledOut(l)) {
          // Healthy but benched: their usual role shrinks.
          p.share += shareAlpha * (0 - p.share);
        }
        this.players.set(l.id, p);
      }
    }
  }
}

export type Absence = { id: string; name: string; reason: string | null; available: number; cost: number };
export type TeamLineup = Omit<LineupView, 'players'> & {
  /** Players who may miss the game, costliest first. */
  absences: Absence[];
  /** The projected rotation; kept for upcoming games only. */
  players: LineupPlayer[] | null;
};
export type GameLineups = { home: TeamLineup; away: TeamLineup; source: 'box score' | 'injury report' };

function summarizeTeam(model: LineupModel, teamId: string, view: LineupView, keepPlayers: boolean): TeamLineup {
  const absences = view.players
    .filter((p) => p.available < 1)
    .map((p) => ({ id: p.id, name: p.name, reason: p.reason, available: p.available, cost: model.absenceCost(teamId, view, p.id) * (1 - p.available) }))
    .filter((a) => a.cost > 0.5)
    .sort((a, b) => b.cost - a.cost);
  return { elo: view.elo, strength: view.strength, baseline: view.baseline, absences, players: keepPlayers ? view.players : null };
}

/** The first regular-season game date of each season in these games (any game, for a season without one). */
export function seasonStartDates(games: Game[]) {
  const starts = new Map<number, string>();
  const regular = new Map<number, string>();
  for (const g of games) {
    if (!starts.has(g.seasonYear) || g.date < starts.get(g.seasonYear)!) starts.set(g.seasonYear, g.date);
    if (g.seasonType === 2 && (!regular.has(g.seasonYear) || g.date < regular.get(g.seasonYear)!)) regular.set(g.seasonYear, g.date);
  }
  return new Map([...starts].map(([year, date]) => [year, regular.get(year) ?? date]));
}

/**
 * Walks the games in date order. Finished games read availability from their
 * box score and then update the ratings; games still to play are projected
 * from current rosters and the injury report. Returns each game's adjustment
 * (home minus away, Elo) for the rating replays, plus the detail behind it.
 */
export function lineupPass(
  games: Game[],
  box: Record<string, BoxScore | null>,
  params: LineupParams,
  live: { rosters: Record<string, RosterEntry[]>; injuries: Record<string, InjuryEntry[]> }
) {
  const model = new LineupModel(params);
  const extra = new Map<string, number>();
  const lineups = new Map<string, GameLineups>();
  const starts = seasonStartDates(games);
  for (const game of games) {
    const b = box[game.id];
    const homeId = game.home.teamId;
    const awayId = game.away.teamId;
    if (game.completed && b?.league === 'nba') {
      const home = model.viewFromBox(homeId, b.teams[homeId] ?? []);
      const away = model.viewFromBox(awayId, b.teams[awayId] ?? []);
      extra.set(game.id, home.elo - away.elo);
      lineups.set(game.id, { home: summarizeTeam(model, homeId, home, false), away: summarizeTeam(model, awayId, away, false), source: 'box score' });
      model.record(game, b);
    } else if (!game.completed) {
      const start = starts.get(game.seasonYear) ?? null;
      const home = model.project(homeId, game.date, live.rosters[homeId], live.injuries[homeId] ?? [], start);
      const away = model.project(awayId, game.date, live.rosters[awayId], live.injuries[awayId] ?? [], start);
      extra.set(game.id, home.elo - away.elo);
      lineups.set(game.id, { home: summarizeTeam(model, homeId, home, true), away: summarizeTeam(model, awayId, away, true), source: 'injury report' });
    }
  }
  return { extra, lineups, model };
}

/** "Out: A (−41), B (−12)" for the factor table. */
export function describeLineup(team: TeamLineup) {
  const parts = team.absences.slice(0, 3).map((a) => `${a.name} ${a.available > 0 ? `(${Math.round((1 - a.available) * 100)}% to sit) ` : ''}−${Math.round(a.cost)}`);
  const shift = team.elo - team.absences.reduce((s, a) => -a.cost + s, 0);
  if (!parts.length) return Math.abs(team.elo) < 3 ? 'Usual rotation' : team.elo > 0 ? 'Stronger than its recent lineups' : 'Weaker than its recent lineups';
  return `Missing ${parts.join(', ')}${Math.abs(shift) >= 5 ? ` · ${shift > 0 ? 'otherwise stronger' : 'otherwise weaker'} than recent lineups` : ''}`;
}
