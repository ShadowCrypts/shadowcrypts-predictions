import type { BoxScore, NflSkillBox, NflSkillLine, RosterEntry } from '../boxscores';
import type { Game, InjuryEntry } from '../espn';
import type { PropMarket } from '../props';
import { missChance } from './adjustments';
import type { TeamContext } from './nbaPlayers';
import type { Actuals, GameProjection, PlayerProjection, PropModelParams } from './propModel';

export const NFL_MARKETS: PropMarket[] = ['pass_yds', 'pass_cmp', 'pass_att', 'pass_td', 'pass_int', 'pass_rush_yds', 'rush_yds', 'rush_att', 'rec_yds', 'rec', 'rush_rec_yds'];

export type NflPlayerParams = PropModelParams & {
  /** Per-game decay of a player's older games, so recent usage counts more. */
  decay: number;
  /** Targets of league-average catching and yards per target every receiver starts with (shrinkage). */
  priorTargets: number;
  /** Carries of league-average yards per carry every rusher starts with. */
  priorCarries: number;
  /** Pass attempts of league-average completion rate, yards and touchdowns every quarterback starts with. */
  priorAttempts: number;
  /** How far yards and touchdowns follow the team's implied points against its usual scoring (0 none, 1 fully). */
  teamShare: number;
  /** How fast a team's pass and rush attempts per game follow recent games. */
  volumeAlpha: number;
  /** Touches of league-average scoring every player starts with: touchdowns are rare, so a player's own rate takes a lot of games to trust. */
  priorTouches?: number;
};

type Usage = { name: string; team: string; tgt: number; rec: number; recYds: number; recTd: number; car: number; rushYds: number; rushTd: number; teamPass: number; teamRush: number; lastDate: string };
type Passer = { name: string; att: number; cmp: number; yds: number; td: number; int: number };
type Team = { pass: number; rush: number; points: number };

const RECENT_DAYS = 24;
export const DEFAULT_PRIOR_TOUCHES = 60;

/** Where a player sits in the offense, from what he's been doing with the ball. */
function roleOf(targets: number, carries: number) {
  return carries > targets ? 'RB' : 'WR/TE';
}

/**
 * NFL player projections, walked through the games in date order: every
 * projection uses only earlier games. Receivers and rushers get their share
 * of the team's targets and carries from recent games, times the team's usual
 * pass and rush attempts; catch rate and yards per target or carry are pulled
 * toward league average until a player has volume. The starting quarterback's
 * completions, yards and touchdowns follow the team's pass attempts and his
 * own rates. Yards and touchdowns then lean toward the team's implied points.
 * When a regular is out, his share goes to the teammates who are playing.
 */
