import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { LeagueModel } from '../lib/model';
import type { CardData } from '../lib/model/card';
import { dayComeback, dayHighlights } from '../lib/model/results';

const card = (id: string, pickProb: number, correct: boolean | null, completed = true) => ({ id, pickProb, correct, completed }) as CardData;

describe('day highlights', () => {
  it('finds the biggest upset and the most confident call', () => {
    const { upset, surest } = dayHighlights([card('a', 0.62, false), card('b', 0.81, false), card('c', 0.9, true), card('d', 0.95, null, false)]);
    assert.equal(upset?.id, 'b', 'the miss where the winner had the lowest chance');
    assert.equal(surest?.id, 'c', 'unfinished games are not graded yet');
  });

  it("doesn't show the same game twice", () => {
    const { upset, surest } = dayHighlights([card('a', 0.85, false), card('b', 0.6, true)]);
    assert.equal(upset?.id, 'a');
    assert.equal(surest, null);
  });

  it("doesn't call a near coin flip an upset", () => {
    const { upset, surest } = dayHighlights([card('a', 0.53, false), card('b', 0.7, true)]);
    assert.equal(upset, null);
    assert.equal(surest?.id, 'b');
  });

  it('has nothing to say before any game is final', () => {
    assert.deepEqual(dayHighlights([card('a', 0.7, null, false)]), { upset: null, surest: null });
  });

  it('finds the comeback: the winner that was furthest down at a checkpoint', () => {
    // Two NBA finals from even: one where the home side trailed by 20 after three and won, one never close to a hole.
    const finished = (id: string, home: number[], away: number[]) => {
      const game = {
        id,
        league: 'nba',
        state: 'post',
        completed: true,
        home: { score: home.reduce((a, b) => a + b, 0), periods: home },
        away: { score: away.reduce((a, b) => a + b, 0), periods: away }
      };
      return { card: { id, league: 'nba', completed: true, home: game.home, away: game.away } as unknown as CardData, prediction: { game, homeProb: 0.5 } };
    };
    const rally = finished('rally', [20, 20, 20, 45], [27, 27, 26, 20]);
    const cruise = finished('cruise', [30, 30, 30, 20], [20, 20, 20, 30]);
    const models = [{ league: 'nba', predictions: { rally: rally.prediction, cruise: cruise.prediction } }] as unknown as LeagueModel[];
    const best = dayComeback(models, [cruise.card, rally.card]);
    assert.equal(best?.card.id, 'rally');
    assert.equal(best?.at, 'Q3');
    assert.ok(best!.low < 0.1, String(best!.low));
    assert.equal(dayComeback(models, [cruise.card]), null, 'no hole, no comeback');
  });
});
