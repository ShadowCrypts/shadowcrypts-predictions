import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { cached } from '../lib/cache';

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('cache', () => {
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
