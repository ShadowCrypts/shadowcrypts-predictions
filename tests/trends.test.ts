import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Prediction } from '../lib/model';
import { tallyText, teamTrends } from '../lib/model/trends';

const game = (id: string, date: string, home: [string, number], away: [string, number], homeSpread: number | null, overUnder: number | null) =>
  ({
    game: { id, date, completed: true, home: { teamId: home[0], score: home[1] }, away: { teamId: away[0], score: away[1] } },
    market: { homeSpread, overUnder }
  }) as unknown as Pick<Prediction, 'game' | 'market'>;

describe('betting trends', () => {
  it('grades a team against the closing spread and total, from either side', () => {
    const games = [
      // Home favorite by 5, won by 7: covered. 217 against 210.5: over.
      game('1', '2026-10-21', ['A', 112], ['B', 105], -5, 210.5),
      // Road underdog by 3.5, lost by 2: covered. 198 against 220: under.
      game('2', '2026-10-23', ['C', 100], ['A', 98], -3.5, 220),
      // Home favorite by 6, won by 6: push. Total 200 on 200: push.
      game('3', '2026-10-25', ['A', 103], ['D', 97], -6, 200),
      // Home favorite by 4, lost: no cover. No total posted.
      game('4', '2026-10-27', ['A', 90], ['E', 95], -4, null),
      // Someone else's game.
      game('5', '2026-10-27', ['B', 1], ['C', 0], -1, 1)
    ];
    const t = teamTrends(games, 'A');
    assert.deepEqual(t.ats, { w: 2, l: 1, p: 1 });
    assert.deepEqual(t.ou, { w: 1, l: 1, p: 1 });
    assert.deepEqual(t.atsFavorite, { w: 1, l: 1, p: 1 });
    assert.deepEqual(t.atsUnderdog, { w: 1, l: 0, p: 0 });
    assert.equal(tallyText(t.ats), '2–1–1');
  });

  it('counts the newest ten separately and skips games without a line', () => {
    const games = Array.from({ length: 14 }, (_, i) => game(String(i), `2026-11-${String(i + 1).padStart(2, '0')}`, ['A', 100], ['B', i < 4 ? 80 : 99], -10, null));
    const t = teamTrends([...games, { ...game('x', '2026-12-01', ['A', 1], ['B', 0], null, null), market: null } as never], 'A');
    // The four oldest won by 20 (cover); the ten newest won by 1 (no cover).
    assert.deepEqual(t.ats, { w: 4, l: 10, p: 0 });
    assert.deepEqual(t.atsLast10, { w: 0, l: 10, p: 0 });
  });
});
