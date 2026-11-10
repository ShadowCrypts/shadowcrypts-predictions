import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { boxesToFetch, fillMonth, parseRoster, REREAD_WINDOW_MS, SETTLE_MS } from '../lib/boxscores';
import type { Game } from '../lib/espn';

const NOW = Date.parse('2026-11-04T12:00:00Z');
const HOUR = 3_600_000;
const game = (id: string, age: number) => ({ id, date: new Date(NOW - age).toISOString() }) as Game;
const fresh = game('fresh', 10 * HOUR);
const ripe = game('ripe', SETTLE_MS + HOUR);
const old = game('old', REREAD_WINDOW_MS + HOUR);

/** An in-memory stand-in for the disk store, starting from `seed`. */
function memory(seed: Record<string, unknown> = {}) {
  const files = new Map(Object.entries(seed));
  return {
    files,
    read: async <V,>(k: string) => (files.get(k) as V) ?? null,
    write: async <V,>(k: string, v: V) => void files.set(k, v)
  };
}

describe('reading a roster', () => {
  it('finds the players in a flat list (NBA) and in position groups (NFL, NHL)', () => {
    const player = (id: string) => ({ id, displayName: `P${id}` });
    assert.deepEqual(parseRoster({ athletes: [player('1'), player('2')] }).map((p) => p.id), ['1', '2']);
    // Grouped rosters came back empty once, which quietly switched off every check that relies on them.
    const grouped = { athletes: [{ position: 'offense', items: [player('1'), player('2')] }, { position: 'defense', items: [player('3')] }] };
    assert.deepEqual(parseRoster(grouped), [{ id: '1', name: 'P1' }, { id: '2', name: 'P2' }, { id: '3', name: 'P3' }]);
    assert.deepEqual(parseRoster({}), []);
  });
});

describe('re-reading box scores once scorers have settled them', () => {
  it('fetches games never stored, then stored ones read too early, but not settled or very old ones', () => {
    const games = [fresh, ripe, old, game('done', SETTLE_MS * 2), game('new', 5 * HOUR)];
    const store = { fresh: {}, ripe: {}, old: {}, done: {} };
    const { missing, unsettled } = boxesToFetch(games, store, { done: true }, 10, NOW);
    assert.deepEqual(missing.map((g) => g.id), ['new']);
    // Not "fresh": it can still change, so it waits. Not "done": already read once settled. Not "old": filled long after it ended.
    assert.deepEqual(unsettled.map((g) => g.id), ['ripe']);
  });

  it('spends the budget on missing games first, and fetches nothing at a budget of zero', () => {
    const games = [ripe, game('new1', HOUR), game('new2', 2 * HOUR)];
    const store = { ripe: {} };
    assert.deepEqual(boxesToFetch(games, store, {}, 2, NOW).unsettled, []);
    assert.equal(boxesToFetch(games, store, {}, 2, NOW).missing.length, 2);
    assert.equal(boxesToFetch(games, store, {}, 3, NOW).unsettled.length, 1);
    const none = boxesToFetch(games, store, {}, 0, NOW);
    assert.deepEqual([none.missing.length, none.unsettled.length], [0, 0]);
  });

  it('replaces a stored box with the corrected one, and settles it so it is read only once', async () => {
    const io = memory({ k: { ripe: { ast: 4 } } });
    let reads = 0;
    const load = async () => {
      reads += 1;
      return { ast: 3 };
    };
    const first = await fillMonth('k', [ripe], 10, load, NOW, io);
    assert.deepEqual(first.store.ripe, { ast: 3 });
    assert.equal(first.spent, 1);
    const second = await fillMonth('k', [ripe], 10, load, NOW, io);
    assert.deepEqual([reads, second.spent], [1, 0]);
  });

  it('never wipes a good copy when the second read comes back empty, and tries again', async () => {
    const io = memory({ k: { ripe: { ast: 4 } } });
    const { store } = await fillMonth('k', [ripe], 10, async () => null, NOW, io);
    assert.deepEqual(store.ripe, { ast: 4 });
    assert.equal(io.files.get('k-settled') && (io.files.get('k-settled') as Record<string, true>).ripe, undefined);
    const again = await fillMonth('k', [ripe], 10, async () => ({ ast: 3 }), NOW, io);
    assert.deepEqual(again.store.ripe, { ast: 3 });
  });

  it('keeps the old copy when the read fails outright', async () => {
    const io = memory({ k: { ripe: { ast: 4 } } });
    const { store } = await fillMonth('k', [ripe], 10, async () => Promise.reject(new Error('feed down')), NOW, io);
    assert.deepEqual(store.ripe, { ast: 4 });
    assert.equal(boxesToFetch([ripe], store, (io.files.get('k-settled') as Record<string, true>) ?? {}, 1, NOW).unsettled.length, 1);
  });

  it('stores a game fetched early but leaves it to be read again; a game fetched late is settled at once', async () => {
    const io = memory();
    const { store } = await fillMonth('k', [fresh, ripe], 10, async (g) => ({ id: g.id }), NOW, io);
    assert.deepEqual(Object.keys(store).sort(), ['fresh', 'ripe']);
    assert.deepEqual(io.files.get('k-settled'), { ripe: true });
  });

  it('settles a game ESPN has no box score for, so it stops asking', async () => {
    const io = memory({ k: { ripe: null } });
    let reads = 0;
    const load = async () => {
      reads += 1;
      return null;
    };
    await fillMonth('k', [ripe], 10, load, NOW, io);
    await fillMonth('k', [ripe], 10, load, NOW, io);
    assert.equal(reads, 1);
  });
});
