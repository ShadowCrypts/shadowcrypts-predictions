import type { Game } from '../espn';
import type { LeagueId } from '../leagues';

// In-game win probability. The pregame forecast fixes how many points the home
// team was expected to win by over a full game; whatever is left of the game
// adds a normally distributed margin scaled to the time remaining. So early on
// the forecast dominates, and late the scoreboard does. Each league's sigma was
// fitted on the first graded season's period-by-period scores and checked on the
// later ones, where it beat both the score alone and the pregame forecast alone
// at every checkpoint.

type ClockSpec = { kind: 'clock'; periods: number; periodMinutes: number; otMinutes: number; periodName: string };
type InningSpec = { kind: 'innings'; innings: number };
type LiveSpec = (ClockSpec | InningSpec) & { sigma: number };

export const LIVE: Record<LeagueId, LiveSpec> = {
  nba: { kind: 'clock', periods: 4, periodMinutes: 12, otMinutes: 5, periodName: 'Q', sigma: 19.2 },
  nfl: { kind: 'clock', periods: 4, periodMinutes: 15, otMinutes: 10, periodName: 'Q', sigma: 15.9 },
  nhl: { kind: 'clock', periods: 3, periodMinutes: 20, otMinutes: 5, periodName: 'P', sigma: 2.74 },
  mlb: { kind: 'innings', innings: 9, sigma: 3.95 }
};

/** Standard normal CDF (Abramowitz and Stegun 7.1.26, error under 1.5e-7). */
export function normalCdf(x: number) {
  const t = 1 / (1 + 0.3275911 * (Math.abs(x) / Math.SQRT2));
  const poly = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  const erf = 1 - poly * Math.exp(-(x * x) / 2);
  return x >= 0 ? (1 + erf) / 2 : (1 - erf) / 2;
}

/** Inverse standard normal CDF (Acklam's rational approximation). */
export function normalQuantile(p: number) {
  const q = Math.min(1 - 1e-9, Math.max(1e-9, p));
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const low = 0.02425;
  if (q < low) {
    const r = Math.sqrt(-2 * Math.log(q));
    return (((((c[0] * r + c[1]) * r + c[2]) * r + c[3]) * r + c[4]) * r + c[5]) / ((((d[0] * r + d[1]) * r + d[2]) * r + d[3]) * r + 1);
  }
  if (q > 1 - low) {
    const r = Math.sqrt(-2 * Math.log(1 - q));
    return -(((((c[0] * r + c[1]) * r + c[2]) * r + c[3]) * r + c[4]) * r + c[5]) / ((((d[0] * r + d[1]) * r + d[2]) * r + d[3]) * r + 1);
  }
  const r = q - 0.5;
  const s = r * r;
  return ((((((a[0] * s + a[1]) * s + a[2]) * s + a[3]) * s + a[4]) * s + a[5]) * r) / (((((b[0] * s + b[1]) * s + b[2]) * s + b[3]) * s + b[4]) * s + 1);
}

/**
 * Home win probability with `margin` (home minus away) and `remaining` of the
 * game left (1 = full game). A tie with nothing left goes to overtime, where
 * the pregame edge plays out over the extra time.
 */
export function liveProbability(pregameHomeProb: number, margin: number, remaining: number, sigma: number, overtime: number) {
  const z = normalQuantile(pregameHomeProb);
  if (remaining <= 1e-6) {
    if (margin !== 0) return margin > 0 ? 1 : 0;
    return normalCdf(z * Math.sqrt(overtime));
  }
  return normalCdf((margin / sigma + z * remaining) / Math.sqrt(remaining));
}

/** "5:23" or "45.2" (seconds) to minutes. */
export function clockMinutes(clock: string | null | undefined) {
  if (!clock) return null;
  if (clock.includes(':')) {
    const [m, s] = clock.split(':').map(Number);
    return Number.isFinite(m) && Number.isFinite(s) ? m + s / 60 : null;
  }
  const s = Number(clock);
  return Number.isFinite(s) ? s / 60 : null;
}

const overtimeShare = (spec: LiveSpec) =>
  spec.kind === 'clock' ? spec.otMinutes / (spec.periods * spec.periodMinutes) : 1 / spec.innings;

