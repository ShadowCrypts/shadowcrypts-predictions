import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { gradeClv, gradePropLedger, PropLedgerEntry, withFirst } from '../lib/model/propLedger';

const entry = (key: string, side: 'over' | 'under', line: number, takenAt = '2026-10-26T20:00:00Z'): [string, PropLedgerEntry] => [
  key,
  {
    takenAt,
    start: '2026-10-26T23:00:00Z',
    gameId: key,
    athleteId: key,
    name: key,
    teamId: 'T',
    market: 'sog',
    line,
    over: -120,
    under: 100,
    book: 'DraftKings',
    projected: 2,
    model: 0.4,
    side,
    edge: 0.12
  }
];

describe('prop ledger', () => {
  it('grades logged disagreements at the price taken, voiding players who sat', () => {
    const ledger = Object.fromEntries([
      entry('won', 'under', 2.5), // went under at +100
      entry('lost', 'over', 2.5), // went under, the over at -120 loses
      entry('push', 'under', 3), // landed on the line
      entry('sat', 'under', 2.5), // didn't play: void
      entry('pending', 'under', 2.5), // not final yet
      entry('late', 'under', 2.5, '2026-10-27T00:00:00Z') // logged after the start: never counts
    ]);
    const actual: Record<string, number | null | undefined> = { won: 1, lost: 2, push: 3, sat: null, pending: undefined, late: 0 };
    const r = gradePropLedger(ledger, (e) => actual[e.gameId]);
    assert.deepEqual({ bets: r.bets, won: r.won, lost: r.lost, pushes: r.pushes, pending: r.pending }, { bets: 2, won: 1, lost: 1, pushes: 1, pending: 1 });
    // +1 at even money, -1 on the loss.
    assert.equal(r.profit, 0);
    assert.equal(r.returnPerBet, 0);
  });

  it('keeps the earliest tag of a line across logs', () => {
    const [, early] = entry('a', 'over', 24.5, '2026-10-26T02:00:00Z');
    const [, late] = entry('a', 'over', 25.5, '2026-10-26T20:00:00Z');
    const merged = withFirst(late, withFirst(early, undefined));
    assert.equal(merged.line, 25.5, 'graded at the latest');
    assert.deepEqual(merged.first, { takenAt: '2026-10-26T02:00:00Z', line: 24.5, over: -120, under: 100 });
  });

  it('measures closing line value from the first tag', () => {
    const tagged = (key: string, side: 'over' | 'under', line: number, over = -110, under = -110, takenAt = '2026-10-26T02:00:00Z'): [string, PropLedgerEntry] => {
      const [k, e] = entry(key, side, line);
      return [k, { ...e, first: { takenAt, line, over, under } }];
    };
    const ledger = Object.fromEntries([
      tagged('up', 'over', 24.5), // closed 25.5: the over was the better number
      tagged('down', 'over', 24.5), // closed 23.5: worse
      tagged('under', 'under', 24.5), // closed 23.5: the under beat it
      tagged('price', 'over', 24.5, -110, -110), // same line, closed over -130: the over got dearer, so it beat the close
      tagged('flat', 'over', 24.5), // closed the same
      tagged('late', 'over', 24.5, -110, -110, '2026-10-26T22:30:00Z'), // tagged half an hour before the start: not counted
      tagged('noclose', 'over', 24.5), // no closing line on file
      entry('old', 'over', 24.5) // logged before first tags were kept
    ]);
    const closes: Record<string, { line: number; over: number; under: number } | null> = {
      up: { line: 25.5, over: -110, under: -110 },
      down: { line: 23.5, over: -110, under: -110 },
      under: { line: 23.5, over: -110, under: -110 },
      price: { line: 24.5, over: -130, under: 110 },
      flat: { line: 24.5, over: -110, under: -110 },
      late: { line: 30.5, over: -110, under: -110 },
      noclose: null,
      old: { line: 30.5, over: -110, under: -110 }
    };
    assert.deepEqual(gradeClv(ledger, (e) => closes[e.gameId]), { picks: 5, beat: 3, same: 1, worse: 1 });
  });
});
