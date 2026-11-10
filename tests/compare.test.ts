import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { axisTicks, compareMarkets, compareRows, meetings, mostAlike, recencyPoints, statLine } from '../lib/model/compare';
import type { PlayerGame } from '../lib/model/playerLog';
import type { PropRow } from '../lib/model/propBoard';

const game = (i: number, seasonYear: number, pts: number, line?: number) =>
  ({
    gameId: String(i),
    date: `2026-10-${String(30 - i).padStart(2, '0')}`,
    seasonYear,
    opponent: 'X',
    home: true,
    detail: null,
    stats: { pts, reb: 0 },
    lines: line === undefined ? {} : { pts: { line, over: -110, under: -110, book: 'DK' } }
  }) as PlayerGame;

describe('player comparison', () => {
  // Newest first: three this season, then nine last season.
  const games = [game(0, 2027, 30, 25.5), game(1, 2027, 20, 25.5), game(2, 2027, 25, 25), ...Array.from({ length: 9 }, (_, i) => game(3 + i, 2026, 10, i < 2 ? 12.5 : undefined))];
  const next = { id: 'p', name: 'P', teamId: 't', detail: '', available: 1, cells: { pts: { projection: 27.4, actual: null, line: { line: 26.5, forecastOver: 0.53 } } } } as unknown as PropRow;

  it('reads the next game, the last ten, this season and overs against the line', () => {
    const s = statLine(games, next, 'pts', 2027);
    assert.deepEqual(s.next, { projection: 27.4, line: 26.5, over: 0.53 });
    // Last ten: 30 + 20 + 25 + 7 × 10 = 145.
    assert.deepEqual(s.recent, { average: 14.5, games: 10 });
    assert.deepEqual(s.season, { average: 25, games: 3 });
    // Lined games in the last ten: 30 over, 20 under, 25 on 25 a push (left out), two 10s under 12.5.
    assert.deepEqual(s.overs, { hits: 1, of: 4 });
  });

  it('builds rows with bars against the bigger side, and a dash where one side has nothing', () => {
    const left = statLine(games, next, 'pts', 2027);
    const right = statLine(games.slice(3), null, 'pts', 2027);
    const rows = compareRows(left, right);
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    assert.equal(byId.next.right.value, '—');
    assert.equal(byId.next.edge, null);
    assert.equal(byId.next.left.note, 'Line 26.5 · 53% over');
    // 14.5 against 10: the bigger side fills its bar.
    assert.deepEqual([byId.recent.left.bar, byId.recent.right.bar, byId.recent.edge], [1, 10 / 14.5, 'left']);
    // The right player has no games this season.
    assert.equal(byId.season.right.value, '—');
    // Overs run as a share: 1 of 4 against 0 of 2.
    assert.deepEqual([byId.overs.left.value, byId.overs.left.bar, byId.overs.right.value], ['1 of 4', 0.25, '0 of 2']);
  });

  it('finds the most similar player across every stat, not by scoring alone', () => {
    const markets = ['pts', 'reb', 'ast', 'pr'] as const;
    const center = { pts: 10, reb: 12, ast: 2, pr: 22 };
    const pool = [
      { id: 'self', mean: center },
      // Scores exactly the same, but he's a guard.
      { id: 'guard', mean: { pts: 10, reb: 2, ast: 6, pr: 12 } },
      // Scores more, and is still the closer match.
      { id: 'big', mean: { pts: 13, reb: 11, ast: 2, pr: 24 } }
    ];
    assert.equal(mostAlike(center, pool, [...markets], 'self')?.id, 'big');
    assert.equal(mostAlike(center, [pool[0]], [...markets], 'self'), null);
  });

  it('finds the games they played against each other, not the ones they shared as teammates', () => {
    const at = (gameId: string, home: boolean) => ({ gameId, home }) as PlayerGame;
    const found = meetings([at('3', true), at('2', true), at('1', false)], [at('3', false), at('2', true), at('9', true)]);
    // Game 3: opposite sides. Game 2: the same side, so teammates. Games 1 and 9: only one of them.
    assert.deepEqual(found.map((m) => m.left.gameId), ['3']);
    assert.equal(found[0].right.home, false);
  });

  it('lines two players up by how recent the game was, not by date', () => {
    const newestFirst = [{ stats: { pts: 30 } }, { stats: {} }, { stats: { pts: 10 } }] as PlayerGame[];
    // Oldest to newest, the newest game in the last slot; a player with fewer games starts later.
    assert.deepEqual(recencyPoints(newestFirst, 'pts', 5), [null, null, 10, null, 30]);
    assert.deepEqual(recencyPoints(newestFirst, 'pts', 2), [null, 30]);
  });

  it('picks round axis ticks that clear the top value, four steps at most', () => {
    assert.deepEqual(axisTicks(43), [0, 20, 40, 60]);
    assert.deepEqual(axisTicks(3), [0, 1, 2, 3]);
    assert.deepEqual(axisTicks(330), [0, 100, 200, 300, 400]);
    assert.deepEqual(axisTicks(9), [0, 5, 10]);
    assert.deepEqual(axisTicks(0), [0, 1]);
    for (const max of [1, 2, 7, 11, 19, 27, 99, 101, 512]) {
      const ticks = axisTicks(max);
      assert.ok(ticks[ticks.length - 1] >= max && ticks.length <= 5, `${max}: ${ticks}`);
    }
  });

  it('compares the stats either player logs, leaving the two-stat combos out', () => {
    assert.deepEqual(compareMarkets(['pts', 'reb', 'pr', 'pra', 'stl'], [games], [next]), ['pts']);
    const withSteals = [{ ...games[0], stats: { pts: 1, stl: 2, pr: 3 } }] as PlayerGame[];
    assert.deepEqual(compareMarkets(['pts', 'reb', 'pr', 'pra', 'stl'], [games, withSteals], [null]), ['pts', 'stl']);
    // One steal in twelve games isn't his stat; one a game in four is.
    const once = games.map((g, i) => ({ ...g, stats: { ...g.stats, stl: i === 0 ? 1 : 0 } }));
    assert.deepEqual(compareMarkets(['stl'], [once], [null]), []);
    const often = games.map((g, i) => ({ ...g, stats: { ...g.stats, stl: i % 4 === 0 ? 1 : 0 } }));
    assert.deepEqual(compareMarkets(['stl'], [often], [null]), ['stl']);
  });
});
