import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { dueForIndexNow, indexNowKey, submitIndexNow } from '../lib/indexnow';

describe('IndexNow', () => {
  const now = Date.parse('2026-11-17T12:00:00Z');
  const day = 86_400_000;

  it('sends new pages and ones not sent for a week, once each, up to a limit', () => {
    const sent = { 'https://x.test/a': now - day, 'https://x.test/b': now - 8 * day };
    assert.deepEqual(dueForIndexNow(['https://x.test/a', 'https://x.test/b', 'https://x.test/c', 'https://x.test/c'], sent, now), ['https://x.test/b', 'https://x.test/c']);
    assert.equal(dueForIndexNow(Array.from({ length: 5_000 }, (_, i) => `https://x.test/${i}`), {}, now).length, 2_000);
  });

  it('publishes a key the search engines can check', () => {
    assert.match(indexNowKey(), /^[a-zA-Z0-9-]{8,128}$/);
  });

  it('never submits from a laptop, a test copy or plain HTTP', async () => {
    assert.equal(await submitIndexNow(['http://localhost:3000/'], 'http://localhost:3000'), 'IndexNow: off here');
    assert.equal(await submitIndexNow(['https://127.0.0.1/'], 'https://127.0.0.1'), 'IndexNow: off here');
    assert.equal(await submitIndexNow([], ''), 'IndexNow: no SITE_URL');
  });
});
