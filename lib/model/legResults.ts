import { getBoxScores, getLiveBox, getNflSkillBoxes, LiveBox } from '../boxscores';
import { isLeagueId, LEAGUES } from '../leagues';
import { LegResult, liveDecision, ParsedLeg, parseLegId, propResult } from '../legs';
import { freshen } from './fresh';
import { getLeagueModel } from './index';
import { liveNow, remainingNow } from './live';
import { propEngine, PropInputs } from './propEngines';
import type { Actuals } from './propModel';

const noContext: Pick<PropInputs, 'context' | 'live'> = {
  context: { teamPoints: new Map(), leaguePoints: new Map() },
  live: { rosters: {}, injuries: {}, starters: new Map() }
};

/** The team a player is listed under in a live box score. */
function teamIn(read: LiveBox | undefined, playerId: string) {
  const has = (ids: { id: string }[]) => ids.some((x) => x.id === playerId);
  for (const [teamId, lines] of Object.entries(read?.skill?.teams ?? {})) if (has(lines)) return teamId;
  const box = read?.box;
  if (box?.league === 'nba') return Object.entries(box.teams).find(([, lines]) => has(lines))?.[0] ?? null;
  if (box?.league === 'nhl') return Object.entries(box.teams).find(([, t]) => has(t.skaters) || has(t.goalies))?.[0] ?? null;
  if (box?.league === 'nfl') return Object.entries(box.teams).find(([, t]) => has(t.passers))?.[0] ?? null;
  return null;
}

/**
 * Results for parlay legs, by id: from the score (a team to win) or the
 * player's box score (a prop) once the game is final, and the box score so
 * far while it's on. Games the model doesn't know are left out, and a
 * postponed or canceled game voids.
 */
export async function legResults(ids: string[]): Promise<Record<string, LegResult>> {
  const parsed = ids.map((id) => [id, parseLegId(id)] as const).filter((x): x is readonly [string, ParsedLeg] => !!x[1] && isLeagueId(x[1].league));
  const out: Record<string, LegResult> = {};
  for (const leagueId of new Set(parsed.map(([, l]) => l.league))) {
    if (!isLeagueId(leagueId)) continue;
    const league = LEAGUES[leagueId];
    const model = await getLeagueModel(leagueId).catch(() => null);
    if (!model) continue;
    const legs = parsed.filter(([, l]) => l.league === leagueId);
    // With the latest scores and status, so a leg settles (and a team's live chance moves) as soon as the scoreboard does.
    const games = await freshen(
      leagueId,
      [...new Set(legs.map(([, l]) => l.gameId))].map((id) => model.predictions[id]).filter((p) => p !== undefined)
    );
    const byGame = new Map(games.map((p) => [p.game.id, p]));
    const engine = propEngine(league);
    const actuals = new Map<string, Actuals | null>();
    // The clock and score from the same read as the live stats, which can run ahead of the model's last build.
    const reads = new Map<string, LiveBox>();
    const wantsProps = (gameId: string) => legs.some(([, l]) => l.kind === 'prop' && l.gameId === gameId);
    if (engine) {
      const finals = games.map((p) => p.game).filter((g) => g.completed && wantsProps(g.id));
      if (finals.length) {
        const [box, skill] = await Promise.all([getBoxScores(league, finals), getNflSkillBoxes(league, finals)]);
        const inputs: PropInputs = { games: finals, box, skill, ...noContext };
        for (const g of finals) actuals.set(g.id, engine.actuals(g.id, inputs));
      }
      await Promise.all(
        games
          .map((p) => p.game)
          .filter((g) => g.state === 'in' && wantsProps(g.id))
          .map(async (g) => {
            const now = await getLiveBox(league, g.id).catch(() => null);
            const inputs: PropInputs = { games: [g], box: { [g.id]: now?.box ?? null }, skill: { [g.id]: now?.skill ?? null }, ...noContext };
            actuals.set(g.id, now?.box || now?.skill ? engine.actuals(g.id, inputs) : null);
            if (now) reads.set(g.id, now);
          })
      );
    }
    for (const [id, leg] of legs) {
      const prediction = byGame.get(leg.gameId);
      if (!prediction) continue;
      const game = prediction.game;
      if (leg.kind === 'win' && leg.teamId !== game.home.teamId && leg.teamId !== game.away.teamId) continue;
      if (game.state === 'post' && !game.completed) {
        out[id] = { state: 'void', actual: null };
      } else if (game.state === 'in') {
        const read = reads.get(game.id);
        const status = read?.status ?? game.statusDetail;
        const left = read ? remainingNow(leagueId, { period: read.period ?? 0, clock: read.clock, outs: null, statusDetail: status }) : remainingNow(leagueId, game);
        const played = left === null ? null : 1 - left;
        const margin = read?.margin ?? (game.home.score !== null && game.away.score !== null ? game.home.score - game.away.score : null);
        if (leg.kind === 'win') {
          const home = liveNow(leagueId, game, prediction.homeProb)?.homeProb ?? null;
          out[id] = { state: 'pending', actual: null, live: { status, decided: null, chance: home === null ? null : leg.teamId === game.home.teamId ? home : 1 - home } };
        } else {
          // Null until he's in the box score: books void a player who never plays.
          const row = actuals.get(game.id)?.get(leg.playerId);
          const current = row ? (row[leg.market] ?? 0) : null;
          const team = teamIn(read, leg.playerId);
          out[id] = {
            state: 'pending',
            actual: current,
            live: {
              status,
              decided: current === null ? null : liveDecision(current, leg.line, leg.side, leg.market),
              chance: null,
              played,
              lead: margin === null ? null : Math.abs(margin),
              edge: margin === null || team === null ? null : team === game.home.teamId ? margin : -margin
            }
          };
        }
      } else if (!game.completed || game.home.score === null || game.away.score === null) {
        out[id] = { state: 'pending', actual: null };
      } else if (leg.kind === 'win') {
        if (game.home.score === game.away.score) out[id] = { state: 'push', actual: null };
        else out[id] = { state: game.home.score > game.away.score === (leg.teamId === game.home.teamId) ? 'won' : 'lost', actual: null };
      } else {
        const stats = actuals.get(game.id);
        // No box score yet: try again later.
        out[id] = stats ? propResult(stats.get(leg.playerId)?.[leg.market], leg.line, leg.side) : { state: 'pending', actual: null };
      }
    }
  }
  return out;
}
