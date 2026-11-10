// Parlay math: every leg has to win. Legs from different games are independent,
// so their chances multiply; legs from one game move together, so their joint
// chance comes from how such legs have moved together in past games.

import { isLeagueId, propParams } from './leagues';
import { GradableLeg, LegResult, legId, LegState, liveDecision, parlayState, parseLegId, propResult } from './legs';
import { allHitChance, CorrelatedLeg, CorrelationTable } from './model/correlation';
import { CORRELATIONS } from './model/correlationTable';
import { liveHomeChance } from './model/live';
import { liveOverChance } from './model/liveProps';
import { fairAmerican } from './model/market';
import type { SweatGame } from './model/sweat';

export const decimalFromAmerican = (american: number) => (american > 0 ? 1 + american / 100 : 1 + 100 / -american);
export const americanFromDecimal = (decimal: number) => (decimal >= 2 ? Math.round((decimal - 1) * 100) : Math.round(-100 / (decimal - 1)));
/** A real American price: +100 or longer, or −100 or shorter. */
export const isAmerican = (n: number) => Number.isFinite(n) && Math.abs(n) >= 100;

export type ParlayInput = CorrelatedLeg & { price: number | null };

export type ParlaySummary = {
  legs: number;
  /** Chance every leg wins, with legs from one game moving together the way such legs have in past games. */
  chance: number;
  /** What multiplying the chances gives, as if every leg were independent. */
  independent: number;
  /** American odds that would be a fair bet at that chance. */
  fair: number;
  /** Some legs share a game: books price those parlays themselves, so the multiplied price isn't what they pay. */
  sameGame: boolean;
  /** Each leg's price multiplied (null if any leg has no price): what a book pays when every leg is from a different game. */
  multiplied: { decimal: number; american: number } | null;
  /** The price the return is figured at: the one you were offered, else the multiplied one when that's what the book pays. */
  price: number | null;
  /** Average profit per 1 unit staked at that price: chance × decimal − 1. */
  expectedReturn: number | null;
};

export function summarize(
  legs: ParlayInput[],
  offered: number | null = null,
  tables: Partial<Record<string, CorrelationTable>> = CORRELATIONS
): ParlaySummary | null {
  if (!legs.length) return null;
  const independent = legs.reduce((p, l) => p * l.prob, 1);
  const chance = allHitChance(legs, tables);
  const sameGame = new Set(legs.map((l) => `${l.league}:${l.gameId}`)).size < legs.length;
  const decimal = legs.every((l) => l.price !== null) ? legs.reduce((d, l) => d * decimalFromAmerican(l.price!), 1) : null;
  const priceDecimal = offered !== null ? decimalFromAmerican(offered) : decimal && !sameGame ? decimal : null;
  return {
    legs: legs.length,
    chance,
    independent,
    fair: fairAmerican(chance),
    sameGame,
    multiplied: decimal ? { decimal, american: americanFromDecimal(decimal) } : null,
    price: priceDecimal ? (offered ?? americanFromDecimal(priceDecimal)) : null,
    expectedReturn: priceDecimal ? chance * priceDecimal - 1 : null
  };
}

type LiveLeg = ParlayInput & { key: string; line?: number };

/**
 * A leg's chance to hit right now, from its result so far: undefined before
 * its game (or the player) starts, so the pregame chance stands; null when it
 * can't be told (a league without a live prop model).
 */
export function liveLegChance(leg: LiveLeg, result: LegResult | undefined): number | null | undefined {
  const live = result?.live;
  if (!live) return undefined;
  if (live.decided) return live.decided === 'won' ? 1 : 0;
  const link = leg.link;
  if (link?.kind === 'win') return live.chance;
  if (link?.kind !== 'prop' || leg.line === undefined) return null;
  if (result.actual === null) return undefined;
  const base = propParams(leg.league);
  if (!base?.live || live.played === null || live.played === undefined) return null;
  const pregameOver = link.side === 'over' ? leg.prob : 1 - leg.prob;
  const over = liveOverChance(base, base.live, link.market, leg.line, pregameOver, { current: result.actual, played: live.played, lead: live.lead ?? 0, edge: live.edge });
  return link.side === 'over' ? over : 1 - over;
}

/**
 * A tracked parlay's chance to cash right now: graded legs count as hit or
 * missed (pushes and voids drop out), legs in games underway use their live
 * chance and the rest their pregame one, combined through the same-game
 * correlations. Null when an open leg's live chance can't be told.
 */
export function liveParlayChance(
  legs: LiveLeg[],
  final: Record<string, LegState | undefined>,
  now: Record<string, LegResult | undefined>,
  tables: Partial<Record<string, CorrelationTable>> = CORRELATIONS
) {
  const open: ParlayInput[] = [];
  for (const leg of legs) {
    const state = final[leg.key];
    if (state === 'lost') return 0;
    if (state) continue;
    const chance = liveLegChance(leg, now[leg.key]);
    if (chance === null) return null;
    if (chance === 0) return 0;
    if (chance === 1) continue;
    open.push({ ...leg, prob: chance ?? leg.prob });
  }
  return open.length ? allHitChance(open, tables) : 1;
}

/** Legs a shared link can carry: plenty for any real parlay, and a cap on what one request asks the server to price. */
export const MAX_SHARED_LEGS = 12;

/**
 * A parlay as a link: its legs' ids (what the server prices them from) and
 * the price it was offered, "@700,p~nba~…,w~nba~…". Only characters a URL path
 * allows as they are. Null when no leg carries what an id needs.
 */