/** Share of regulation still to play right now, or null if the feed doesn't say. */
export function remainingNow(league: LeagueId, game: Pick<Game, 'period' | 'clock' | 'outs' | 'statusDetail'>) {
  const spec = LIVE[league];
  if (spec.kind === 'clock') {
    const minutes = clockMinutes(game.clock);
    if (!game.period || minutes === null) return null;
    const total = spec.periods * spec.periodMinutes;
    const left = game.period <= spec.periods ? (spec.periods - game.period) * spec.periodMinutes + minutes : minutes;
    return Math.max(0, Math.min(1, left / total));
  }
  const match = game.statusDetail.match(/^(Top|Bot|Mid|End)\w*\s+(\d+)/i);
  if (!match) return null;
  const inning = Number(match[2]);
  const outs = Math.min(3, game.outs ?? 0) / 3;
  const half = match[1].toLowerCase();
  const done = half === 'top' ? 2 * (inning - 1) + outs : half === 'mid' ? 2 * inning - 1 : half === 'bot' ? 2 * inning - 1 + outs : 2 * inning;
  const halves = 2 * spec.innings;
  // Extra innings: about one inning left at a time.
  return done >= halves ? Math.max(0.25, 2 * inning - done) / halves : (halves - done) / halves;
}

export type FlowPoint = { label: string; homeProb: number; homeScore: number; awayScore: number };

/**
 * Win probability after each completed period (and right now, if live),
 * starting from the pregame forecast.
 */
export function gameFlow(league: LeagueId, game: Game, pregameHomeProb: number): FlowPoint[] {
  const spec = LIVE[league];
  const points: FlowPoint[] = [{ label: 'Start', homeProb: pregameHomeProb, homeScore: 0, awayScore: 0 }];
  const home = game.home.periods;
  const away = game.away.periods;
  const played = Math.min(home.length, away.length);
  const regulation = spec.kind === 'clock' ? spec.periods : spec.innings;
  let h = 0;
  let a = 0;
  // A live game's latest period is still in progress, so only earlier ones are checkpoints.
  const complete = game.state === 'in' ? played - 1 : played;
  for (let k = 0; k < complete; k += 1) {
    h += home[k];
    a += away[k];
    const isLast = game.state === 'post' && k === played - 1;
    if (isLast) break;
    const left = k + 1 < regulation ? (regulation - k - 1) / regulation : 0;
    const label = spec.kind === 'clock' ? (k < spec.periods ? `${spec.periodName}${k + 1}` : 'OT') : `${k + 1}`;
    points.push({ label, homeProb: liveProbability(pregameHomeProb, h - a, left, spec.sigma, overtimeShare(spec)), homeScore: h, awayScore: a });
  }
  if (game.state === 'in') {
    const left = remainingNow(league, game);
    const hs = game.home.score ?? h;
    const as = game.away.score ?? a;
    if (left !== null) points.push({ label: 'Now', homeProb: liveProbability(pregameHomeProb, hs - as, left, spec.sigma, overtimeShare(spec)), homeScore: hs, awayScore: as });
  }
  if (game.completed && game.home.score !== null && game.away.score !== null) {
    const margin = game.home.score - game.away.score;
    points.push({ label: 'Final', homeProb: margin > 0 ? 1 : margin < 0 ? 0 : 0.5, homeScore: game.home.score, awayScore: game.away.score });
  }
  return points;
}

/** Home win probability with `margin` (home minus away) and `remaining` of regulation left, in a league's own terms. */
export function liveHomeChance(league: LeagueId, pregameHomeProb: number, margin: number, remaining: number) {
  const spec = LIVE[league];
  return liveProbability(pregameHomeProb, margin, remaining, spec.sigma, overtimeShare(spec));
}

/** The current in-game probability, or null when the game isn't live or the clock is unknown. */
export function liveNow(league: LeagueId, game: Game, pregameHomeProb: number) {
  if (game.state !== 'in' || game.home.score === null || game.away.score === null) return null;
  const left = remainingNow(league, game);
  if (left === null) return null;
  const spec = LIVE[league];
  return { homeProb: liveProbability(pregameHomeProb, game.home.score - game.away.score, left, spec.sigma, overtimeShare(spec)), remaining: left };
}
