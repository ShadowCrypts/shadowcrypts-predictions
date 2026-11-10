import { BoxScore, getBoxScores, getNflSkillBoxes, getTeamRoster, NflSkillBox } from '../boxscores';
import type { LeagueConfig } from '../leagues';
import type { PropMarket } from '../props';
import type { PlayerHit } from '../search';
import type { LeagueModel } from './index';
import { propEngine, PropInputs } from './propEngines';

/** Players who appeared in this long are listed: a full season and its offseason, so nobody vanishes in summer. */
const WINDOW_DAYS = 400;
/** Playing time in this long counts toward a player's rank, so regulars come first. */
const RECENT_DAYS = 60;
/** A goalie plays all 60 minutes; counted at this share, a starter ranks with a top-pair defenseman rather than above every skater. */
const GOALIE_TIME = 0.35;

/**
 * Who played in one finished game, once each, with his team and how much he
 * was involved: minutes (NBA), ice time (NHL; a goalie's at a discount), or
 * throws, carries and targets (NFL). Anyone who never got on the floor, ice or
 * ball is left out.
 */
export function appearances(box: BoxScore | null | undefined, skill: NflSkillBox | null | undefined) {
  const seen = new Map<string, { name: string; teamId: string; usage: number }>();
  const add = (id: string, name: string, teamId: string, usage: number) => {
    if (!(usage > 0)) return;
    const known = seen.get(id);
    if (known) known.usage += usage;
    else seen.set(id, { name, teamId, usage });
  };
  if (box?.league === 'nba') {
    for (const [teamId, lines] of Object.entries(box.teams)) for (const l of lines) add(l.id, l.name, teamId, l.min);
  } else if (box?.league === 'nhl') {
    for (const [teamId, team] of Object.entries(box.teams)) {
      for (const s of team.skaters) add(s.id, s.name, teamId, s.toi);
      for (const g of team.goalies) add(g.id, g.name, teamId, g.toi * GOALIE_TIME);
    }
  } else if (box?.league === 'nfl') {
    for (const [teamId, team] of Object.entries(box.teams)) for (const p of team.passers) add(p.id, p.name, teamId, p.att);
  }
  // Carries and targets (a quarterback's throws came from the passing list above).
  for (const [teamId, lines] of Object.entries(skill?.teams ?? {})) {
    for (const l of lines) add(l.id, l.name, teamId, l.rushAtt + Math.max(l.tgt, l.rec));
  }
  return seen;
}

const rosterTeams = new WeakMap<LeagueModel, Promise<Map<string, string>>>();

/**
 * Who's on which team today, by team id, from ESPN's current rosters (cached for
 * hours). It beats the team a player last played for: a trade or a demotion shows
 * here before his next game does. A team that doesn't answer is left out.
 */
export function currentTeams(league: LeagueConfig, model: LeagueModel): Promise<Map<string, string>> {
  let teams = rosterTeams.get(model);
  if (!teams) {
    teams = (async () => {
      const found = new Map<string, string>();
      await Promise.all(
        model.rankings.map(async (r) => {
          for (const p of (await getTeamRoster(league, r.team.id).catch(() => null)) ?? []) found.set(p.id, r.team.id);
        })
      );
      return found;
    })();
    rosterTeams.set(model, teams);
  }
  return teams;
}

// Built once per model build (models are replaced, not mutated), from box scores already on disk.
const directories = new WeakMap<LeagueModel, Promise<PlayerHit[]>>();

/**
 * Every player with a page in this league: whoever appeared in a finished game
 * in the last season or so, on the team he last played for, or the one he's
 * lined up with for a game on the board when he's moved since. Reads only
 * stored box scores; nothing new is fetched.
 */
export function playerDirectory(league: LeagueConfig, model: LeagueModel, now = Date.now()): Promise<PlayerHit[]> {
  if (!propEngine(league)) return Promise.resolve([]);
  let directory = directories.get(model);
  if (!directory) {
    directory = build(league, model, now).catch(() => {
      directories.delete(model);
      return [];
    });
    directories.set(model, directory);
  }
  return directory;
}

