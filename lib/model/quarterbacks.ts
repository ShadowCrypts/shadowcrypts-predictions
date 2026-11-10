import type { BoxScore, NflPasserLine, NflTeamBox, RosterEntry } from '../boxscores';
import type { Game, InjuryEntry } from '../espn';
import { InjuryImpact, missChance } from './adjustments';

export type QbParams = {
  /** Weight kept by a quarterback's older plays per game's worth (30 plays) of new ones. */
  decay: number;
  /** Plays at the prior level every quarterback starts with (shrinkage). */
  priorPlays: number;
  /** Where an unproven quarterback starts, in adjusted net yards per play against league average. */
  priorRating: number;
  /** Weight of the quarterback's own runs (yards, touchdowns, carries) next to his dropbacks. */
  rushWeight: number;
  /** How fast a team's share of starts by each quarterback follows its recent starts. */
  baselineAlpha: number;
  /** Elo points per adjusted net yard per play. */
  eloPerYard: number;
};

type QbState = { name: string; team: string; net: number; plays: number; lastStart: string | null };

export type QbOption = {
  id: string;
  name: string;
  /** Adjusted net yards per play above league average, shrunk toward the prior. */
  rating: number;
  /** Plays behind the rating, after decay. */
  plays: number;
  /** Chance he starts. */
  chance: number;
  status: string | null;
  /** Elo his possible absence costs the team (0 when he's healthy or not the likely starter). */
  cost: number;
};

export type TeamQb = {
  /** Elo against the team's usual quarterback play (negative = weaker today). */
  elo: number;
  /** Expected rating of today's starter. */
  rating: number;
  /** The team's usual starter rating: its recent starters' current ratings, weighted by share of starts. */
  baseline: number;
  /** Who may start, likeliest first, plus listed starters ruled out. */
  options: QbOption[];
  /** The quarterback with the most recent starts, when the team has any. */
  usual: { id: string; name: string } | null;
};

export type GameQbs = { home: TeamQb; away: TeamQb; source: 'box score' | 'depth chart' };

const PLAYS_PER_GAME = 30;
const LEAGUE_DECAY = 0.999;
const MAX_OPTIONS = 3;

/** Adjusted net yards (ANY/A's numerator), plus the passer's own runs at `rushWeight`. */
export function netYards(l: NflPasserLine, rushWeight: number) {
  return l.yds + 20 * l.td - 45 * l.int - l.sackYds + rushWeight * (l.rushYds + 20 * l.rushTd);
}

export function playCount(l: NflPasserLine, rushWeight: number) {
  return l.att + l.sacks + rushWeight * l.rushAtt;
}

type Candidate = { id: string; name: string; status: string | null; miss: number };

/**
 * Rates every NFL passer by adjusted net yards per play, recency-weighted and
 * shrunk toward a below-average prior until he has real snaps. Each game
 * compares its starter with the quarterbacks the team has been starting: the
 * team ratings already reflect those, so only the difference moves the
 * forecast. A backup starting lowers it; the starter coming back raises it.
 * The comparison uses everyone's current rating, so the usual starter's own
 * hot or cold streak doesn't move it (the team rating already follows form).
 */
export class QbModel {
  private qbs = new Map<string, QbState>();
  /** Per team, each quarterback's share of recent starts. */
  private shares = new Map<string, Map<string, number>>();
  private leagueNet = 6 * 300;
  private leaguePlays = 300;

  constructor(private params: QbParams) {}

  private get leagueRate() {
    return this.leagueNet / this.leaguePlays;
  }

  rating(id: string) {
    const q = this.qbs.get(id);
    const { priorPlays, priorRating } = this.params;
    if (!q) return priorRating;
    const league = this.leagueRate;
    return (q.net + priorPlays * (league + priorRating)) / (q.plays + priorPlays) - league;
  }

  /**
   * The expected starter rating when candidates are tried in order: each starts
   * if everyone ahead of him sits and he plays. Whatever chance is left goes
   * to an unknown quarterback at the prior.
   */
  private chain(candidates: Candidate[]) {
    let remaining = 1;
    let rating = 0;
    const chances: number[] = [];
    for (const c of candidates) {
      const chance = remaining * (1 - c.miss);
      chances.push(chance);
      rating += chance * this.rating(c.id);
      remaining *= c.miss;
    }
    return { rating: rating + remaining * this.params.priorRating, chances };
  }

  private baseline(teamId: string) {
    const shares = this.shares.get(teamId);
    if (!shares) return undefined;
    let total = 0;
    let sum = 0;
    for (const [id, share] of shares) {
      total += share;
      sum += share * this.rating(id);
    }
    return total > 0 ? sum / total : undefined;
  }

