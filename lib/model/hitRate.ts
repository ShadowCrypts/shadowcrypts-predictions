/**
 * How often a player cleared a line in his last `games` games that logged the
 * stat (newest first). A game landing exactly on a whole-number line is a
 * push, which counts neither way, as at the book. Null when there's no game.
 */
export function hitRate(values: (number | undefined)[], line: number, games: number): { hits: number; n: number; marks: boolean[] } | null {
  const marks: boolean[] = [];
  for (const v of values) {
    if (marks.length >= games) break;
    if (v === undefined || v === line) continue;
    marks.push(v > line);
  }
  return marks.length ? { hits: marks.filter(Boolean).length, n: marks.length, marks } : null;
}
