import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { FantasyLine } from '../lib/model/fantasy';
import type { FantasyRow } from '../lib/model/fantasyBoard';
import { FantasyLedger, FantasyPick, gradeFantasyLedger, withBoard } from '../lib/model/fantasyLedger';

const line = (o: Partial<FantasyLine> = {}): FantasyLine => ({ passYds: 0, passTd: 0, passInt: 0, rushYds: 0, recYds: 0, rec: 0, tds: 0, ...o });
const row = (id: string, gameId: string, start: string): FantasyRow =>
  ({ id, name: id, position: 'WR', team: { id: 'T', abbr: 'T', logo: null, color: '#000' }, opponent: 'O', home: true, gameId, start, available: 1, status: null, projected: line({ rec: 5 }), recent: null, season: line({ rec: 4 }), games: 6 }) as FantasyRow;
const pick = (id: string, o: Partial<FantasyPick> = {}): FantasyPick => ({ id, position: 'WR', points: 10, available: 1, average: 8, games: 6, ...o });
const entry = (picks: FantasyPick[], start = '2026-11-08T18:00:00Z') => ({ start, takenAt: '2026-11-08T17:00:00.000Z', picks });

describe('saving the board before kickoff', () => {
  const before = new Date('2026-11-08T17:00:00Z');

  it('saves a game not started, corrected and in PPR, with his average going in', () => {
    const next = withBoard({}, [row('a', 'g1', '2026-11-08T18:00:00Z')], before);
    assert.equal(next.g1.picks.length, 1);
    assert.equal(next.g1.picks[0].points, Number((0.94 + 0.84 * 5).toFixed(2)));
    assert.equal(next.g1.picks[0].average, 4);
    assert.equal(next.g1.start, '2026-11-08T18:00:00Z');
  });

  it('takes the newest reading until kickoff and never touches a game after it', () => {
    const first = withBoard({}, [row('a', 'g1', '2026-11-08T18:00:00Z')], before);
    const later = withBoard(first, [row('b', 'g1', '2026-11-08T18:00:00Z')], new Date('2026-11-08T17:30:00Z'));
    assert.deepEqual(later.g1.picks.map((p) => p.id), ['b']);
    const after = withBoard(later, [row('c', 'g1', '2026-11-08T18:00:00Z')], new Date('2026-11-08T18:00:00Z'));
    assert.deepEqual(after.g1.picks.map((p) => p.id), ['b']);
  });

  it('leaves other games alone, and does not change what it was given', () => {
    const start: FantasyLedger = { old: entry([pick('z')]) };
    const next = withBoard(start, [row('a', 'g1', '2026-11-08T18:00:00Z')], before);
    assert.ok(next.old);
    assert.equal(start.g1, undefined);
  });
});

describe('grading the saved board', () => {
  it('grades only games with box scores, against his average, on the same players', () => {
    const ledger = { g1: entry([pick('a', { points: 10, average: 8 })]), g2: entry([pick('b')]) };
    const graded = gradeFantasyLedger(ledger, (id) => (id === 'g1' ? new Map([['a', line({ rec: 12 })]]) : null));
    assert.equal(graded.players, 1);
    assert.equal(graded.weeks, 1);
    assert.equal(graded.miss, 2);
    assert.equal(graded.averageMiss, 4);
  });

  it('counts a player expected to play who did not as scoring nothing, for both sides', () => {
    const graded = gradeFantasyLedger({ g1: entry([pick('a', { points: 10, average: 8 })]) }, () => new Map([['other', line()]]));
    assert.equal(graded.sat, 1);
    assert.equal(graded.miss, 10);
    assert.equal(graded.averageMiss, 8);
  });

  it('leaves out a player already ruled out, and one with too few games to compare', () => {
    const graded = gradeFantasyLedger({ g1: entry([pick('out', { available: 0 }), pick('new', { games: 2 }), pick('none', { average: null })]) }, () => new Map([['other', line()]]));
    assert.equal(graded.players, 0);
    assert.equal(graded.sat, 0);
  });

  it('discounts the projection by the chance he sits', () => {
    const graded = gradeFantasyLedger({ g1: entry([pick('a', { points: 10, available: 0.5 })]) }, () => new Map([['a', line({ rec: 5 })]]));
    assert.equal(graded.miss, 0);
  });

  it('reports an order only with enough players at a position in a week', () => {
    const few = Array.from({ length: 7 }, (_, i) => pick(`p${i}`, { points: i, average: 7 - i }));
    const many = Array.from({ length: 8 }, (_, i) => pick(`p${i}`, { points: i, average: 8 - i }));
    const lines = (n: number) => new Map(Array.from({ length: n }, (_, i): [string, FantasyLine] => [`p${i}`, line({ rec: i })]));
    assert.equal(gradeFantasyLedger({ g1: entry(few) }, () => lines(7)).order, null);
    const graded = gradeFantasyLedger({ g1: entry(many) }, () => lines(8));
    assert.equal(graded.order, 1);
    assert.equal(graded.averageOrder, -1);
  });

  it('has nothing to say with nothing on file', () => {
    const graded = gradeFantasyLedger({}, () => null);
    assert.equal(graded.players, 0);
    assert.equal(graded.since, null);
  });
});
