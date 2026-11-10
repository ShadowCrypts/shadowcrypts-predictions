import { BoxScore, getBoxScores, getNflSkillBoxes, NflSkillBox } from '../boxscores';
import type { Game } from '../espn';
import type { LeagueConfig, LeagueId } from '../leagues';
import { getPropHistory } from '../propFeed';
import { isPriced, mainLines, PropLine, PropMarket } from '../props';
import { freshen } from './fresh';
import type { LeagueModel, Prediction } from './index';
import type { PropRow } from './propBoard';
import { propEngine, PropInputs } from './propEngines';

export type PlayerGame = {
  gameId: string;
  date: string;
  /** The season the game belongs to (ESPN's season year). */
  seasonYear: number;
  opponent: string;
  home: boolean;
  /** Played at a neutral site, whichever side he was listed on. */
  neutral?: boolean;
  /** Minutes, ice time or touches, for context. */
  detail: string | null;
  stats: Partial<Record<PropMarket, number>>;
  /** The book's main line that game, per market, when one was on file. */
  lines: Partial<Record<PropMarket, Pick<PropLine, 'line' | 'over' | 'under' | 'book'>>>;
};

export type PlayerLog = { id: string; name: string; teamId: string; games: PlayerGame[] };

/** A team's games that could be on right now (started in the last six hours and not final), from a model's own record. */
export function maybeLive(model: LeagueModel, teamId: string, now = Date.now()) {
  return (model.teamGames[teamId] ?? [])
    .map((id) => model.predictions[id])
    .filter((p): p is Prediction => !!p && !p.game.completed && Date.parse(p.game.date) <= now && Date.parse(p.game.date) >= now - 6 * 3_600_000);
}

/** The game a team is playing right now, with the latest score and clock, or null. */
export async function liveGameOf(league: LeagueId, model: LeagueModel, teamId: string, now = Date.now()): Promise<Game | null> {
  const candidates = maybeLive(model, teamId, now);
  if (!candidates.length) return null;
  return (await freshen(league, candidates, now)).find((p) => p.game.state === 'in')?.game ?? null;
}

/** His next game on the board, soonest first: the game and his row of projections and lines. */
export function nextPropRow(model: LeagueModel, playerId: string): { game: Game; row: PropRow } | null {
  let best: { game: Game; row: PropRow } | null = null;
  for (const [gameId, board] of Object.entries(model.propBoards)) {
    const row = board.rows.find((r) => r.id === playerId);
    const game = model.predictions[gameId]?.game;
    if (row && game && (!best || game.date < best.game.date)) best = { game, row };
  }
  return best;
}

/**
 * His next game with our projections: the prop board's row (lines included)
 * once the books are up, else the model's projections on their own, for a
 * game further out than any board.
 */
export function nextGameRow(model: LeagueModel, playerId: string): { game: Game; row: PropRow } | null {
  const lined = nextPropRow(model, playerId);
  let projected: { game: Game; row: PropRow } | null = null;
  for (const [gameId, projection] of Object.entries(model.playerProjections)) {
    const game = model.predictions[gameId]?.game;
    if (!game || game.state !== 'pre' || (projected && projected.game.date <= game.date)) continue;
    const p = [...projection.home, ...projection.away].find((x) => x.id === playerId);
    if (!p) continue;
    const cells = Object.fromEntries(Object.entries(p.mean).map(([m, projection]) => [m, { projection, actual: null, line: null }]));
    projected = { game, row: { id: p.id, name: p.name, teamId: p.teamId, detail: p.detail, available: p.available, cells } };
  }
  return lined && (!projected || lined.game.date <= projected.game.date) ? lined : projected;
}

/** Who the player is and what he logged besides the prop stats, from one game's box score. */
function boxPlayer(box: BoxScore | null | undefined, skill: NflSkillBox | null | undefined, playerId: string): { name: string; teamId: string; detail: string | null } | null {
  if (box?.league === 'nba') {
    for (const [teamId, lines] of Object.entries(box.teams)) {
      const l = lines.find((x) => x.id === playerId);
      if (l) return { name: l.name, teamId, detail: l.min > 0 ? `${Math.round(l.min)} min` : null };
    }
  }
  if (box?.league === 'nhl') {
    for (const [teamId, team] of Object.entries(box.teams)) {
      const s = team.skaters.find((x) => x.id === playerId);
      if (s) return { name: s.name, teamId, detail: s.toi > 0 ? `${Math.round(s.toi)} min` : null };
      const g = team.goalies.find((x) => x.id === playerId);
      if (g) return { name: g.name, teamId, detail: `${g.sa} shots faced` };
    }
  }
  if (skill) {
    for (const [teamId, lines] of Object.entries(skill.teams)) {
      const l = lines.find((x) => x.id === playerId);
      if (l) return { name: l.name, teamId, detail: l.tgt || l.rec ? `${l.tgt} targets, ${l.rushAtt} carries` : `${l.rushAtt} carries` };
    }
  }
  if (box?.league === 'nfl') {
    for (const [teamId, team] of Object.entries(box.teams)) {
      const p = team.passers.find((x) => x.id === playerId);
      if (p) return { name: p.name, teamId, detail: `${p.att} attempts` };
    }
  }
  return null;
}

/**
 * A player's most recent games, newest first: what he did in each prop market,
 * and the book's main line that game where one is on file. `keep` narrows it
 * (games against one opponent, say). Reads only what's already stored; nothing
 * new is fetched for a page view.
 */
export async function playerLog(league: LeagueConfig, model: LeagueModel, playerId: string, limit = 12, keep?: (game: PlayerGame) => boolean): Promise<PlayerLog | null> {
  const engine = propEngine(league);
  if (!engine) return null;
  const finished: Game[] = Object.values(model.predictions)
    .map((p) => p.game)
    .filter((g) => g.completed)
    .sort((a, b) => b.date.localeCompare(a.date));
  const [box, skill, props] = await Promise.all([
    getBoxScores(league, finished, 0).catch(() => ({}) as Record<string, BoxScore | null>),
    getNflSkillBoxes(league, finished, 0).catch(() => ({}) as Record<string, NflSkillBox | null>),
    getPropHistory(league, finished, 0).catch(() => ({}) as Record<string, PropLine[] | null>)
  ]);
  const inputs: PropInputs = {
    games: finished,
    box,
    skill,
    context: { teamPoints: new Map(), leaguePoints: new Map() },
    live: { rosters: {}, injuries: {}, starters: new Map() }
  };
  const games: PlayerGame[] = [];
  let who: { name: string; teamId: string } | null = null;
  for (const game of finished) {
    const found = boxPlayer(box[game.id], skill[game.id], playerId);
    const stats = found ? engine.actuals(game.id, inputs)?.get(playerId) : undefined;
    if (!found || !stats) continue;
    who ??= found;
    const lines: PlayerGame['lines'] = {};
    for (const l of mainLines((props[game.id] ?? []).filter((x) => x.athleteId === playerId && isPriced(x)))) {
      lines[l.market] = { line: l.line, over: l.over, under: l.under, book: l.book };
    }
    const home = game.home.teamId === found.teamId;
    const played: PlayerGame = { gameId: game.id, date: game.date, seasonYear: game.seasonYear, opponent: (home ? game.away : game.home).abbr, home, neutral: game.neutral, detail: found.detail, stats, lines };
    if (keep && !keep(played)) continue;
    games.push(played);
    if (games.length >= limit) break;
  }
  return who ? { id: playerId, name: who.name, teamId: who.teamId, games } : null;
}
