import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { picksShareCode, readPicksShare } from '../lib/picksShare';
import { isKnownPage } from '../lib/routes';

describe('shared pick’em records', () => {
  it('round-trips a record and the model’s', () => {
    const score = { yours: { won: 12, lost: 8 }, model: { won: 11, lost: 9 } };
    assert.equal(picksShareCode(score), '12-8-11-9');
    assert.deepEqual(readPicksShare('12-8-11-9'), score);
  });

  it('refuses anything that isn’t two records over the same games', () => {
    for (const bad of ['12-8-11-8', '0-0-0-0', '1-2-3', 'a-b-c-d', '12-8-11-9-1', '-1-8-11-9', '99999-1-99999-1', '<script>']) {
      assert.equal(readPicksShare(bad), null, bad);
    }
  });

  it('is a page the proxy lets through, with its preview image', () => {
    assert.ok(isKnownPage('/picks'));
    assert.ok(isKnownPage('/picks/s/12-8-11-9'));
    assert.ok(isKnownPage('/picks/s/12-8-11-9/opengraph-image'));
    assert.ok(!isKnownPage('/picks/x/12-8-11-9'));
    assert.ok(!isKnownPage('/picks/s/1/2/3'));
  });
});