export function nflPlayerPass(
  games: Game[],
  box: Record<string, BoxScore | null>,
  skill: Record<string, NflSkillBox | null>,
  params: NflPlayerParams,
  context: TeamContext,
  live: { rosters: Record<string, RosterEntry[]>; injuries: Record<string, InjuryEntry[]>; starters: Map<string, { home: RosterEntry | null; away: RosterEntry | null }> },
  keep: (game: Game) => boolean = () => true
) {
  const usage = new Map<string, Usage>();
  const passers = new Map<string, Passer>();
  const teams = new Map<string, Team>();
  const league = { tgt: 1000, rec: 650, recYds: 7300, recTd: 45, car: 1000, rushYds: 4300, rushTd: 33, att: 1000, cmp: 650, passYds: 6800, passTd: 45, passInt: 23, pass: 33, rush: 27, points: 22 };
  const priorTouches = params.priorTouches ?? DEFAULT_PRIOR_TOUCHES;
  /** Expected rushing and receiving touchdowns from a player's touches, his own rates pulled toward the league's. */
  const touchdowns = (u: Usage | undefined, targets: number, carries: number, scale: number) => {
    const perTarget = ((u?.recTd ?? 0) + priorTouches * (league.recTd / league.tgt)) / ((u?.tgt ?? 0) + priorTouches);
    const perCarry = ((u?.rushTd ?? 0) + priorTouches * (league.rushTd / league.car)) / ((u?.car ?? 0) + priorTouches);
    return (targets * perTarget + carries * perCarry) * scale;
  };
  const projections = new Map<string, GameProjection>();

  const teamOf = (id: string) => teams.get(id) ?? { pass: league.pass, rush: league.rush, points: league.points };

  const project = (game: Game, side: 'home' | 'away', players: { id: string; name: string; available: number }[], qb: RosterEntry | null): PlayerProjection[] => {
    const teamId = game[side].teamId;
    const team = teamOf(teamId);
    const implied = context.teamPoints.get(game.id)?.[side];
    const scale = implied ? Math.pow(implied / team.points, params.teamShare) : 1;
    const shares = players
      .map((p) => {
        const u = usage.get(p.id);
        return { ...p, name: u?.name ?? p.name, tgtShare: u && u.teamPass > 0 ? u.tgt / u.teamPass : 0, carShare: u && u.teamRush > 0 ? u.car / u.teamRush : 0, u };
      })
      .filter((p) => p.id !== qb?.id);
    // Hand an absent regular's share to the rest: compare who's playing with everyone the team has used lately.
    const cutoff = new Date(Date.parse(game.date) - RECENT_DAYS * 86_400_000).toISOString();
    const regulars = [...usage].filter(([id, u]) => u.team === teamId && u.lastDate >= cutoff && id !== qb?.id).map(([, u]) => u);
    const normalize = (share: (u: Usage) => number, key: 'tgtShare' | 'carShare') => {
      const usual = Math.min(1, regulars.reduce((s, u) => s + share(u), 0));
      const expected = shares.reduce((s, p) => s + p[key] * p.available, 0);
      return expected > 0 && usual > 0 ? Math.min(1.5, Math.max(0.6, usual / expected)) : 1;
    };
    const tgtBoost = normalize((u) => (u.teamPass > 0 ? u.tgt / u.teamPass : 0), 'tgtShare');
    const carBoost = normalize((u) => (u.teamRush > 0 ? u.car / u.teamRush : 0), 'carShare');
    const out: PlayerProjection[] = [];
    for (const p of shares) {
      const u = p.u;
      const targets = p.tgtShare * tgtBoost * team.pass;
      const carries = p.carShare * carBoost * team.rush;
      if (targets < 0.3 && carries < 0.3) continue;
      const catchRate = ((u?.rec ?? 0) + params.priorTargets * (league.rec / league.tgt)) / ((u?.tgt ?? 0) + params.priorTargets);
      const perTarget = ((u?.recYds ?? 0) + params.priorTargets * (league.recYds / league.tgt)) / ((u?.tgt ?? 0) + params.priorTargets);
      const perCarry = ((u?.rushYds ?? 0) + params.priorCarries * (league.rushYds / league.car)) / ((u?.car ?? 0) + params.priorCarries);
      const recYds = targets * perTarget * scale;
      const rushYds = carries * perCarry * scale;
      const role = roleOf(targets, carries);
      out.push({
        id: p.id,
        name: p.name,
        teamId,
        detail: role === 'RB' ? `RB · ${carries.toFixed(1)} carries` : `${role} · ${targets.toFixed(1)} targets`,
        featured: targets >= 3 || carries >= 6,
        available: p.available,
        tds: touchdowns(u, targets, carries, scale),
        mean: { rec: targets * catchRate, rec_yds: recYds, rush_att: carries, rush_yds: rushYds, rush_rec_yds: recYds + rushYds }
      });
    }
    if (qb) {
      const pass = passers.get(qb.id);
      const u = usage.get(qb.id);
      const att = team.pass;
      const rate = (key: 'cmp' | 'yds' | 'td' | 'int', leagueRate: number) => ((pass?.[key] ?? 0) + params.priorAttempts * leagueRate) / ((pass?.att ?? 0) + params.priorAttempts);
      const carries = u && u.teamRush > 0 ? (u.car / u.teamRush) * team.rush : 0;
      const perCarry = ((u?.rushYds ?? 0) + params.priorCarries * (league.rushYds / league.car)) / ((u?.car ?? 0) + params.priorCarries);
      const passYds = att * rate('yds', league.passYds / league.att) * scale;
      const rushYds = carries * perCarry * scale;
      out.push({
        id: qb.id,
        name: pass?.name ?? qb.name,
        teamId,
        detail: `QB · ${att.toFixed(0)} attempts`,
        tds: touchdowns(u, 0, carries, scale),
        featured: true,
        available: 1,
        mean: {
          pass_att: att,
          pass_cmp: att * rate('cmp', league.cmp / league.att),
          pass_yds: passYds,
          pass_td: att * rate('td', league.passTd / league.att) * scale,
          pass_int: att * rate('int', league.passInt / league.att),
          pass_rush_yds: passYds + rushYds,
          rush_att: carries,
          rush_yds: rushYds
        }
      });
    }
    return out;
  };

  /**
   * Players who've touched the ball lately and are on this team now, with each
   * one's chance of playing. The current roster decides, so a player just traded
   * here counts and one traded away doesn't. Past games have no roster to read,
   * so they go by the team he last played for.
   */
  const lineupFor = (teamId: string, asOf: string) => {
    const cutoff = new Date(Date.parse(asOf) - RECENT_DAYS * 86_400_000).toISOString();
    const roster = live.rosters[teamId];
    const onRoster = roster?.length ? new Set(roster.map((r) => r.id)) : null;
    const report = new Map((live.injuries[teamId] ?? []).map((i) => [i.athleteId, i]));
    return [...usage]
      .filter(([id, u]) => (onRoster ? onRoster.has(id) : u.team === teamId) && u.lastDate >= cutoff)
      .map(([id, u]) => {
        const injury = report.get(id);
        return { id, name: u.name, available: injury ? 1 - missChance(injury.status) : 1 };
      })
      .filter((p) => p.available > 0);
  };

  const record = (game: Game, side: 'home' | 'away', lines: NflSkillLine[]) => {
    const teamId = game[side].teamId;
    const b = box[game.id];
    const qbBox = b?.league === 'nfl' ? b.teams[teamId] : undefined;
    const teamPass = qbBox ? qbBox.passers.reduce((s, p) => s + p.att, 0) : lines.reduce((s, l) => s + l.tgt, 0);
    const teamRush = lines.reduce((s, l) => s + l.rushAtt, 0);
    const d = params.decay;
    for (const l of lines) {
      const u = usage.get(l.id) ?? { name: l.name, team: teamId, tgt: 0, rec: 0, recYds: 0, recTd: 0, car: 0, rushYds: 0, rushTd: 0, teamPass: 0, teamRush: 0, lastDate: game.date };
      u.name = l.name;
      u.team = teamId;
      u.lastDate = game.date;
      u.tgt = u.tgt * d + l.tgt;
      u.rec = u.rec * d + l.rec;
      u.recYds = u.recYds * d + l.recYds;
      u.recTd = u.recTd * d + l.recTd;
      u.car = u.car * d + l.rushAtt;
      u.rushYds = u.rushYds * d + l.rushYds;
      u.rushTd = u.rushTd * d + l.rushTd;
      u.teamPass = u.teamPass * d + teamPass;
      u.teamRush = u.teamRush * d + teamRush;
      usage.set(l.id, u);
      league.tgt = league.tgt * 0.999 + l.tgt;
      league.rec = league.rec * 0.999 + l.rec;
      league.recYds = league.recYds * 0.999 + l.recYds;
      league.recTd = league.recTd * 0.999 + l.recTd;
      league.car = league.car * 0.999 + l.rushAtt;
      league.rushYds = league.rushYds * 0.999 + l.rushYds;
      league.rushTd = league.rushTd * 0.999 + l.rushTd;
    }
    for (const p of qbBox?.passers ?? []) {
      if (p.att <= 0) continue;
      const s = passers.get(p.id) ?? { name: p.name, att: 0, cmp: 0, yds: 0, td: 0, int: 0 };
      s.name = p.name;
      s.att = s.att * d + p.att;
      s.cmp = s.cmp * d + p.cmp;
      s.yds = s.yds * d + p.yds;
      s.td = s.td * d + p.td;
      s.int = s.int * d + p.int;
      passers.set(p.id, s);
      league.att = league.att * 0.999 + p.att;
      league.cmp = league.cmp * 0.999 + p.cmp;
      league.passYds = league.passYds * 0.999 + p.yds;
      league.passTd = league.passTd * 0.999 + p.td;
      league.passInt = league.passInt * 0.999 + p.int;
    }
    const t = teamOf(teamId);
    const a = params.volumeAlpha;
    const points = game[side].score ?? t.points;
    teams.set(teamId, { pass: t.pass + a * (teamPass - t.pass), rush: t.rush + a * (teamRush - t.rush), points: t.points + a * (points - t.points) });
    league.pass += 0.01 * (teamPass - league.pass);
    league.rush += 0.01 * (teamRush - league.rush);
    league.points += 0.01 * (points - league.points);
  };

  for (const game of games) {
    const s = skill[game.id];
    const b = box[game.id];
    if (game.completed && s) {
      if (keep(game)) {
        const fromBox = (side: 'home' | 'away') => {
          const teamId = game[side].teamId;
          const starter = b?.league === 'nfl' ? b.teams[teamId]?.starter ?? null : null;
          return project(
            game,
            side,
            (s.teams[teamId] ?? []).map((l) => ({ id: l.id, name: l.name, available: 1 })),
            starter
          );
        };
        projections.set(game.id, { home: fromBox('home'), away: fromBox('away'), source: 'box score' });
      }
      record(game, 'home', s.teams[game.home.teamId] ?? []);
      record(game, 'away', s.teams[game.away.teamId] ?? []);
    } else if (!game.completed && keep(game)) {
      const qbs = live.starters.get(game.id);
      projections.set(game.id, {
        home: project(game, 'home', lineupFor(game.home.teamId, game.date), qbs?.home ?? null),
        away: project(game, 'away', lineupFor(game.away.teamId, game.date), qbs?.away ?? null),
        source: 'injury report'
      });
    }
  }
  return projections;
}

/** What each player did, per market: rushing and receiving for everyone, passing for passers. */
export function nflActuals(box: BoxScore | null | undefined, skill: NflSkillBox | null | undefined): Actuals | null {
  if (!skill) return null;
  const out: Actuals = new Map();
  for (const lines of Object.values(skill.teams)) {
    for (const l of lines) out.set(l.id, { rec: l.rec, rec_yds: l.recYds, rush_att: l.rushAtt, rush_yds: l.rushYds, rush_rec_yds: l.recYds + l.rushYds });
  }
  if (box?.league === 'nfl') {
    for (const team of Object.values(box.teams)) {
      for (const p of team.passers) {
        if (p.att <= 0) continue;
        const rushing = out.get(p.id)?.rush_yds ?? 0;
        out.set(p.id, { ...(out.get(p.id) ?? {}), pass_att: p.att, pass_cmp: p.cmp, pass_yds: p.yds, pass_td: p.td, pass_int: p.int, pass_rush_yds: p.yds + rushing });
      }
    }
  }
  return out;
}
