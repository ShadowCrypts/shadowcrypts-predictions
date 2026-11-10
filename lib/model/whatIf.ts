// "What if": how every other line in a game moves once one thing happens, from
// the same correlations the parlay chances use. Pure, so it runs in the browser
// and is tested.

import { allHitChance, CorrelationTable, LegLink } from './correlation';

/** Something that can happen in a game, with its chance: a player's over, or a team winning. */
export type Outcome = { key: string; label: string; prob: number; link: LegLink };
export type Shift = { key: string; label: string; before: number; after: number };

/**
 * Each other outcome's chance once `given` has happened: P(B | A) = P(A and B)
 * / P(A), the joint chance from the same Gaussian copula as same-game
 * parlays. Biggest moves first. The other team winning is left out (it
 * simply can't happen), and outcomes the table says nothing about don't move.
 */
export function shiftsGiven(league: string, gameId: string, given: Outcome, others: Outcome[], tables: Partial<Record<string, CorrelationTable>>): Shift[] {
  if (!(given.prob > 0)) return [];
  return others
    .filter((o) => o.key !== given.key && !(o.link.kind === 'win' && given.link.kind === 'win'))
    .map((o) => {
      const joint = allHitChance(
        [
          { league, gameId, prob: given.prob, link: given.link },
          { league, gameId, prob: o.prob, link: o.link }
        ],
        tables
      );
      return { key: o.key, label: o.label, before: o.prob, after: Math.min(1, Math.max(0, joint / given.prob)) };
    })
    .sort((a, b) => Math.abs(b.after - b.before) - Math.abs(a.after - a.before) || a.label.localeCompare(b.label));
}
