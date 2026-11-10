import { BoxScore, getBoxScores, getNflSkillBoxes, NflSkillBox } from '../boxscores';
import type { Game } from '../espn';
import type { LeagueConfig } from '../leagues';
import { propEngine, PropInputs } from './propEngines';
import { GradedPick, gradePropLedger, LivePropRecord, PropLedger, readPropLedger } from './propLedger';
import type { Actuals } from './propModel';

export const PICK_COLUMNS = [
  'league',
  'game_id',
  'start_utc',
  'logged_utc',
  'player_id',
  'player',
  'market',
  'line',
  'side',
  'over_price',
  'under_price',
  'book',
  'projected',
  'model_over',
  'edge',
  'actual',
  'result'
] as const;

/** Graded picks as CSV, oldest first: the line and prices as logged, the model's view, and what happened. */
export function picksCsv(league: string, picks: GradedPick[]) {
  const field = (v: string | number | null) => {
    const text = v === null ? '' : typeof v === 'string' && /^[=+@\t]/.test(v) ? `'${v}` : String(v);
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const rows = [...picks]
    .sort((a, b) => a.entry.start.localeCompare(b.entry.start) || a.entry.name.localeCompare(b.entry.name))
    .map(({ entry: e, actual, result }) =>
      [league, e.gameId, e.start, e.takenAt, e.athleteId, e.name, e.market, e.line, e.side, e.over, e.under, e.book, Number(e.projected.toFixed(2)), Number(e.model.toFixed(4)), Number(e.edge.toFixed(4)), actual, result]
        .map(field)
        .join(',')
    );
  return [PICK_COLUMNS.join(','), ...rows].join('\r\n') + '\r\n';
}

/**
 * The model's logged prop picks for one set of games (a day's), graded like the
 * forward record: from the stored box scores, a player who didn't play voided,
 * a game whose box score isn't in yet left pending. Null when none were logged.
 */
export async function propPicksFor(league: LeagueConfig, games: Game[], keep?: number): Promise<LivePropRecord | null> {
  const engine = propEngine(league);
  const finished = games.filter((g) => g.completed);
  if (!engine || !finished.length) return null;
  const ids = new Set(finished.map((g) => g.id));
  const ledger: PropLedger = Object.fromEntries(Object.entries(await readPropLedger(league.id)).filter(([, e]) => ids.has(e.gameId)));
  if (!Object.keys(ledger).length) return null;
  const [box, skill] = await Promise.all([
    getBoxScores(league, finished, 0).catch(() => ({}) as Record<string, BoxScore | null>),
    getNflSkillBoxes(league, finished, 0).catch(() => ({}) as Record<string, NflSkillBox | null>)
  ]);
  const inputs: PropInputs = { games: finished, box, skill, context: { teamPoints: new Map(), leaguePoints: new Map() }, live: { rosters: {}, injuries: {}, starters: new Map() } };
  const actuals = new Map<string, Actuals | null>(finished.map((g) => [g.id, engine.actuals(g.id, inputs)]));
  const record = gradePropLedger(ledger, (e) => {
    // Graded exactly as the forward record on the track record page grades it.
    const stats = actuals.get(e.gameId);
    if (!stats) return undefined;
    return stats.get(e.athleteId)?.[e.market] ?? null;
  }, keep);
  return record.bets || record.pushes || record.pending ? record : null;
}
