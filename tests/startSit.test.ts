import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { FANTASY_RANGE, fantasyPoints, type FantasyLine } from '../lib/model/fantasy';
import type { FantasyRow } from '../lib/model/fantasyBoard';
import { gradeStartSit, meaningfulGap, nflWeekNumber, pickStartSit, type StartSitCandidate } from '../lib/model/startSit';
import { fantasyCard, type StartSitWeek } from '../lib/model/startSitWeek';

describe('a player page’s fantasy box', () => {
  // QBs whose lines score exactly `points` PPR (a 25-yard pass is a point).
  const line = (points: number): FantasyLine => ({ passYds: points * 25, passTd: 0, passInt: 0, rushYds: 0, recYds: 0, rec: 0, tds: 0 });
  const row = (id: string, projected: number, average: number | null, available = 1): FantasyRow => ({
    id,
    name: id,
    position: 'QB',
    team: { id: '1', abbr: 'AAA', logo: null, color: '#000' },
    opponent: 'BBB',
    home: true,
    gameId: 'g',
    start: '2026-11-19T01:15:00Z',
    available,
    status: null,
    projected: line(projected),
    recent: average === null ? null : line(average),
    season: average === null ? null : line(average),
    games: average === null ? 0 : 9
  });
  const rows = [row('a', 22, 20), row('b', 18, 21), row('c', 16, 12), row('d', 25, 24, 0.5)];
  const week = { week: 11, rows, picks: { QB: { start: [{ id: 'c' }], sit: [] }, RB: { start: [], sit: [] }, WR: { start: [], sit: [] }, TE: { start: [], sit: [] } } } as unknown as StartSitWeek;

  it('ranks him at his position this week by expected points, and by season average', () => {
    const card = fantasyCard(week, 'a')!;
    assert.equal(card.points, 22);
    assert.equal(card.weekRank, 1, 'd projects higher but is only 50% to play: 12.5 expected');
    assert.equal(card.seasonRank, 3);
    assert.deepEqual(
      card.range.map((x) => Number(x.toFixed(2))),
      FANTASY_RANGE.QB.map((f) => Number((22 * f).toFixed(2)))
    );
    assert.equal(fantasyPoints(card.row.projected), 22);
  });

  it('says which list he’s on, or neither', () => {
    assert.equal(fantasyCard(week, 'c')!.verdict, 'start');
    assert.equal(fantasyCard(week, 'b')!.verdict, null);
    assert.equal(fantasyCard(week, 'nobody'), null);
  });
});

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
