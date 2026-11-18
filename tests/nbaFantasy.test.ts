import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { NbaLine } from '../lib/boxscores';
import { averageNbaLine, nbaActualLine, nbaFantasyGroup, nbaFantasyPoints, nbaFantasyRange, nbaProjectedLine, nbaStartSit, type NbaFantasyLine } from '../lib/model/nbaFantasy';
import { nbaFantasyCard, weekStartOf, type NbaFantasyBoard, type NbaFantasyRow } from '../lib/model/nbaFantasyBoard';
import { gradeNbaFantasyLedger, withNbaBoard, type NbaFantasyLedger, type NbaFantasyPick } from '../lib/model/nbaFantasyLedger';

const line = (o: Partial<NbaFantasyLine> = {}): NbaFantasyLine => ({ pts: 0, reb: 0, ast: 0, stl: 0, blk: 0, tov: 0, ...o });
const row = (id: string, o: Partial<NbaFantasyRow> = {}): NbaFantasyRow => ({
  id,
  name: id,
  position: 'PG',
  group: 'G',
  team: { id: 'T', abbr: 'T', logo: null, color: '#000' },
  opponent: 'O',
  home: true,
  gameId: 'g1',
  start: '2026-11-18T00:00:00Z',
  day: '2026-11-17',
  minutes: 30,
  available: 1,
  status: null,
  projected: line({ pts: 20 }),
  recent: null,
  season: line({ pts: 18 }),
  games: 10,
  weekLeft: 3,
  nextWeek: 4,
  ...o
});

describe('NBA fantasy points', () => {
  it('scores the NBA way: 1 a point, 1.2 a rebound, 1.5 an assist, 3 a steal or block, -1 a turnover', () => {
    assert.equal(nbaFantasyPoints(line({ pts: 25, reb: 10, ast: 4, stl: 1, blk: 2, tov: 3 })), 25 + 12 + 6 + 3 + 6 - 3);
  });

  it('reads a projection and a box-score line', () => {
    assert.deepEqual(nbaProjectedLine({ mean: { pts: 20, reb: 5, ast: 3, pra: 28 } }), line({ pts: 20, reb: 5, ast: 3 }));
    const box = { id: 'a', name: 'A', starter: true, min: 30, pts: 22, fgm: 8, fga: 15, ftm: 4, fta: 5, oreb: 2, dreb: 6, ast: 7, stl: 1, blk: 0, tov: 2, pf: 3, pm: 5, dnp: false } as NbaLine;
    assert.deepEqual(nbaActualLine(box), line({ pts: 22, reb: 8, ast: 7, stl: 1, tov: 2 }));
  });

  it('averages lines, and has nothing to average with no games', () => {
    assert.deepEqual(averageNbaLine([line({ pts: 10 }), line({ pts: 20, reb: 4 })]), line({ pts: 15, reb: 2 }));
    assert.equal(averageNbaLine([]), null);
  });

  it('groups roster positions into guards, forwards and centers', () => {
    assert.equal(nbaFantasyGroup('PG'), 'G');
    assert.equal(nbaFantasyGroup('SG'), 'G');
    assert.equal(nbaFantasyGroup('G'), 'G');
    assert.equal(nbaFantasyGroup('SF'), 'F');
    assert.equal(nbaFantasyGroup('F'), 'F');
    assert.equal(nbaFantasyGroup('C'), 'C');
    assert.equal(nbaFantasyGroup(undefined), null);
  });

  it('widens the likely range for smaller projections', () => {
    const [lowBig, highBig] = nbaFantasyRange(40);
    const [lowSmall, highSmall] = nbaFantasyRange(10);
    assert.ok(highBig / lowBig < highSmall / lowSmall);
    assert.ok(lowBig < 40 && highBig > 40);
  });

  it('calls start or sit by the gap, more sure the wider it is', () => {
    const close = nbaStartSit(30, 29);
    const wide = nbaStartSit(20, 45);
    assert.equal(close.favorite, 'left');
    assert.equal(wide.favorite, 'right');
    assert.ok(wide.chance > close.chance);
    assert.equal(wide.gap, 25);
  });
});

