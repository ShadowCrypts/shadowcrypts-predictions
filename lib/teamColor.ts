// Team colors as the site draws them: bars, glows and accents behind team
// logos. A team's own color is used when it shows up on both themes; very
// dark or very light ones fall back to the team's alternate color, then to a
// lightened or darkened version, and two teams in one game are kept apart.

/** The brand accent, for a team with no color on file. */
export const NEUTRAL = '#7c3aed';

const parse = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const valid = (c: string | null | undefined): c is string => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c);
const toHex = (rgb: number[]) => `#${rgb.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('')}`;

/** WCAG relative luminance of a #rrggbb color, 0 (black) to 1 (white). */
export function luminance(hex: string) {
  const [r, g, b] = parse(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Mixes a color toward white (amount > 0) or black (amount < 0). */
export function mix(hex: string, amount: number) {
  const target = amount > 0 ? 255 : 0;
  return toHex(parse(hex).map((v) => v + (target - v) * Math.abs(amount)));
}

/** Bright enough to see on the dark background, dark enough to see on the light one (golds and yellows pass; white doesn't). */
const MIN_LUM = 0.045;
const MAX_LUM = 0.7;
const usable = (c: string) => {
  const l = luminance(c);
  return l >= MIN_LUM && l <= MAX_LUM;
};

/** A team's color for drawing: its own, else its alternate, else its own lightened or darkened into range. */
export function displayColor(primary?: string | null, alternate?: string | null) {
  const options = [primary, alternate].filter(valid);
  const good = options.find(usable);
  if (good) return good;
  const base = options[0];
  if (!base) return NEUTRAL;
  let c = base;
  for (let i = 0; i < 8 && !usable(c); i += 1) c = mix(c, luminance(c) < MIN_LUM ? 0.18 : -0.15);
  return c;
}

/** How far apart two colors are (0 to about 442). */
export function distance(a: string, b: string) {
  const [x, y] = [parse(a), parse(b)];
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
}

/** Two teams' colors for one game, told apart: when they're too alike, the home side takes its alternate, or a lighter shade of its own. */
export function matchupColors(away: { color?: string | null; altColor?: string | null }, home: { color?: string | null; altColor?: string | null }) {
  const a = displayColor(away.color, away.altColor);
  let h = displayColor(home.color, home.altColor);
  if (distance(a, h) < 90) {
    const alt = valid(home.altColor) && usable(home.altColor) && distance(a, home.altColor) >= 90 ? home.altColor : null;
    h = alt ?? mix(h, luminance(h) < 0.25 ? 0.45 : -0.4);
  }
  return { away: a, home: h };
}
