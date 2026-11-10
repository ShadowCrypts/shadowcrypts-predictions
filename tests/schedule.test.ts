import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ordinal } from '../lib/format';
import type { LeagueModel } from '../lib/model';
import { scheduleStrength } from '../lib/model/schedule';

const team = (id: string, rating: number) => ({ team: { id }, rating });
const game = (id: string, home: string, away: string, date: string, completed = false) => ({
  game: { id, date, completed, state: completed ? 'post' : 'pre', home: { teamId: home }, away: { teamId: away } }
});

describe('schedule strength', () => {
  it('averages the next opponents and ranks the stretch against the league', () => {
    const model = {
      rankings: [team('A', 1600), team('B', 1500), team('C', 1400), team('D', 1450)],
      predictions: {
        g1: game('g1', 'A', 'B', '2026-11-03'),
        g2: game('g2', 'C', 'A', '2026-11-05'),
        g3: game('g3', 'D', 'C', '2026-11-04'),
        old: game('old', 'A', 'D', '2026-11-01', true)
      },
      teamGames: { A: ['old', 'g1', 'g2'], B: ['g1'], C: ['g2', 'g3'], D: ['old', 'g3'] }
    } as unknown as Pick<LeagueModel, 'rankings' | 'teamGames' | 'predictions'>;
    // A plays B (1500) and C (1400): 1450. B plays A: 1600, the toughest. C: A and D, 1525. D: C, 1400.
    assert.deepEqual(scheduleStrength(model, 'A'), { average: 1450, games: 2, rank: 3, of: 4 });
    assert.deepEqual(scheduleStrength(model, 'B'), { average: 1600, games: 1, rank: 1, of: 4 });
    assert.equal(scheduleStrength(model, 'A', 1)?.average, 1500, 'only the next one');
    assert.equal(scheduleStrength({ ...model, teamGames: {} }, 'A'), null);
  });

  it('writes ranks as ordinals', () => {
    assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 30, 101, 111].map(ordinal), ['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '23rd', '30th', '101st', '111th']);
  });
});
