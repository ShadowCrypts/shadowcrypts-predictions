import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { withReadings } from '../lib/model/oddsHistory';

describe('playoff odds history', () => {
  it('keeps one reading per team per day, the latest, in date order', () => {
    let h = withReadings({}, '2026-27', '2026-11-02', [{ id: 'A', playoffs: 0.5, title: 0.04 }]);
    h = withReadings(h, '2026-27', '2026-11-03', [{ id: 'A', playoffs: 0.55, title: 0.05 }]);
    h = withReadings(h, '2026-27', '2026-11-03', [{ id: 'A', playoffs: 0.6123456, title: 0.06 }]);
    assert.deepEqual(h['2026-27'].A, [
      { date: '2026-11-02', playoffs: 0.5, title: 0.04 },
      { date: '2026-11-03', playoffs: 0.6123, title: 0.06 }
    ]);
  });

  it('keeps only the latest two seasons', () => {
    let h = withReadings({}, '2024-25', '2025-01-01', [{ id: 'A', playoffs: 0.5, title: 0 }]);
    h = withReadings(h, '2025-26', '2026-01-01', [{ id: 'A', playoffs: 0.5, title: 0 }]);
    h = withReadings(h, '2026-27', '2026-11-01', [{ id: 'A', playoffs: 0.5, title: 0 }]);
    assert.deepEqual(Object.keys(h), ['2025-26', '2026-27']);
  });
});
