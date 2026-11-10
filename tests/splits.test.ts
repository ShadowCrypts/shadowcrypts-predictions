import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { PlayerGame } from '../lib/model/playerLog';
import { playerSplits } from '../lib/model/splits';

const game = (seasonYear: number, home: boolean, pts: number, neutral = false) => ({ gameId: String(pts), seasonYear, home, neutral, stats: { pts }, lines: {} }) as unknown as PlayerGame;
const of = (rows: ReturnType<typeof playerSplits>['rows'], id: string) => rows.find((r) => r.id === id);

describe('player splits', () => {
  it('reaches back to last season for home and road until this one has enough games', () => {
    const games = [game(2027, true, 30), game(2027, false, 20), game(2026, true, 10), game(2026, false, 40)];
    const { rows, scope } = playerSplits(games, ['pts'], 2027);
    assert.equal(scope, 'this season and last');
    assert.deepEqual([of(rows, 'season')?.averages.pts, of(rows, 'season')?.games], [25, 2]);
    assert.equal(of(rows, 'last')?.averages.pts, 25);
    // Home: 30 and 10. Road: 20 and 40.
    assert.deepEqual([of(rows, 'home')?.averages.pts, of(rows, 'road')?.averages.pts], [20, 30]);
  });

  it('keeps home and road to this season once it has enough, and last ten to the newest', () => {
    const season = Array.from({ length: 12 }, (_, i) => game(2027, i % 2 === 0, i < 10 ? 20 : 0));
    const { rows, scope } = playerSplits([...season, game(2026, true, 100)], ['pts'], 2027);
    assert.equal(scope, 'this season');
    assert.equal(of(rows, 'recent')?.averages.pts, 20);
    assert.equal(of(rows, 'home')?.games, 6);
    assert.equal(of(rows, 'last')?.games, 1);
  });

  it('puts a neutral-site game in the season but neither split, and skips rows with no games', () => {
    const { rows } = playerSplits([game(2027, true, 30, true)], ['pts', 'reb'], 2027);
    assert.deepEqual(rows.map((r) => r.id), ['season', 'recent']);
    assert.deepEqual(of(rows, 'season')?.averages, { pts: 30 });
  });
});
