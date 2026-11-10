import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { leaderBoards } from '../lib/model/leaders';
import type { PropMarket } from '../lib/props';

type Line = Partial<Record<PropMarket, number>>;
const game = (players: Record<string, Line>) => new Map(Object.entries(players));
const who = (id: string) => (id === 'ghost' ? undefined : { name: id, team: 'T' });
const perGame = (min = 1) => ({ by: 'average' as const, minGames: () => min });
const totals = { by: 'total' as const, minGames: () => 1 };

describe('stat leaders', () => {
  const season = [game({ a: { pts: 30 }, b: { pts: 20 } }), game({ a: { pts: 30 }, b: { pts: 25 } }), game({ b: { pts: 30 } })];

  it('ranks basketball by the average and football and hockey by the total, and they can differ', () => {
    // a: 60 in 2 games (30.0). b: 75 in 3 games (25.0).
    assert.deepEqual(leaderBoards(season, ['pts'], perGame(), who)[0].leaders.map((l) => [l.id, l.value, l.games]), [['a', 30, 2], ['b', 25, 3]]);
    assert.deepEqual(leaderBoards(season, ['pts'], totals, who)[0].leaders.map((l) => [l.id, l.value, l.games]), [['b', 75, 3], ['a', 60, 2]]);
  });

  it('keeps a player without enough games off a per-game board, however big his nights', () => {
    const lines = [game({ star: { pts: 70 }, regular: { pts: 10 } }), game({ regular: { pts: 10 } })];
    assert.deepEqual(leaderBoards(lines, ['pts'], perGame(2), who)[0].leaders.map((l) => l.id), ['regular']);
  });

  it("judges each player against his own team's games, not the busiest team's", () => {
    // Five games is enough on a team that has played seven, though another team has played eight.
    const fiveGames = Array.from({ length: 5 }, () => game({ gillespie: { stl: 3 } }));
    const needs = { gillespie: 5 } as Record<string, number>;
    const [{ leaders }] = leaderBoards(fiveGames, ['stl'], { by: 'average', minGames: (id) => needs[id] }, who);
    assert.deepEqual(leaders.map((l) => l.id), ['gillespie']);
    needs.gillespie = 6;
    assert.deepEqual(leaderBoards(fiveGames, ['stl'], { by: 'average', minGames: (id) => needs[id] }, who)[0].leaders, []);
  });

  it('counts a game for a stat only when the player has a number in it', () => {
    // A receiver has no passing line: his catches count, and he never shows on the passing board.
    const boards = leaderBoards([game({ qb: { pass_yds: 300 }, wr: { rec_yds: 90 } }), game({ qb: { pass_yds: 200 }, wr: { rec_yds: 110 } })], ['pass_yds', 'rec_yds'], perGame(2), who);
    assert.deepEqual(boards.map((b) => [b.market, b.leaders.map((l) => [l.id, l.value])]), [['pass_yds', [['qb', 250]]], ['rec_yds', [['wr', 100]]]]);
  });

  it('counts a played game at zero against his average, and leaves out a stat he never logged', () => {
    const [{ leaders }] = leaderBoards([game({ a: { blk: 4 }, b: { blk: 0 } }), game({ a: { blk: 0 }, b: { blk: 0 } })], ['blk'], perGame(2), who);
    assert.deepEqual(leaders.map((l) => [l.id, l.value]), [['a', 2]]);
  });

  it('breaks a tie by games played, then name, and leaves out anyone it cannot name', () => {
    const lines = [game({ many: { ast: 5 }, zed: { ast: 5 }, abe: { ast: 5 }, ghost: { ast: 50 } }), game({ many: { ast: 5 } })];
    assert.deepEqual(leaderBoards(lines, ['ast'], perGame(), who)[0].leaders.map((l) => l.id), ['many', 'abe', 'zed']);
  });

  it('stops at the number shown', () => {
    const lines = [game(Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`p${i}`, { pts: i + 1 }])))];
    assert.equal(leaderBoards(lines, ['pts'], perGame(), who)[0].leaders.length, 5);
    assert.equal(leaderBoards(lines, ['pts'], perGame(), who, 2)[0].leaders.length, 2);
  });
});