async function build(league: LeagueConfig, model: LeagueModel, now: number): Promise<PlayerHit[]> {
  const from = new Date(now - WINDOW_DAYS * 86_400_000).toISOString();
  const recent = new Date(now - RECENT_DAYS * 86_400_000).toISOString();
  const finished = Object.values(model.predictions)
    .map((p) => p.game)
    .filter((g) => g.completed && g.date >= from)
    .sort((a, b) => b.date.localeCompare(a.date));
  const [box, skill] = await Promise.all([getBoxScores(league, finished, 0), getNflSkillBoxes(league, finished, 0)]);

  // Newest game first, so the first team seen is the one he last played for.
  const players = new Map<string, { name: string; teamId: string; usage: number }>();
  for (const game of finished) {
    for (const [id, p] of appearances(box[game.id], skill[game.id])) {
      const known = players.get(id) ?? players.set(id, { name: p.name, teamId: p.teamId, usage: 0 }).get(id)!;
      if (game.date >= recent) known.usage += p.usage;
    }
  }
  // Lined up with another team for a game on the board: he's moved.
  for (const projection of Object.values(model.playerProjections)) {
    for (const p of [...projection.home, ...projection.away]) {
      const known = players.get(p.id);
      if (known) known.teamId = p.teamId;
    }
  }
  // On another team's roster today: he's moved, whether or not he's played for them yet.
  for (const [id, teamId] of await currentTeams(league, model)) {
    const known = players.get(id);
    if (known) known.teamId = teamId;
  }
  const percentile = usagePercentiles([...players.values()].map((p) => p.usage));
  return [...players]
    .map(([id, p]) => ({ league: league.id, id, name: p.name, team: model.teams[p.teamId]?.abbr ?? '', usage: percentile(p.usage) }))
    .sort((a, b) => b.usage - a.usage || a.name.localeCompare(b.name));
}

/** Games averaged for recent form, and the most kept per player for hit rates. */
export const FORM_GAMES = 5;
export const LOG_GAMES = 20;

export type RecentForm = Map<string, Partial<Record<PropMarket, number>>>;
/** Each player's stats in his latest games, newest first. */
export type RecentGames = Map<string, Partial<Record<PropMarket, number>>[]>;

const logs = new WeakMap<LeagueModel, Promise<RecentGames>>();
const forms = new WeakMap<LeagueModel, Promise<RecentForm>>();

/**
 * Each player's stats in every prop market over his last {@link LOG_GAMES}
 * games played (within the last season or so), built once per model from
 * stored box scores: what hit rates against a line are counted from.
 */
export function recentGames(league: LeagueConfig, model: LeagueModel, now = Date.now()): Promise<RecentGames> {
  const engine = propEngine(league);
  if (!engine) return Promise.resolve(new Map());
  let log = logs.get(model);
  if (!log) {
    log = (async () => {
      const from = new Date(now - WINDOW_DAYS * 86_400_000).toISOString();
      const finished = Object.values(model.predictions)
        .map((p) => p.game)
        .filter((g) => g.completed && g.date >= from)
        .sort((a, b) => b.date.localeCompare(a.date));
      const [box, skill] = await Promise.all([getBoxScores(league, finished, 0), getNflSkillBoxes(league, finished, 0)]);
      const inputs: PropInputs = { games: finished, box, skill, context: { teamPoints: new Map(), leaguePoints: new Map() }, live: { rosters: {}, injuries: {}, starters: new Map() } };
      // Newest first: each player's first appearances are his latest games.
      const games: RecentGames = new Map();
      for (const game of finished) {
        for (const [id, stats] of engine.actuals(game.id, inputs) ?? []) {
          const list = games.get(id) ?? games.set(id, []).get(id)!;
          if (list.length < LOG_GAMES) list.push(stats);
        }
      }
      return games;
    })().catch(() => {
      logs.delete(model);
      return new Map();
    });
    logs.set(model, log);
  }
  return log;
}

/** Each player's average in every prop market over his last few games: what the game page and props board show as "L5". */
export function recentForm(league: LeagueConfig, model: LeagueModel, now = Date.now()): Promise<RecentForm> {
  let form = forms.get(model);
  if (!form) {
    form = recentGames(league, model, now).then((games) => averageForm(new Map([...games].map(([id, list]) => [id, list.slice(0, FORM_GAMES)]))));
    forms.set(model, form);
  }
  return form;
}

/** The average of each market over each player's listed games (markets he never logged are left out). */
export function averageForm(games: Map<string, Partial<Record<PropMarket, number>>[]>): RecentForm {
  const out: RecentForm = new Map();
  for (const [id, list] of games) {
    const sums: Partial<Record<PropMarket, { total: number; n: number }>> = {};
    for (const stats of list) {
      for (const [m, v] of Object.entries(stats) as [PropMarket, number | undefined][]) {
        if (v === undefined) continue;
        const s = (sums[m] ??= { total: 0, n: 0 });
        s.total += v;
        s.n += 1;
      }
    }
    out.set(id, Object.fromEntries(Object.entries(sums).map(([m, s]) => [m, Math.round((s!.total / s!.n) * 10) / 10])));
  }
  return out;
}

/**
 * Playing time as a percentile of the league's (0 for none lately, 100 for
 * the most), so it compares across leagues whose units and number of games
 * played so far differ: a top NBA starter and a top NFL quarterback both
 * land near 100.
 */
export function usagePercentiles(values: number[]) {
  const sorted = values.filter((v) => v > 0).sort((a, b) => a - b);
  return (value: number) => {
    if (!(value > 0) || !sorted.length) return 0;
    // How many played as much or less (binary search), so ties share a percentile and the busiest are 100.
    let lo = 0;
    let hi = sorted.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (sorted[mid] <= value) lo = mid + 1;
      else hi = mid;
    }
    return Math.max(1, Math.round((100 * lo) / sorted.length));
  };
}
