import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Play } from '../lib/gamecenter';
import { clockLeft, periodNumber, playFlow, turningPoints } from '../lib/model/turningPoints';

const play = (period: string, clock: string, away: number, home: number, text = `${away}-${home}`): Play => ({ period, clock, text, awayScore: away, homeScore: home, teamId: null, scoring: true });

describe('turning points', () => {
  it('reads period labels in each clock sport', () => {
    assert.equal(periodNumber('nba', 'Q3'), 3);
    assert.equal(periodNumber('nba', 'OT'), 5);
    assert.equal(periodNumber('nba', '2OT'), 6);
    assert.equal(periodNumber('nhl', 'P2'), 2);
    assert.equal(periodNumber('nhl', 'OT'), 4);
    assert.equal(periodNumber('mlb', '7'), null);
    assert.equal(periodNumber('nba', 'halftime'), null);
  });

  it('picks the plays that swung it most, late ones over early ones of the same size, in game order', () => {
    const plays = [
      play('Q1', '11:00', 0, 3, 'early three'),
      play('Q1', '10:30', 2, 3),
      play('Q4', '0:40', 2, 4, 'late two, ties nothing'),
      play('Q4', '0:20', 5, 4, 'late go-ahead three')
    ];
    const points = turningPoints('nba', 0.5, plays, 2);
    assert.deepEqual(
      points.map((p) => p.text),
      ['late two, ties nothing', 'late go-ahead three']
    );
    const [lateTwo, goAhead] = points;
    assert.ok(goAhead.before > 0.5 && goAhead.after < 0.5, `${goAhead.before} → ${goAhead.after}`);
    assert.equal(lateTwo.homeScored, true);
    assert.equal(goAhead.homeScored, false);
  });

  it('reads hockey’s play clock as time gone, and leaves a shootout out', () => {
    assert.equal(clockLeft('nhl', 2, '3:23'), '16:37');
    assert.equal(clockLeft('nhl', 4, '1:30'), '3:30', 'overtime is five minutes');
    assert.equal(clockLeft('nba', 2, '3:23'), '3:23', 'basketball counts down already');
    const plays = [
      play('P1', '2:00', 0, 1, 'early goal'),
      play('P3', '19:30', 1, 1, 'tying goal with 30 seconds left'),
      play('2OT', '0:00', 0, 1, 'shootout goal')
    ];
    const points = turningPoints('nhl', 0.5, plays);
    assert.deepEqual(
      points.map((p) => p.text),
      ['early goal', 'tying goal with 30 seconds left']
    );
    // Thirty seconds left, down one: tying it is worth far more than an early goal.
    const [early, tying] = points;
    assert.ok(Math.abs(tying.after - tying.before) > Math.abs(early.after - early.before) * 2);
  });

  it('places every scoring play on the game clock for the play-by-play chart', () => {
    const flow = playFlow('nba', 0.6, [play('Q1', '12:00', 0, 2), play('Q2', '6:00', 2, 2), play('Q4', '0:00', 2, 5), play('OT', '2:30', 4, 5)]);
    assert.deepEqual(
      flow.map((p) => [p.label, Number(p.x.toFixed(4))]),
      [
        ['Start', 0],
        ['Q1 12:00', 0],
        ['Q2 6:00', 0.375],
        ['Q4 0:00', 1],
        ['OT 2:30', 1.0521]
      ]
    );
    assert.equal(flow[0].homeProb, 0.6);
    // Up three with no time left in regulation: as good as won; the overtime point is past regulation's end.
    assert.ok(flow[3].homeProb > 0.95);
    assert.deepEqual(playFlow('mlb', 0.5, [play('7', '', 1, 0)]), []);
  });

  it('says nothing for baseball, and skips plays it can’t place', () => {
    assert.deepEqual(turningPoints('mlb', 0.5, [play('7', '', 1, 0)]), []);
    assert.deepEqual(turningPoints('nba', 0.5, [play('', '', 0, 2)]), []);
  });
});
