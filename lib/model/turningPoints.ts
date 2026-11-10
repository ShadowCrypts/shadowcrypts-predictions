import type { Play } from '../gamecenter';
import type { LeagueId } from '../leagues';
import { LIVE, liveHomeChance, remainingNow } from './live';

/** A scoring play, the home win chance just before and just after it, and whether the home team scored it. */
export type TurningPoint = Play & { before: number; after: number; homeScored: boolean };

/** "Q3" → 3, "P2" → 2, "OT" → the first period after regulation, "2OT" → the second; null for anything else. */
export function periodNumber(league: LeagueId, label: string) {
  const spec = LIVE[league];
  if (spec.kind !== 'clock') return null;
  const regular = label.match(/^[QP](\d)$/);
  if (regular) return Number(regular[1]);
  if (label === 'OT') return spec.periods + 1;
  const overtime = label.match(/^(\d+)OT$/);
  return overtime ? spec.periods + Number(overtime[1]) : null;
}

/** The home win chance after each scoring play, at its place in the game (0 = the start, 1 = the end of regulation, past 1 in overtime). */
export type PlayPoint = { x: number; homeProb: number; homeScore: number; awayScore: number; label: string; text: string };

/**
 * The win chance through a game, one point per scoring play, from the pregame
 * forecast: what a play-by-play chart draws. Clock sports only; plays it can't
 * place, or whose total score drops (a shootout's tally), are left out.
 */
export function playFlow(league: LeagueId, pregameHomeProb: number, scoring: Play[]): PlayPoint[] {
  const spec = LIVE[league];
  if (spec.kind !== 'clock') return [];
  const regulation = spec.periods * spec.periodMinutes;
  const points: PlayPoint[] = [{ x: 0, homeProb: pregameHomeProb, homeScore: 0, awayScore: 0, label: 'Start', text: 'Pregame forecast' }];
  let total = 0;
  for (const play of scoring) {
    if (play.homeScore === null || play.awayScore === null || play.homeScore + play.awayScore < total) continue;
    const period = periodNumber(league, play.period);
    if (period === null) continue;
    const clock = clockLeft(league, period, play.clock);
    const left = remainingNow(league, { period, clock, outs: null, statusDetail: '' });
    const m = clock.match(/^(\d+):(\d{2})$/) ?? clock.match(/^()(\d+(?:\.\d+)?)$/);
    if (left === null || !m) continue;
    const minutesLeft = Number(m[1] || 0) + Number(m[2]) / 60;
    const elapsed =
      period <= spec.periods
        ? (period - 1) * spec.periodMinutes + (spec.periodMinutes - minutesLeft)
        : regulation + (period - spec.periods - 1) * spec.otMinutes + (spec.otMinutes - minutesLeft);
    total = play.homeScore + play.awayScore;
    points.push({
      x: Math.max(0, elapsed / regulation),
      homeProb: liveHomeChance(league, pregameHomeProb, play.homeScore - play.awayScore, left),
      homeScore: play.homeScore,
      awayScore: play.awayScore,
      label: `${play.period} ${play.clock}`.trim(),
      text: play.text
    });
  }
  return points;
}

/**
 * A play's clock as time left in its period. ESPN's hockey play-by-play
 * counts up (time gone), unlike its scoreboard and the other sports' plays.
 */
export function clockLeft(league: LeagueId, period: number, clock: string) {
  const spec = LIVE[league];
  if (league !== 'nhl' || spec.kind !== 'clock') return clock;
  const m = clock.match(/^(\d+):(\d{2})$/);
  if (!m) return clock;
  const length = (period > spec.periods ? spec.otMinutes : spec.periodMinutes) * 60;
  const left = Math.max(0, length - (Number(m[1]) * 60 + Number(m[2])));
  return `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
}

/**
 * The scoring plays that swung the win chance most, in the order they
 * happened. Each is judged at its own moment: the chance with the score
 * before it against the chance with the score after, the same clock, so
 * time running off between plays isn't counted as the play's doing.
 * Clock sports only (a baseball play log doesn't carry outs).
 */
export function turningPoints(league: LeagueId, pregameHomeProb: number, scoring: Play[], count = 5): TurningPoint[] {
  const spec = LIVE[league];
  if (spec.kind !== 'clock') return [];
  let margin = 0;
  let total = 0;
  const swings: (TurningPoint & { at: number })[] = [];
  scoring.forEach((play, at) => {
    if (play.homeScore === null || play.awayScore === null) return;
    // A total lower than before isn't the game's score: a shootout's own tally, or a correction.
    if (play.homeScore + play.awayScore < total) return;
    total = play.homeScore + play.awayScore;
    const period = periodNumber(league, play.period);
    const left = period === null ? null : remainingNow(league, { period, clock: clockLeft(league, period, play.clock), outs: null, statusDetail: '' });
    const next = play.homeScore - play.awayScore;
    if (left !== null && next !== margin) {
      swings.push({
        ...play,
        at,
        before: liveHomeChance(league, pregameHomeProb, margin, left),
        after: liveHomeChance(league, pregameHomeProb, next, left),
        homeScored: next > margin
      });
    }
    margin = next;
  });
  return swings
    .sort((a, b) => Math.abs(b.after - b.before) - Math.abs(a.after - a.before))
    .slice(0, count)
    .sort((a, b) => a.at - b.at)
    .map(({ at: _, ...p }) => p);
}
