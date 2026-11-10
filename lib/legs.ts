// Parlay legs as ids the server can grade once games end: a player's stat
// against a line, or a team to win. Safe to use in the browser.
import type { LegLink } from './model/correlation';
import { isPropMarket, PropMarket } from './props';

export type LegState = 'pending' | 'won' | 'lost' | 'push' | 'void';
/**
 * A leg's result. While its game is on, `actual` is the stat so far (null
 * until the player is in the box score) and `live`
 * says where the game is, whether the leg is already decided (an over that
 * has cleared its line, an under that's gone past it), and for a team to win,
 * its live chance.
 */
export type LegResult = {
  state: LegState;
  actual: number | null;
  live?: {
    status: string;
    decided: 'won' | 'lost' | null;
    /** A team to win: its live chance. */
    chance: number | null;
    /** Share of regulation played and the size of the lead, for live prop chances. */
    played?: number | null;
    lead?: number | null;
    /** The player's team's lead, below zero when behind: football's game script. */
    edge?: number | null;
  };
};

export type GradableLeg = { league: string; gameId: string; link?: LegLink | null; line?: number | null };

export type ParsedLeg =
  | { kind: 'win'; league: string; gameId: string; teamId: string }
  | { kind: 'prop'; league: string; gameId: string; playerId: string; market: PropMarket; line: number; side: 'over' | 'under' };

/** "p~nba~401~3112335~pts~24.5~over" or "w~nba~401~27"; null for a leg saved without what grading needs. */
export function legId(leg: GradableLeg): string | null {
  const l = leg.link;
  if (!l) return null;
  if (l.kind === 'win') return ['w', leg.league, leg.gameId, l.teamId].join('~');
  if (leg.line === null || leg.line === undefined) return null;
  return ['p', leg.league, leg.gameId, l.playerId, l.market, leg.line, l.side].join('~');
}

export function parseLegId(id: string): ParsedLeg | null {
  const parts = id.split('~');
  const [kind, league, gameId] = parts;
  if (!/^[a-z]{3}$/.test(league ?? '') || !/^\d+$/.test(gameId ?? '')) return null;
  if (kind === 'w' && parts.length === 4 && /^\d+$/.test(parts[3])) return { kind: 'win', league, gameId, teamId: parts[3] };
  if (kind !== 'p' || parts.length !== 7) return null;
  const [, , , playerId, market, line, side] = parts;
  const value = Number(line);
  if (!/^\d+$/.test(playerId) || !isPropMarket(market) || line === '' || !Number.isFinite(value) || (side !== 'over' && side !== 'under')) return null;
  return { kind: 'prop', league, gameId, playerId, market, line: value, side };
}

/** A prop leg from the player's final stat: no stat means he didn't play, and books void those. */
export function propResult(actual: number | undefined, line: number, side: 'over' | 'under'): LegResult {
  if (actual === undefined) return { state: 'void', actual: null };
  if (actual === line) return { state: 'push', actual };
  return { state: (actual > line) === (side === 'over') ? 'won' : 'lost', actual };
}

/** Yardage can go back down on a loss of yards, so those legs aren't decided until the game ends. */
const CAN_FALL = new Set<PropMarket>(['pass_yds', 'rush_yds', 'rec_yds', 'pass_rush_yds', 'rush_rec_yds']);

/** Mid-game: a count past the line has decided the leg (the over has hit, the under has lost); anything else is still open. */
export function liveDecision(current: number, line: number, side: 'over' | 'under', market: PropMarket): 'won' | 'lost' | null {
  if (CAN_FALL.has(market) || current <= line) return null;
  return side === 'over' ? 'won' : 'lost';
}

/** A parlay loses on any losing leg and wins once every other leg has won; pushed and voided legs drop out. */
export function parlayState(states: LegState[]): LegState {
  if (states.includes('lost')) return 'lost';
  if (states.includes('pending')) return 'pending';
  return states.includes('won') ? 'won' : 'void';
}
