/** A pick'em record and the model's on the same games, as a share link carries it. */
export type PicksScore = { yours: { won: number; lost: number }; model: { won: number; lost: number } };

const MAX = 9999;

/** "12-8-11-9": your wins and losses, then the model's. */
export const picksShareCode = (s: PicksScore) => `${s.yours.won}-${s.yours.lost}-${s.model.won}-${s.model.lost}`;

/** A share code read back, or null if it isn't one: four whole numbers, both records over the same number of games. */
export function readPicksShare(code: string): PicksScore | null {
  const parts = code.split('-');
  if (parts.length !== 4 || !parts.every((p) => /^\d{1,4}$/.test(p))) return null;
  const [yw, yl, mw, ml] = parts.map(Number);
  if (yw + yl === 0 || yw + yl !== mw + ml || yw + yl > MAX) return null;
  return { yours: { won: yw, lost: yl }, model: { won: mw, lost: ml } };
}
