import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { hitRate } from '../lib/model/hitRate';

describe('hit rates', () => {
  it('counts the latest games over the line, newest first', () => {
    assert.deepEqual(hitRate([30, 20, 26, 31, 18], 25.5, 10), { hits: 3, n: 5, marks: [true, false, true, true, false] });
    assert.deepEqual(hitRate([30, 20, 26, 31, 18], 25.5, 3), { hits: 2, n: 3, marks: [true, false, true] });
  });

  it('skips games without the stat and pushes on a whole-number line', () => {
    assert.deepEqual(hitRate([undefined, 4, 3, undefined, 5], 4, 10), { hits: 1, n: 2, marks: [false, true] });
  });

  it('is null with nothing to count', () => {
    assert.equal(hitRate([], 10.5, 10), null);
    assert.equal(hitRate([undefined, 2], 2, 10), null);
  });
});
