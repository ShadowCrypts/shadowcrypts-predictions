import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { BoxScore, NflSkillBox } from '../lib/boxscores';
import { actualLines, averageLine, fantasyCompareRows, fantasyPoints, fantasyPosition, projectedLine, projectedPoints, rankCorrelation, startSit, weekEnd } from '../lib/model/fantasy';

const line = (o: Partial<Parameters<typeof fantasyPoints>[0]> = {}) => ({ passYds: 0, passTd: 0, passInt: 0, rushYds: 0, recYds: 0, rec: 0, tds: 0, ...o });

describe('fantasy scoring', () => {
  it('scores the standard way in each format', () => {
    const qb = line({ passYds: 300, passTd: 2, passInt: 1, rushYds: 20, tds: 1 });
    // 12 + 8 − 2 + 2 + 6: a passing touchdown is 4, a rushing one 6.
    assert.equal(fantasyPoints(qb), 26);
    const wr = line({ rec: 8, recYds: 100, tds: 1 });
    assert.equal(fantasyPoints(wr, 'ppr'), 24);
    assert.equal(fantasyPoints(wr, 'half'), 20);
    assert.equal(fantasyPoints(wr, 'standard'), 16);
  });

  it('turns a projection into a line, a quarterback and a receiver alike', () => {
    assert.deepEqual(projectedLine({ mean: { pass_yds: 250, pass_td: 1.5, pass_int: 0.7, rush_yds: 15 }, tds: 0.2 }), line({ passYds: 250, passTd: 1.5, passInt: 0.7, rushYds: 15, tds: 0.2 }));
    assert.deepEqual(projectedLine({ mean: { rec: 5, rec_yds: 60 } }), line({ rec: 5, recYds: 60 }));
  });

  it('reads what a player really did, a quarterback\'s runs from the rushing list and his throws from his own', () => {
    const skill: NflSkillBox = { teams: { H: [{ id: 'qb', name: 'QB', rushAtt: 4, rushYds: 30, rushTd: 1, tgt: 0, rec: 0, recYds: 0, recTd: 0 }, { id: 'wr', name: 'WR', rushAtt: 0, rushYds: 0, rushTd: 0, tgt: 9, rec: 7, recYds: 90, recTd: 2 }] } };
    const box = { league: 'nfl', teams: { H: { starter: null, passers: [{ id: 'qb', name: 'QB', att: 30, cmp: 20, yds: 250, td: 2, int: 1, sacks: 0, sackYds: 0, rushAtt: 4, rushYds: 30, rushTd: 1, fumLost: 0 }] } } } as unknown as BoxScore;
    const lines = actualLines(box, skill);
    // The running touchdown counts once, at 6.
    assert.deepEqual(lines.get('qb'), line({ passYds: 250, passTd: 2, passInt: 1, rushYds: 30, tds: 1 }));
    assert.deepEqual(lines.get('wr'), line({ rec: 7, recYds: 90, tds: 2 }));
    assert.equal(actualLines(box, null).size, 0);
  });

  it('pulls top backs and receivers down, leaves quarterbacks alone, and shares the correction across formats', () => {
    const star = line({ rec: 8, recYds: 100, tds: 1 });
    assert.equal(projectedPoints(star, 'QB'), 24);
    const ppr = projectedPoints(star, 'WR');
    assert.ok(Math.abs(ppr - (0.94 + 0.84 * 24)) < 1e-9);
    assert.ok(ppr < 24);
    assert.equal(projectedPoints(star, 'TE'), ppr);
    assert.ok(Math.abs(projectedPoints(star, 'WR', 'standard') / ppr - 16 / 24) < 1e-9);
    // Barely used players get nudged up, never below zero.
    assert.ok(projectedPoints(line({ rec: 1 }), 'RB') > 1);
    assert.equal(projectedPoints(line(), 'RB'), 0);
  });

  it('averages lines over games', () => {
    assert.deepEqual(averageLine([line({ rec: 4, tds: 1 }), line({ rec: 6, tds: 0 })]), line({ rec: 5, tds: 0.5 }));
    assert.equal(averageLine([]), null);
  });
});

