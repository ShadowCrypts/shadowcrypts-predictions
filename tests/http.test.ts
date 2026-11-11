import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { json, send } from '../lib/http';

const asking = (encoding?: string) => new Request('http://localhost/api/x', { headers: encoding === undefined ? {} : { 'accept-encoding': encoding } });
const big = { rows: Array.from({ length: 500 }, (_, i) => ({ id: i, name: `Player ${i}`, team: 'LAL' })) };

describe('API responses', () => {
  it('sends JSON as it is, for Next.js to compress (since 16.4.5 it drops a route’s own Content-Encoding)', async () => {
    const response = await json(asking('gzip, br'), big, { headers: { 'cache-control': 'no-store' } });
    assert.equal(response.headers.get('content-encoding'), null);
    assert.equal(response.headers.get('content-type'), 'application/json');
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), big);
  });

  it('keeps the status and headers it was given', async () => {
    const created = await json(asking(), { ok: true }, { status: 201 });
    assert.equal(created.status, 201);
    assert.deepEqual(await created.json(), { ok: true });

    const text = 'BEGIN:VCALENDAR\r\n'.repeat(200);
    const calendar = await send(asking('gzip'), text, { status: 200, headers: { 'content-type': 'text/calendar; charset=utf-8' } });
    assert.equal(calendar.headers.get('content-type'), 'text/calendar; charset=utf-8');
    assert.equal(calendar.headers.get('content-encoding'), null);
    assert.equal(await calendar.text(), text);
  });
});
