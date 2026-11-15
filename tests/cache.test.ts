import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { cached, MEMORY_LIMIT, memoryEntries } from '../lib/cache';

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('cache', () => {
  it('holds at most MEMORY_LIMIT entries, letting the least recently used go (an old-game crawl can’t fill memory)', async () => {
    let loads = 0;
    const hot = () => cached('lru-hot', { ttlMs: 60_000 }, async () => ++loads);
    await hot();
    for (let i = 0; i < MEMORY_LIMIT + 300; i += 1) {
      await cached(`lru-game-${i}`, { ttlMs: 60_000 }, async () => i);
      // Something the site uses all the time stays: each use makes it the most recent again.
      if (i % 200 === 0) await hot();
    }
    assert.ok(memoryEntries() <= MEMORY_LIMIT, `${memoryEntries()} entries`);
    await hot();
    assert.equal(loads, 1, 'the busy entry never had to load again');
    // The first of the crawl went; asked for again, it simply loads again.
    assert.equal(await cached('lru-game-0', { ttlMs: 60_000 }, async () => 'again'), 'again');
  });

  it('serves an expired copy instantly and rebuilds in the background', async () => {
    let builds = 0;
    const load = async () => {
      builds += 1;
      await wait(30);
      return builds;
    };
    const options = { ttlMs: 150, staleWhileRevalidate: true };
    assert.equal(await cached('swr-test', options, load), 1);
    await wait(180);
    const started = Date.now();
    assert.equal(await cached('swr-test', options, load), 1, 'the stale copy comes back first');
    assert.ok(Date.now() - started < 25, 'without waiting for the rebuild');
    await wait(80);
    assert.equal(await cached('swr-test', options, load), 2, 'then the rebuilt one');
    assert.equal(builds, 2);
  });

  it('waits for a rebuild when asked for a fresh copy', async () => {
    let builds = 0;
    const load = async () => ++builds;
    await cached('fresh-test', { ttlMs: 10 }, load);
    await wait(20);
    assert.equal(await cached('fresh-test', { ttlMs: 10, staleWhileRevalidate: false }, load), 2);
  });

  it('shares one in-flight build between callers', async () => {
    let builds = 0;
    const load = async () => {
      builds += 1;
      await wait(20);
      return builds;
    };
    const [a, b] = await Promise.all([cached('dedupe-test', { ttlMs: 1000 }, load), cached('dedupe-test', { ttlMs: 1000 }, load)]);
    assert.equal(a, 1);
    assert.equal(b, 1);
    assert.equal(builds, 1);
  });
});
