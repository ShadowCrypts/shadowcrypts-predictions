export function pct(value: number, digits = 0) {
  return `${(value * 100).toFixed(digits)}%`;
}

/** Like pct, but a chance that isn't settled never reads as 0% or 100%. */
export function pctCapped(value: number) {
  if (value > 0.99 && value < 1) return '>99%';
  if (value < 0.01 && value > 0) return '<1%';
  return pct(value);
}

/** A game's status as a ticker shows it: "7:12 - 3rd Quarter" → "7:12 Q3", "End of 2nd Period" → "End P2", "Halftime" → "Half". */
export function shortStatus(detail: string) {
  const ord = (n: string) => n.replace(/(st|nd|rd|th)$/i, '');
  return detail
    .replace(/^Halftime$/i, 'Half')
    .replace(/^End of (\d+\w*) Quarter$/i, (_, n) => `End Q${ord(n)}`)
    .replace(/^End of (\d+\w*) Period$/i, (_, n) => `End P${ord(n)}`)
    .replace(/ - (\d+\w*) Quarter$/i, (_, n) => ` Q${ord(n)}`)
    .replace(/ - (\d+\w*) Period$/i, (_, n) => ` P${ord(n)}`)
    .replace(/ - OT$/i, ' OT')
    .replace(/^Final\/OT$/i, 'Final OT');
}

export function signed(value: number, digits = 0) {
  const rounded = Number(value.toFixed(digits));
  if (rounded === 0) return (0).toFixed(digits);
  return `${rounded > 0 ? '+' : '−'}${Math.abs(rounded).toFixed(digits)}`;
}

/** 1st, 2nd, 3rd, 4th … 11th, 12th, 13th … 21st. */
export function ordinal(n: number) {
  const suffix = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${suffix[(v - 20) % 10] ?? suffix[v] ?? suffix[0]}`;
}

/** "JAX -2.5" from a home-side spread. */
export function spreadLabel(homeAbbr: string, awayAbbr: string, homeSpread: number | null) {
  if (homeSpread === null) return '—';
  if (homeSpread === 0) return 'Pick ’em';
  return homeSpread < 0 ? `${homeAbbr} ${homeSpread}` : `${awayAbbr} -${homeSpread}`;
}

export function compactNumber(value: number) {
  return new Intl.NumberFormat('en-US', { notation: value >= 10_000 ? 'compact' : 'standard', maximumFractionDigits: 1 }).format(value);
}
