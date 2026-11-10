// Live prop chances: where a player's stat ends up from where it is now. The
// pregame line and its chance fix his expected total (read as a whole
// distribution, as for any line); the rest of the game adds the part still to
// come, scaled by how much is left, nudged by a hot or cold start, and cut
// when the game is lopsided enough that starters sit; in football it also
// leans with the score, since a team behind throws and a team ahead runs.
// Fitted per league at each quarter or period break on how past games
// unfolded. Safe in the browser.

import type { PropMarket } from '../props';
import { impliedMean, lineChances, marketVariance, PropModelParams } from './propModel';

export type LivePropParams = {
  /** Share of the game done at each checkpoint: quarter or period breaks. */
  checkpoints: number[];
  /** At each checkpoint, multiplier on the pregame mean for the part still to come. */
  pace: number[];
  /** Share of a hot or cold start (the stat so far against what was expected by now) that carries into the rest. */
  carry: number[];
  /** Spread of the part still to come, as a multiple of the market's usual spread for that mean. */
  spread: number[];
  /** Cut to the part still to come for each `blowoutPer` of lead past `blowoutFrom`. */
  blowout: number[];
  blowoutFrom: number;
  blowoutPer: number;
  /**
   * Football's game script: the part still to come leans this much per
   * `blowoutPer` the player's team trails (up to two), toward passing and
   * catching, and away from running; the other way when it leads.
   */
  script?: number[];
};

type Point = { pace: number; carry: number; spread: number; blowout: number; script: number };

/** Which way game script pushes a market: up for throwing and catching when behind, down for running. */
const SCRIPT_SIGN: Partial<Record<PropMarket, number>> = { pass_yds: 1, pass_cmp: 1, pass_att: 1, pass_rush_yds: 1, rec: 1, rec_yds: 1, rush_att: -1, rush_yds: -1 };

/** The settings at `played` (0 to 1): pregame at the start, straight lines between checkpoints, the last one after. */
function settingsAt(live: LivePropParams, played: number): Point {
  const points = [
    { at: 0, pace: 1, carry: 0, spread: 1, blowout: 0, script: 0 },
    ...live.checkpoints.map((at, i) => ({ at, pace: live.pace[i], carry: live.carry[i], spread: live.spread[i], blowout: live.blowout[i], script: live.script?.[i] ?? 0 }))
  ];
  const next = points.findIndex((p) => p.at >= played);
  if (next === -1) return points.at(-1)!;
  if (next === 0) return points[0];
  const a = points[next - 1];
  const b = points[next];
  const w = (played - a.at) / Math.max(1e-9, b.at - a.at);
  const mix = (x: number, y: number) => x + (y - x) * w;
  return { pace: mix(a.pace, b.pace), carry: mix(a.carry, b.carry), spread: mix(a.spread, b.spread), blowout: mix(a.blowout, b.blowout), script: mix(a.script, b.script) };
}

export type LiveState = {
  /** The stat so far. */
  current: number;
  /** Share of regulation played, 0 to 1. */
  played: number;
  /** Size of the lead, either way. */
  lead: number;
  /** The player's team's lead, below zero when behind; only game script reads it. */
  edge?: number | null;
};

/**
 * Chance the over at `line` hits, with `pregameOver` its chance before the
 * game (pushes left out). Past the line already means it has hit.
 */
export function liveOverChance(
  base: Pick<PropModelParams, 'dispersion' | 'lineSpread'>,
  live: LivePropParams,
  market: PropMarket,
  line: number,
  pregameOver: number,
  state: LiveState
) {
  if (state.current > line) return 1;
  const left = 1 - Math.min(1, Math.max(0, state.played));
  if (left <= 1e-6) return 0;
  const scale = base.lineSpread?.[market] ?? 1;
  const mean = impliedMean(base, market, line, pregameOver, scale);
  return overFromMean(base, live, market, line, mean, state);
}

/** The same, from the pregame mean itself (the backtest has it already). */
export function overFromMean(base: Pick<PropModelParams, 'dispersion' | 'lineSpread'>, live: LivePropParams, market: PropMarket, line: number, mean: number, state: LiveState) {
  if (state.current > line) return 1;
  const played = Math.min(1, Math.max(0, state.played));
  const left = 1 - played;
  if (left <= 1e-6) return 0;
  const at = settingsAt(live, played);
  // A small cushion keeps one early bucket from reading as a huge pace.
  const cushion = Math.max(0.5, mean * 0.1);
  const ratio = Math.min(4, Math.max(0.25, (state.current + cushion) / (mean * played + cushion)));
  const lopsided = Math.max(0, state.lead - live.blowoutFrom) / live.blowoutPer;
  const behind = Math.min(2, Math.max(-2, -(state.edge ?? 0) / live.blowoutPer));
  const script = Math.max(0.2, 1 + at.script * (SCRIPT_SIGN[market] ?? 0) * behind);
  const rest = Math.max(0.01, mean * left * at.pace * (1 + at.carry * (ratio - 1)) * Math.max(0.2, 1 - at.blowout * lopsided) * script);
  const variance = Math.max(rest * 1.0001, marketVariance(base, market, rest) * (base.lineSpread?.[market] ?? 1) * at.spread);
  const { over, under } = lineChances(rest, variance, line - state.current);
  return over + under > 0 ? over / (over + under) : 0.5;
}
