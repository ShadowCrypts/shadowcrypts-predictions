import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { LEG_FETCHES } from '../lib/model/legResults';
import { isRecentGame, SWEAT_MAX_GAMES, SWEAT_WINDOW_MS } from '../lib/model/sweat';

describe('play-by-play on demand stays bounded', () => {
  const now = Date.parse('2026-11-15T12:00:00Z');

  it('replays only games from the last three days', () => {
    assert.equal(isRecentGame('2026-11-15T00:30:00Z', now), true);
    assert.equal(isRecentGame('2026-11-12T13:00:00Z', now), true);
    assert.equal(isRecentGame(new Date(now - SWEAT_WINDOW_MS - 1).toISOString(), now), false);
    // Last season's games, which anyone could otherwise ask for by the thousand.
    assert.equal(isRecentGame('2025-03-02T00:00:00Z', now), false);
    assert.equal(isRecentGame('2027-01-01T00:00:00Z', now), false);
    assert.equal(isRecentGame('not a date', now), false);
  });

  it('caps how many games and box scores one request can make the server read', () => {
    assert.equal(SWEAT_MAX_GAMES, 12);
    assert.equal(LEG_FETCHES, 12);
  });
});