  private view(teamId: string, candidates: Candidate[]): TeamQb {
    const { rating, chances } = this.chain(candidates);
    const baseline = this.baseline(teamId) ?? rating;
    const elo = this.params.eloPerYard * (rating - baseline);
    const options = candidates
      .map((c, i): QbOption => {
        // Elo lost to his possible absence: the team with him cleared to play minus as reported.
        const cleared = c.miss > 0 ? this.chain(candidates.map((x, j) => (j === i ? { ...x, miss: 0 } : x))).rating : rating;
        return {
          id: c.id,
          name: this.qbs.get(c.id)?.name ?? c.name,
          rating: this.rating(c.id),
          plays: this.qbs.get(c.id)?.plays ?? 0,
          chance: chances[i],
          status: c.status,
          cost: this.params.eloPerYard * (cleared - rating)
        };
      })
      .filter((o, i) => i === 0 || o.chance >= 0.005 || o.cost > 0.5);
    const top = [...(this.shares.get(teamId) ?? [])].sort((a, b) => b[1] - a[1])[0];
    const usual = top ? { id: top[0], name: this.qbs.get(top[0])?.name ?? 'Unknown' } : null;
    return { elo, rating, baseline, options, usual };
  }

  /** A finished game: the starter from its box score. */
  viewFromBox(teamId: string, team: NflTeamBox) {
    return this.view(teamId, team.starter ? [{ ...team.starter, status: null, miss: 0 }] : []);
  }

  /**
   * Every passer with real recent snaps, best first: adjusted net yards per
   * play above league average, decayed play count and current team.
   */
  leaderboard(since: string, minPlays = 150) {
    return [...this.qbs]
      .filter(([, q]) => q.plays >= minPlays && (q.lastStart ?? '') >= since)
      .map(([id, q]) => ({ id, name: q.name, teamId: q.team, rating: this.rating(id), perPlay: this.leagueRate + this.rating(id), plays: q.plays, lastStart: q.lastStart }))
      .sort((a, b) => b.rating - a.rating);
  }

  /** Quarterbacks who started for a team, most recent first, for when no depth chart is available. */
  recentStarters(teamId: string): RosterEntry[] {
    return [...this.qbs]
      .filter(([, q]) => q.team === teamId && q.lastStart)
      .sort((a, b) => b[1].lastStart!.localeCompare(a[1].lastStart!))
      .map(([id, q]) => ({ id, name: q.name }));
  }

  /**
   * An upcoming game: quarterbacks in depth-chart order (or by most recent
   * start), each with his chance of playing read from the injury report.
   */
  project(teamId: string, depth: RosterEntry[] | undefined, injuries: InjuryEntry[]) {
    const listed = (depth?.length ? depth : this.recentStarters(teamId)).slice(0, MAX_OPTIONS);
    const report = new Map(injuries.map((i) => [i.athleteId, i]));
    return this.view(
      teamId,
      listed.map((r) => {
        const injury = report.get(r.id);
        return { id: r.id, name: r.name, status: injury?.status ?? null, miss: injury ? missChance(injury.status) : 0 };
      })
    );
  }

  /** Updates the team's start shares and every passer's rating after a game. */
  record(game: Game, box: Extract<BoxScore, { league: 'nfl' }>) {
    const { decay, rushWeight, baselineAlpha } = this.params;
    for (const teamId of [game.home.teamId, game.away.teamId]) {
      const team = box.teams[teamId];
      if (!team) continue;
      if (team.starter) {
        const shares = this.shares.get(teamId) ?? new Map<string, number>();
        for (const [id, share] of shares) shares.set(id, share * (1 - baselineAlpha));
        shares.set(team.starter.id, (shares.get(team.starter.id) ?? 0) + (shares.size ? baselineAlpha : 1));
        this.shares.set(teamId, shares);
      }
      for (const l of team.passers) {
        const plays = playCount(l, rushWeight);
        if (plays <= 0) continue;
        const net = netYards(l, rushWeight);
        const q = this.qbs.get(l.id) ?? { name: l.name, team: teamId, net: 0, plays: 0, lastStart: null };
        const keep = decay ** (plays / PLAYS_PER_GAME);
        q.net = q.net * keep + net;
        q.plays = q.plays * keep + plays;
        q.name = l.name;
        q.team = teamId;
        this.qbs.set(l.id, q);
        const leagueKeep = LEAGUE_DECAY ** (plays / PLAYS_PER_GAME);
        this.leagueNet = this.leagueNet * leagueKeep + net;
        this.leaguePlays = this.leaguePlays * leagueKeep + plays;
      }
      if (team.starter) {
        const q = this.qbs.get(team.starter.id) ?? { name: team.starter.name, team: teamId, net: 0, plays: 0, lastStart: null };
        q.team = teamId;
        q.lastStart = game.date;
        this.qbs.set(team.starter.id, q);
      }
    }
  }
}