describe('the fantasy week', () => {
  it('runs Monday to Sunday', () => {
    assert.equal(weekStartOf('2026-11-16'), '2026-11-16'); // a Monday
    assert.equal(weekStartOf('2026-11-17'), '2026-11-16');
    assert.equal(weekStartOf('2026-11-22'), '2026-11-16'); // Sunday
    assert.equal(weekStartOf('2026-11-23'), '2026-11-23');
  });
});

describe("a player's fantasy card", () => {
  const board = (rows: NbaFantasyRow[]): NbaFantasyBoard => ({ day: '2026-11-17', rows, started: [], week: { start: '2026-11-16', end: '2026-11-22', teams: [] } });

  it('ranks him among that night’s players by points discounted for the chance he sits', () => {
    const card = nbaFantasyCard(board([row('a', { projected: line({ pts: 30 }) }), row('b', { projected: line({ pts: 40 }), available: 0.5 }), row('c', { projected: line({ pts: 25 }), day: '2026-11-18' })]), 'a');
    assert.equal(card?.dayRank, 1);
    assert.equal(card?.dayPlayers, 2);
    assert.equal(card?.points, 30);
  });

  it('ranks the season average only with enough games', () => {
    const card = nbaFantasyCard(board([row('a', { games: 3 }), row('b')]), 'a');
    assert.equal(card?.seasonRank, null);
    assert.equal(nbaFantasyCard(board([row('a')]), 'nobody'), null);
  });
});

describe('saving the NBA board before tip-off', () => {
  const now = new Date('2026-11-17T20:00:00Z');

  it('saves only games starting soon, and says when something changed', () => {
    const soon = row('a', { start: '2026-11-18T00:00:00Z' });
    const later = row('b', { gameId: 'g2', start: '2026-11-19T00:00:00Z' });
    const { ledger, changed } = withNbaBoard({}, [soon, later], now);
    assert.ok(changed);
    assert.deepEqual(Object.keys(ledger), ['g1']);
    assert.deepEqual(ledger.g1.picks[0], ['a', 20, 1, 18, 10]);
    assert.equal(withNbaBoard(ledger, [soon], now).changed, false);
  });

  it('never touches a game after it starts', () => {
    const { ledger } = withNbaBoard({}, [row('a')], now);
    const after = withNbaBoard(ledger, [row('b')], new Date('2026-11-18T00:00:00Z'));
    assert.equal(after.changed, false);
    assert.equal(after.ledger.g1.picks[0][0], 'a');
  });
});

describe('grading the saved NBA board', () => {
  const pick = (id: string, points = 30, available = 1, average: number | null = 25, games = 10): NbaFantasyPick => [id, points, available, average, games];
  const entry = (picks: NbaFantasyPick[]) => ({ start: '2026-11-18T00:00:00Z', takenAt: '2026-11-17T23:00:00.000Z', picks });

  it('grades played games against his average', () => {
    const ledger: NbaFantasyLedger = { g1: entry([pick('a')]), g2: entry([pick('b')]) };
    const graded = gradeNbaFantasyLedger(ledger, (id) => (id === 'g1' ? new Map([['a', 35]]) : null));
    assert.equal(graded.players, 1);
    assert.equal(graded.nights, 1);
    assert.equal(graded.miss, 5);
    assert.equal(graded.averageMiss, 10);
  });

  it('counts an expected player who sat as zero, and skips the ruled-out and the new', () => {
    const graded = gradeNbaFantasyLedger({ g1: entry([pick('a'), pick('out', 30, 0), pick('new', 30, 1, 20, 2)]) }, () => new Map([['other', 10]]));
    assert.equal(graded.sat, 1);
    assert.equal(graded.players, 1);
    assert.equal(graded.miss, 30);
  });

  it('reports an order only with enough players on a night', () => {
    const many = Array.from({ length: 8 }, (_, i) => pick(`p${i}`, i, 1, 8 - i));
    const points = new Map(Array.from({ length: 8 }, (_, i): [string, number] => [`p${i}`, i]));
    const graded = gradeNbaFantasyLedger({ g1: entry(many) }, () => points);
    assert.equal(graded.order, 1);
    assert.equal(graded.averageOrder, -1);
    assert.equal(gradeNbaFantasyLedger({ g1: entry(many.slice(0, 7)) }, () => points).order, null);
  });
});
