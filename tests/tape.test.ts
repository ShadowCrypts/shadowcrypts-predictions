import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Game } from '../lib/espn';
import { leagueSheet, neutralGames, ratingAt, tapeNote, tapeRows, tapeSeason, teamNumbers } from '../lib/model/tape';

const game = (id: string, date: string, home: [string, number | null], away: [string, number | null], seasonYear = 2026, seasonType = 2) =>
  ({
    id,
    date,
    seasonYear,
    seasonType,
    completed: home[1] !== null,
    neutral: false,
    home: { teamId: home[0], score: home[1] },
    away: { teamId: away[0], score: away[1] }
  }) as unknown as Game;

const history = {
  A: [{ date: '2026-10-01', rating: 1550 }],
  B: [{ date: '2026-10-01', rating: 1450 }],
  C: [{ date: '2026-10-01', rating: 1600 }],
  // An exhibition opponent: never ranked.
  X: [{ date: '2026-10-01', rating: 1900 }]
};

describe('tale of the tape', () => {
  const games = [
    game('1', '2026-10-21', ['A', 110], ['B', 100]),
    game('2', '2026-10-23', ['B', 90], ['C', 120]),
    game('3', '2026-10-25', ['C', 105], ['A', 100]),
    game('4', '2026-10-27', ['A', 100], ['B', 101]),
    game('5', '2026-10-29', ['C', 100], ['B', 95]),
    game('6', '2026-10-30', ['A', 112], ['C', 108]),
    // A preseason game and the game itself never count.
    game('7', '2026-10-10', ['A', 0], ['X', 50], 2026, 1),
    game('8', '2026-11-01', ['B', null], ['A', null])
  ];
  const sheet = leagueSheet({ teamIds: ['A', 'B', 'C'], games, history, seasonYear: 2026, before: '2026-11-01T00:00Z' });
  // A visits B.
  const rows = tapeRows(sheet, 'A', 'B', { host: 'right', unit: 'Points' });
  const row = (id: string, from = rows) => from.find((r) => r.id === id)!;

  it('averages each team a game and ranks it in the league', () => {
    // A: scored 110, 100, 100, 112 = 105.5; B: 100, 90, 101, 95 = 96.5; C: 120, 105, 100, 108 = 108.25.
    assert.equal(row('scored').left.value, '105.5');
    assert.deepEqual([row('scored').left.rank, row('scored').right.rank, row('scored').right.of], [2, 3, 3]);
    assert.equal(row('scored').edge, 'left');
    // Allowed: A 100, 105, 101, 108 = 103.5 (2nd fewest); B 110, 120, 100, 100 = 107.5 (3rd).
    assert.equal(row('allowed').left.value, '103.5');
    assert.deepEqual([row('allowed').left.rank, row('allowed').right.rank], [2, 3]);
    assert.equal(row('margin').left.value, '+2.0');
  });

  it("puts the visitor's road record against the host's home record, and turns with the venue", () => {
    // A's one road game: lost at C. B's one home game: lost to C. Both last on their lists.
    assert.equal(row('venue').label, 'Road vs home');
    assert.deepEqual([row('venue').left.value, row('venue').right.value], ['0–1', '0–1']);
    assert.equal(row('venue').edge, null);
    // At A instead: A 2–1 at home, B 1–2 on the road.
    const atA = tapeRows(sheet, 'A', 'B', { host: 'left', unit: 'Points' });
    assert.equal(row('venue', atA).label, 'Home vs road');
    assert.deepEqual([row('venue', atA).left.value, row('venue', atA).right.value], ['2–1', '1–2']);
    assert.equal(tapeRows(sheet, 'A', 'B', { host: null, unit: 'Points' }).some((r) => r.id === 'venue'), false);
  });

  it('rates the schedule by the Elo of the teams played, without favoring a side, and ranks league teams only', () => {
    // A played B, C, B, C: (1450 + 1600 + 1450 + 1600) / 4 = 1525. B played A, C, A, C: 1575, the toughest.
    assert.equal(row('schedule').left.value, '1525');
    assert.equal(row('schedule').right.rank, 1);
    assert.equal(row('schedule').edge, null);
    assert.deepEqual([row('elo').right.value, row('elo').left.rank, row('elo').left.of], ['1450', 2, 3]);
  });

  it('only adds the adjusted ratings when given, defense turned so higher is better', () => {
    assert.equal(rows.some((r) => r.id === 'offense'), false);
    const adjusted = leagueSheet({
      teamIds: ['A', 'B', 'C'],
      games,
      history,
      seasonYear: 2026,
      before: '2026-11-01T00:00Z',
      adjusted: { A: { offense: 2, defense: 3 }, B: { offense: -1, defense: -4 }, C: { offense: 0, defense: 0 }, X: { offense: 9, defense: -9 } }
    });
    const defense = row('defense', tapeRows(adjusted, 'A', 'B', { host: 'right', unit: 'Points' }));
    assert.deepEqual([defense.right.value, defense.right.rank, defense.right.of], ['+4.0', 1, 3]);
    assert.equal(defense.edge, 'right');
  });

  it("reads one team's numbers with home and road apart, leaving out what its page already shows", () => {
    const numbers = teamNumbers(sheet, 'A', 'Points');
    assert.deepEqual(numbers.map((n) => n.id), ['scored', 'allowed', 'margin', 'home', 'road', 'schedule']);
    const of = (id: string) => numbers.find((n) => n.id === id)!.side;
    assert.deepEqual([of('home').value, of('road').value], ['2–1', '0–1']);
    // At home: C went 2–0, A 2–1, B 0–1. On the road: C 1–1, B 1–2, A 0–1.
    assert.deepEqual([of('home').rank, of('road').rank], [2, 3]);
  });

  it('adds the box-score metrics the league names, with fewer better where it should be', () => {
    const withMetrics = leagueSheet({
      teamIds: ['A', 'B', 'C'],
      games,
      history,
      seasonYear: 2026,
      before: '2026-11-01T00:00Z',
      league: 'nba',
      metrics: { A: { off: 115, def: 110, pace: 100 }, B: { off: 112, def: 105, pace: 98 }, C: { off: 118, def: 120, pace: 102 } }
    });
    const list = tapeRows(withMetrics, 'A', 'B', { host: 'right', unit: 'Points' });
    const off = row('metric-off', list);
    assert.deepEqual([off.label, off.left.value, off.left.rank, off.right.rank], ['Offense rating', '115.0', 2, 3]);
    // The lowest defense rating is the best.
    const def = row('metric-def', list);
    assert.deepEqual([def.label, def.right.rank, def.left.rank, def.edge], ['Defense rating', 1, 2, 'right']);
    assert.match(tapeNote(list, 'This season', 'nba'), /per 100 possessions/);
    // On a team's page too.
    assert.ok(teamNumbers(withMetrics, 'A', 'Points').some((n) => n.id === 'metric-off'));
  });

  it('leaves preseason and playoff games out of every number', () => {
    const played = [game('r', '2026-10-20', ['A', 100], ['B', 90]), game('pre', '2026-10-01', ['A', 0], ['B', 50], 2026, 1), game('post', '2026-10-25', ['A', 0], ['B', 50], 2026, 3)];
    const s = leagueSheet({ teamIds: ['A', 'B'], games: played, history, seasonYear: 2026, before: '2026-11-01' }).teams;
    assert.deepEqual([s.A.season!.games, s.A.season!.scored, s.A.season!.home], [1, 100, { w: 1, l: 0, t: 0 }]);
  });

  it('counts a neutral-site game in the averages but in neither record', () => {
    const neutral = { ...game('n', '2026-10-30', ['A', 40], ['B', 10]), neutral: true } as Game;
    const played = [game('1', '2026-10-20', ['A', 20], ['B', 10]), game('2', '2026-10-25', ['B', 20], ['A', 10]), neutral];
    const s = leagueSheet({ teamIds: ['A', 'B'], games: played, history, seasonYear: 2026, before: '2026-11-01' }).teams;
    assert.deepEqual([s.A.season!.games, s.A.season!.scored], [3, 70 / 3]);
    assert.deepEqual([s.A.season!.home, s.A.season!.road], [{ w: 1, l: 0, t: 0 }, { w: 0, l: 1, t: 0 }]);
    assert.deepEqual([s.B.season!.home, s.B.season!.road], [{ w: 1, l: 0, t: 0 }, { w: 0, l: 1, t: 0 }]);
    // The page says so, because home plus road no longer adds up to the record.
    assert.equal(neutralGames(s.A.season!), 1);
  });

  it('falls back to last season until both teams have a few games, and reads Elo going in', () => {
    const early = [game('1', '2025-12-01', ['A', 1], ['B', 0], 2025), game('2', '2026-10-21', ['A', 1], ['B', 0])];
    assert.equal(tapeSeason(early, ['A', 'B'], 2026, '2026-10-25'), 2025);
    assert.equal(tapeSeason(early, ['A', 'C'], 2026, '2026-10-25'), null);
    assert.equal(ratingAt([{ date: '2026-10-01', rating: 1500 }, { date: '2026-10-05', rating: 1510 }], '2026-10-05'), 1500);
    assert.equal(ratingAt([{ date: '2026-10-01', rating: 1500 }], '2026-09-01'), null);
    // With no season, only the ratings rows are left.
    const bare = leagueSheet({ teamIds: ['A', 'B'], games: early, history, seasonYear: null, before: '2026-10-25' });
    assert.deepEqual(tapeRows(bare, 'A', 'B', { host: 'right', unit: 'Points' }).map((r) => r.id), ['elo']);
  });
});
