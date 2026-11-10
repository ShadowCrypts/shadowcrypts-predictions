import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';
import { json, pickEncoding, send } from '../lib/http';

const asking = (encoding?: string) => new Request('http://localhost/api/x', { headers: encoding === undefined ? {} : { 'accept-encoding': encoding } });
const big = { rows: Array.from({ length: 500 }, (_, i) => ({ id: i, name: `Player ${i}`, team: 'LAL' })) };

describe('compressed responses', () => {
  it('picks brotli, then gzip, from what the browser accepts', () => {
    assert.equal(pickEncoding('gzip, deflate, br, zstd'), 'br');
    assert.equal(pickEncoding('gzip, deflate'), 'gzip');
    assert.equal(pickEncoding('br;q=0, gzip;q=0.8'), 'gzip');
    assert.equal(pickEncoding('*'), 'br');
    assert.equal(pickEncoding('*;q=0'), null);
    assert.equal(pickEncoding('identity'), null);
    assert.equal(pickEncoding(''), null);
    assert.equal(pickEncoding(null), null);
  });

  it('sends JSON compressed when it can, and the same JSON comes back out', async () => {
    const br = await json(asking('gzip, br'), big, { headers: { 'cache-control': 'no-store' } });
    assert.equal(br.headers.get('content-encoding'), 'br');
    assert.equal(br.headers.get('content-type'), 'application/json');
    assert.equal(br.headers.get('cache-control'), 'no-store');
    assert.match(br.headers.get('vary') ?? '', /accept-encoding/i);
    const packed = Buffer.from(await br.arrayBuffer());
    assert.ok(packed.length < JSON.stringify(big).length / 4, `${packed.length} bytes`);
    assert.deepEqual(JSON.parse(brotliDecompressSync(packed).toString()), big);

    const gz = await json(asking('gzip'), big);
    assert.equal(gz.headers.get('content-encoding'), 'gzip');
    assert.deepEqual(JSON.parse(gunzipSync(Buffer.from(await gz.arrayBuffer())).toString()), big);
  });

  it('leaves small bodies and clients that ask for nothing alone', async () => {
    const small = await json(asking('br'), { ok: true });
    assert.equal(small.headers.get('content-encoding'), null);
    assert.deepEqual(await small.json(), { ok: true });

    const plain = await json(asking(), big, { status: 201 });
    assert.equal(plain.headers.get('content-encoding'), null);
    assert.equal(plain.status, 201);
    assert.deepEqual(await plain.json(), big);
  });

  it('keeps the status and headers of text responses', async () => {
    const text = 'BEGIN:VCALENDAR\r\n'.repeat(200);
    const response = await send(asking('gzip'), text, { status: 200, headers: { 'content-type': 'text/calendar; charset=utf-8' } });
    assert.equal(response.headers.get('content-type'), 'text/calendar; charset=utf-8');
    assert.equal(gunzipSync(Buffer.from(await response.arrayBuffer())).toString(), text);
  });
});