export function shareCode(legs: GradableLeg[], price: number | null) {
  const ids = [...new Set(legs.map((l) => legId(l)).filter((id): id is string => id !== null))].slice(0, MAX_SHARED_LEGS);
  if (!ids.length) return null;
  return [...(price !== null && isAmerican(price) ? [`@${price}`] : []), ...ids].join(',');
}

/** The ids and price back out of a link, keeping only well-formed legs. */
export function readShareCode(code: string): { ids: string[]; price: number | null } {
  let text = code;
  try {
    text = decodeURIComponent(code);
  } catch {
    // A stray % stays as is; nothing that follows will parse.
  }
  const parts = text
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  let price: number | null = null;
  if (parts[0]?.startsWith('@')) {
    const n = Number(parts.shift()!.slice(1));
    price = isAmerican(n) ? n : null;
  }
  return { ids: [...new Set(parts.filter((p) => parseLegId(p) !== null))].slice(0, MAX_SHARED_LEGS), price };
}

export type SweatPoint = {
  t: number;
  /** Chance to cash then; null when a leg's live chance couldn't be told. */
  chance: number | null;
  /** Each leg's own chance then: pregame before its game, live during it, 1 or 0 once decided, null once pushed or voided. */
  legs: (number | null)[];
};

/**
 * A tracked parlay's chance to cash replayed through its games, at every
 * moment one of them moved: legs in games not started yet at their pregame
 * chance, legs under way from the play-by-play so far, legs in finished games
 * as graded (or from the final play when not graded yet). Combined the way
 * the chance to cash now is. `games` is keyed by game id.
 */
export function sweatTrail(
  legs: LiveLeg[],
  final: Record<string, LegState | undefined>,
  games: Record<string, SweatGame>,
  tables: Partial<Record<string, CorrelationTable>> = CORRELATIONS
): SweatPoint[] {
  const times = [...new Set(Object.values(games).flatMap((g) => g.t))].sort((a, b) => a - b);
  const cursor = new Map(Object.keys(games).map((id) => [id, -1]));
  const ids = legs.map((l) => legId(l));
  const points: SweatPoint[] = [];
  for (const t of times) {
    for (const [id, g] of Object.entries(games)) {
      let i = cursor.get(id)!;
      while (i + 1 < g.t.length && g.t[i + 1] <= t) i += 1;
      cursor.set(id, i);
    }
    const states: Record<string, LegState | undefined> = {};
    const now: Record<string, LegResult | undefined> = {};
    legs.forEach((leg, k) => {
      const graded = final[leg.key];
      const g = games[leg.gameId];
      const i = g && g.league === leg.league ? cursor.get(leg.gameId)! : -1;
      if (graded === 'push' || graded === 'void') states[leg.key] = graded;
      if (graded === 'push' || graded === 'void' || i < 0 || !isLeagueId(g.league)) return;
      const link = leg.link;
      const played = g.played[i];
      const margin = g.margin[i];
      const stat = ids[k] ? g.stats[ids[k]!]?.[i] : undefined;
      if (g.final && i === g.t.length - 1) {
        // Over: as graded, else from the last play.
        if (graded) states[leg.key] = graded;
        else if (link?.kind === 'win') states[leg.key] = margin === 0 ? 'push' : (margin > 0) === (link.teamId === g.home) ? 'won' : 'lost';
        else if (link?.kind === 'prop' && stat !== undefined && leg.line !== undefined) states[leg.key] = propResult(stat, leg.line, link.side).state;
        return;
      }
      if (link?.kind === 'win') {
        const home = link.teamId === g.home;
        const p = liveHomeChance(g.league, home ? leg.prob : 1 - leg.prob, margin, 1 - played);
        now[leg.key] = { state: 'pending', actual: null, live: { status: '', decided: null, chance: home ? p : 1 - p } };
      } else if (link?.kind === 'prop' && stat !== undefined && leg.line !== undefined) {
        now[leg.key] = {
          state: 'pending',
          actual: stat,
          live: { status: '', decided: liveDecision(stat, leg.line, link.side, link.market), chance: null, played, lead: Math.abs(margin), edge: link.teamId === g.home ? margin : -margin }
        };
      }
    });
    points.push({
      t,
      chance: liveParlayChance(legs, states, now, tables),
      legs: legs.map((leg) => {
        const s = states[leg.key];
        if (s === 'push' || s === 'void') return null;
        if (s) return s === 'won' ? 1 : 0;
        const live = liveLegChance(leg, now[leg.key]);
        return live === undefined ? leg.prob : live;
      })
    });
  }
  return points;
}

/**
 * A saved parlay's result, with profit per unit staked at its saved price.
 * A pushed or voided leg drops out and the price shrinks; that's figured from
 * the remaining legs' own prices, and left unknown when one has none.
 */
export function settle(legs: { key: string; price: number | null }[], price: number | null, results: Record<string, LegState | undefined>) {
  const states = legs.map((l) => results[l.key] ?? 'pending');
  const state = parlayState(states);
  if (price === null || state === 'pending') return { state, profit: null };
  if (state === 'lost') return { state, profit: -1 };
  if (state === 'void') return { state, profit: 0 };
  if (states.every((s) => s === 'won')) return { state, profit: decimalFromAmerican(price) - 1 };
  const kept = legs.filter((_, i) => states[i] === 'won');
  if (kept.some((l) => l.price === null)) return { state, profit: null };
  return { state, profit: kept.reduce((d, l) => d * decimalFromAmerican(l.price!), 1) - 1 };
}
