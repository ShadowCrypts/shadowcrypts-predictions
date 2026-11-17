import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { gradeStartSit, meaningfulGap, nflWeekNumber, pickStartSit, type StartSitCandidate } from '../lib/model/startSit';

// 40 backs with season averages from 25 down to 5.5, all projected at their average unless set otherwise.
const backs = (overrides: Record<number, Partial<StartSitCandidate>> = {}): StartSitCandidate[] =>
  Array.from({ length: 40 }, (_, i) => ({ id: `rb${i + 1}`, position: 'RB' as const, average: 25 - i * 0.5, points: 25 - i * 0.5, available: 1, games: 8, ...overrides[i + 1] }));

describe('start or sit', () => {
  it('starts a fringe player projected well above his average, not a stud or a deep bench player', () => {
    const picks = pickStartSit(
      backs({
        2: { points: 30 }, // a stud: he starts anyway, not news
        20: { points: 20 }, // rank 20, average 15.5: projected 4.5 more, and his start is a real question
        40: { points: 12 } // rank 40 is in range, average 5.5, projected 6.5 more
      })
    );
    assert.deepEqual(
      picks.RB.start.map((p) => p.id),
      ['rb40', 'rb20']
    );
    assert.equal(picks.RB.start[1].rank, 20);
  });

  it('sits a regular starter projected well below his average, unless he might not play at all, and never a stud', () => {
    const picks = pickStartSit(backs({ 10: { points: 12 }, 12: { points: 13, available: 0.5 }, 3: { points: 10 } }));
    assert.deepEqual(
      picks.RB.sit.map((p) => p.id),
      ['rb10']
    );
  });

  it('never makes a start of a player on the injury report', () => {
    const picks = pickStartSit(backs({ 20: { points: 22, status: 'Questionable' }, 21: { points: 21 } }));
    assert.deepEqual(
      picks.RB.start.map((p) => p.id),
      ['rb21']
    );
  });

  it('ignores small gaps, and players with fewer than three games', () => {
    assert.equal(meaningfulGap(10), 2);
    assert.equal(meaningfulGap(20), 3);
    const picks = pickStartSit(backs({ 20: { points: 17 }, 25: { points: 30, games: 2 } }));
    assert.deepEqual(picks.RB.start, []);
  });

  it('grades calls by what they claimed: starts beat their average, sits fell short', () => {
    const picks = pickStartSit(backs({ 20: { points: 20 }, 22: { points: 20 }, 10: { points: 12 }, 11: { points: 13 } }));
    const actual: Record<string, number | null> = { rb20: 19, rb22: null, rb10: 9, rb11: null };
    const grade = gradeStartSit(picks, (id) => actual[id] ?? null);
    assert.deepEqual(grade, { starts: 2, startsBeat: 1, sits: 1, sitsShort: 1, sat: 1 });
  });

  it('numbers the season’s weeks from the first', () => {
    const dates = ['2026-09-11T00:20:00Z', '2026-09-14T17:00:00Z', '2026-09-18T00:15:00Z', '2026-09-21T17:00:00Z', '2026-09-23T00:15:00Z'];
    assert.equal(nflWeekNumber(dates, '2026-09-22T10:00:00.000Z'), 2);
    assert.equal(nflWeekNumber(dates, '2026-09-15T10:00:00.000Z'), 1);
    assert.equal(nflWeekNumber(dates, '2027-01-01T10:00:00.000Z'), null);
  });
});
