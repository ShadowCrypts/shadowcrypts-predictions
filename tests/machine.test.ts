import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { biggestMoves, decodePicks, encodePicks, homeChance, Picks, runTheTable, togglePick, withoutTeam } from '../lib/model/machine';

const games = [
  { id: '100', homeId: 'A', awayId: 'B' },
  { id: '101', homeId: 'C', awayId: 'A' },
  { id: '102', homeId: 'C', awayId: 'B' }
];

describe('playoff machine picks', () => {
  it('survive a trip through the address, whatever order they were made in', () => {
    const picks: Picks = { '101': 'away', '100': 'home' };
    assert.equal(encodePicks(picks), '100h.101a');
    assert.deepEqual(decodePicks('100h.101a', games), { '100': 'home', '101': 'away' });
    assert.equal(encodePicks({}), '');
  });

  it('drop whatever an address has that is not a game still to play', () => {
    // A finished game, nonsense, and a script: none of it gets through.
    assert.deepEqual(decodePicks('999h.100a.junk.<script>.101x.', games), { '100': 'away' });
    assert.deepEqual(decodePicks(null, games), {});
    assert.deepEqual(decodePicks('', games), {});
  });

  it('switch on a tap, and clear on a second tap of the same side', () => {
    let picks = togglePick({}, '100', 'home');
    assert.deepEqual(picks, { '100': 'home' });
    picks = togglePick(picks, '100', 'away');
    assert.deepEqual(picks, { '100': 'away' });
    assert.deepEqual(togglePick(picks, '100', 'away'), {});
  });

  it('decide every game a team has left, whichever side it is on, and undo them', () => {
    const won = runTheTable({ '102': 'home' }, games, 'A', true);
    assert.deepEqual(won, { '100': 'home', '101': 'away', '102': 'home' });
    assert.deepEqual(runTheTable({}, games, 'A', false), { '100': 'away', '101': 'home' });
    assert.deepEqual(withoutTeam(won, games, 'A'), { '102': 'home' });
  });
});

describe('reading a scenario', () => {
  it('turns an Elo gap into the home team\'s chance', () => {
    assert.equal(homeChance(0), 0.5);
    assert.ok(Math.abs(homeChance(100) - 0.64) < 0.001);
    assert.ok(Math.abs(homeChance(-100) - 0.36) < 0.001);
  });

  it('names the biggest moves first and ignores what could be chance', () => {
    const before = [{ id: 'A', playoffs: 0.5 }, { id: 'B', playoffs: 0.5 }, { id: 'C', playoffs: 0.5 }];
    const after = [{ id: 'A', playoffs: 0.55 }, { id: 'B', playoffs: 0.3 }, { id: 'C', playoffs: 0.505 }];
    assert.deepEqual(biggestMoves(before, after), [{ id: 'B', from: 0.5, to: 0.3 }, { id: 'A', from: 0.5, to: 0.55 }]);
  });
});