describe('start or sit', () => {
  it('names who is projected more, the gap and how often that gap has held up', () => {
    const star = line({ rec: 8, recYds: 100, tds: 1 });
    const other = line({ rec: 5, recYds: 60, tds: 0.5 });
    const call = startSit(other, 'WR', star, 'WR');
    assert.equal(call.favorite, 'right');
    assert.ok(Math.abs(call.gap - 0.84 * (24 - 14)) < 1e-9);
    assert.equal(call.chance, 0.83);
    assert.equal(startSit(star, 'WR', star, 'WR').chance, 0.52);
    assert.equal(startSit(star, 'WR', star, 'WR').favorite, 'left');
  });

  it('never gives a smaller gap a better chance', () => {
    const steady = line({ passYds: 500 });
    let last = 0;
    for (let yds = 500; yds <= 1000; yds += 10) {
      const { chance } = startSit(line({ passYds: yds }), 'QB', steady, 'QB');
      assert.ok(chance >= last);
      last = chance;
    }
    assert.equal(last, 0.89);
  });
});

describe('fantasy comparison rows', () => {
  const side = (o = {}) => ({ position: 'WR' as const, projected: line({ rec: 8, recYds: 100, tds: 1 }), recent: line({ rec: 5 }), season: line({ rec: 10 }), games: 7, ...o });

  it('sets this week, the last three and the season side by side, in PPR', () => {
    const rows = fantasyCompareRows(side(), side({ projected: line({ rec: 1 }), recent: line({ rec: 6 }), season: line({ rec: 2 }) }));
    assert.deepEqual(rows.map((r) => [r.id, r.edge]), [['week', 'left'], ['last3', 'right'], ['season', 'left']]);
    assert.equal(rows[1].right.value, '6.0');
    assert.equal(rows[1].right.bar, 1);
    assert.equal(rows[2].left.note, '7 games');
    assert.match(rows[0].left.note!, /^Half .* · Std /);
  });

  it('shows a dash for a player off the board, with no edge, and nothing for neither', () => {
    const rows = fantasyCompareRows(side(), null);
    assert.equal(rows[0].right.value, '—');
    assert.equal(rows[0].edge, null);
    assert.deepEqual(fantasyCompareRows(null, null), []);
  });
});

describe('fantasy positions', () => {
  it('reads the roster, treats a fullback as a back, and leaves out everyone else', () => {
    assert.equal(fantasyPosition('TE', 'WR/TE · 5 targets'), 'TE');
    assert.equal(fantasyPosition('FB', 'RB · 2 carries'), 'RB');
    assert.equal(fantasyPosition('LB', 'WR/TE · 1 targets'), null);
  });

  it("falls back on the model's read of his role when the roster has none", () => {
    assert.equal(fantasyPosition(undefined, 'QB · 34 attempts'), 'QB');
    assert.equal(fantasyPosition(undefined, 'RB · 12.0 carries'), 'RB');
    assert.equal(fantasyPosition(undefined, 'WR/TE · 6.0 targets'), 'WR');
  });
});

describe('the NFL week', () => {
  it('runs through Monday night, whichever day it starts', () => {
    // Thursday night, Sunday and Monday night of one week all end the same Tuesday, even past midnight UTC.
    const thursday = weekEnd('2026-11-06T01:15Z');
    assert.equal(thursday, '2026-11-10T10:00:00.000Z');
    assert.equal(weekEnd('2026-11-08T18:00Z'), thursday);
    assert.equal(weekEnd('2026-11-10T01:15Z'), thursday);
    // The next Thursday starts a new one.
    assert.equal(weekEnd('2026-11-13T01:15Z'), '2026-11-17T10:00:00.000Z');
  });
});

describe('rank correlation', () => {
  it('is 1 for the same order, -1 for the reverse, and handles ties', () => {
    assert.equal(rankCorrelation([1, 2, 3, 4], [10, 20, 30, 40]), 1);
    assert.equal(rankCorrelation([1, 2, 3, 4], [40, 30, 20, 10]), -1);
    assert.equal(rankCorrelation([1, 1, 1], [1, 2, 3]), 0);
    assert.ok(rankCorrelation([1, 2, 2, 3], [1, 2, 3, 4]) > 0.9);
    assert.equal(rankCorrelation([1], [1]), 0);
  });
});