/**
 * Walks the games in date order. Finished games take the starter from their
 * box score and then update the ratings; games still to play are projected
 * from the depth chart and the injury report. Returns each game's adjustment
 * (home minus away, Elo) for the rating replays, plus the detail behind it.
 */
export function qbPass(
  games: Game[],
  box: Record<string, BoxScore | null>,
  params: QbParams,
  live: { depth: Record<string, RosterEntry[]>; injuries: Record<string, InjuryEntry[]> }
) {
  const model = new QbModel(params);
  const extra = new Map<string, number>();
  const starters = new Map<string, GameQbs>();
  for (const game of games) {
    const b = box[game.id];
    const homeId = game.home.teamId;
    const awayId = game.away.teamId;
    if (game.completed && b?.league === 'nfl') {
      const homeBox = b.teams[homeId];
      const awayBox = b.teams[awayId];
      if (homeBox?.starter && awayBox?.starter) {
        const home = model.viewFromBox(homeId, homeBox);
        const away = model.viewFromBox(awayId, awayBox);
        extra.set(game.id, home.elo - away.elo);
        starters.set(game.id, { home, away, source: 'box score' });
      }
      model.record(game, b);
    } else if (!game.completed) {
      const home = model.project(homeId, live.depth[homeId], live.injuries[homeId] ?? []);
      const away = model.project(awayId, live.depth[awayId], live.injuries[awayId] ?? []);
      extra.set(game.id, home.elo - away.elo);
      starters.set(game.id, { home, away, source: 'depth chart' });
    }
  }
  return { extra, starters, model };
}

/** "Mayfield (65%) or Daniels (35%)", or "McKee, usually Hurts (injured reserve)", for the factor table. */
export function describeQb(team: TeamQb) {
  const likely = team.options.filter((o) => o.chance >= 0.005).sort((a, b) => b.chance - a.chance);
  const out = team.options.filter((o) => o.chance < 0.005 && o.status);
  const who = likely.map((o) => `${o.name}${likely.length > 1 ? ` (${Math.round(o.chance * 100)}%)` : ''}`).join(' or ');
  const usualListed = team.usual && team.options.some((o) => o.id === team.usual!.id);
  const notes = [
    ...out.map((o) => `${o.name} ${o.status?.toLowerCase()}`),
    ...(team.usual && !usualListed ? [`usually ${team.usual.name}`] : [])
  ];
  if (!who) return notes.length ? notes.join(', ') : 'Starter unknown';
  return notes.length ? `${who}, ${notes.join(', ')}` : who;
}

/** "Joe Fagnano instead of Lamar Jackson", when the likeliest starter isn't the team's usual one; null otherwise. */
export function qbChange(team: Pick<TeamQb, 'options' | 'usual'>) {
  const likely = [...team.options].sort((a, b) => b.chance - a.chance)[0];
  if (!likely || likely.chance < 0.005 || !team.usual || likely.id === team.usual.id) return null;
  return `${likely.name} instead of ${team.usual.name}`;
}

/**
 * Quarterbacks on the injury report, valued by the quarterback model (already
 * in the ratings' diff). A usual starter the depth chart has already replaced
 * carries the team's whole shortfall against its usual quarterback play.
 */
export function qbInjuryImpacts(report: InjuryEntry[], team: TeamQb): InjuryImpact[] {
  return report.map((entry): InjuryImpact => {
    const option = team.options.find((o) => o.id === entry.athleteId);
    const chance = missChance(entry.status);
    const replaced = !option && team.usual?.id === entry.athleteId && chance > 0;
    const cost = option?.cost ?? (replaced ? Math.max(0, -team.elo) : 0);
    const next = team.options.find((o) => o.id !== entry.athleteId && o.chance >= 0.005);
    return {
      ...entry,
      missChance: chance,
      value: chance > 0 ? cost / chance : 0,
      elo: -cost,
      reason:
        option && cost > 0.5
          ? `Worth ${Math.round(cost / chance)} Elo more than ${next ? next.name : 'the next quarterback up'}`
          : replaced
            ? `Usual starter; ${next ? `${next.name} starts` : 'a backup starts'} in his place`
            : option
              ? 'Projected to start'
              : 'Not projected to start'
    };
  });
}
