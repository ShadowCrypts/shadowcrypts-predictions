import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readCapped } from '../lib/http';
import { addressKey, clientKey, contentSecurityPolicy, fromOwnPages, isCostlyImage, makeNonce, RateLimiter } from '../lib/security';

describe('content security policy', () => {
  it('lets scripts run only from the site or with the page’s nonce', () => {
    const policy = contentSecurityPolicy({ nonce: 'abc123' });
    const script = policy.split('; ').find((d) => d.startsWith('script-src '))!;
    assert.equal(script, "script-src 'self' 'nonce-abc123' 'strict-dynamic'");
    assert.ok(!policy.includes('unsafe-eval'));
    assert.ok(policy.includes("style-src 'self' 'nonce-abc123'"));
    for (const d of ["frame-ancestors 'none'", "object-src 'none'", "base-uri 'self'", "form-action 'self'"]) assert.ok(policy.includes(d), d);
    // Plain HTTP (local, Tailscale) must not be told to upgrade everything.
    assert.ok(!policy.includes('upgrade-insecure-requests'));
    assert.ok(contentSecurityPolicy({ nonce: 'x', https: true }).includes('upgrade-insecure-requests'));
    // Anything it blocks gets reported to the site's own endpoint.
    assert.ok(policy.includes('report-uri /api/csp-report') && policy.includes('report-to csp'));
  });

  it('loosens only what the dev server needs in development', () => {
    const policy = contentSecurityPolicy({ nonce: 'n', dev: true });
    assert.ok(policy.includes("'unsafe-eval'"));
    assert.ok(policy.includes("style-src 'self' 'unsafe-inline'"));
  });

  it('makes a different 128-bit nonce every time', () => {
    const a = makeNonce();
    assert.equal(Buffer.from(a, 'base64').length, 16);
    assert.notEqual(a, makeNonce());
  });
});

describe('rate limits', () => {
  it('allows the limit per window, then refuses until the window turns over', () => {
    const limiter = new RateLimiter(3, 60_000);
    const results = [0, 1, 2, 3].map(() => limiter.take('a', 1_000).ok);
    assert.deepEqual(results, [true, true, true, false]);
    assert.equal(limiter.take('b', 1_000).ok, true, 'other clients have their own count');
    const late = limiter.take('a', 30_000);
    assert.equal(late.ok, false);
    assert.equal(late.resetSeconds, 31);
    assert.equal(limiter.take('a', 61_000).ok, true);
  });

  it('never grows past its key cap', () => {
    const limiter = new RateLimiter(1, 60_000, 100);
    for (let i = 0; i < 1_000; i += 1) limiter.take(`client-${i}`, 5);
    assert.ok((limiter as unknown as { hits: Map<string, unknown> }).hits.size <= 100);
  });

  it("can't be reset by flooding it with new addresses: a refused client stays refused", () => {
    const limiter = new RateLimiter(5, 60_000, 100);
    for (let i = 0; i < 8; i += 1) limiter.take('attacker', 1_000);
    assert.equal(limiter.take('attacker', 1_000).ok, false);
    // 5,000 one-off addresses (an IPv6 block's worth of /64s) fill the table fifty times over...
    for (let i = 0; i < 5_000; i += 1) limiter.take(`2001:db8:${i}::/64`, 2_000);
    // ...and the busy one is still counted and still refused within its window.
    assert.equal(limiter.take('attacker', 3_000).ok, false);
    // A regular visitor partway through their minute isn't the first to go either.
    const fresh = new RateLimiter(5, 60_000, 100);
    fresh.take('regular', 1_000);
    fresh.take('regular', 1_000);
    for (let i = 0; i < 500; i += 1) fresh.take(`one-off-${i}`, 2_000);
    assert.equal(fresh.take('regular', 3_000).remaining, 2);
  });
});

describe('request bodies and origins', () => {
  /** A request whose body streams in pieces, with no declared length (as a chunked upload arrives). */
  const streamed = (pieces: number, size: number) =>
    new Request('http://local/x', {
      method: 'POST',
      body: new ReadableStream({
        start(controller) {
          for (let i = 0; i < pieces; i += 1) controller.enqueue(new Uint8Array(size).fill(97));
          controller.close();
        }
      }),
      duplex: 'half'
    } as RequestInit);

  it('reads a body only up to its cap, declared length or not', async () => {
    assert.equal(await readCapped(new Request('http://local/x', { method: 'POST', body: '{"a":1}' }), 100), '{"a":1}');
    assert.equal(await readCapped(streamed(4, 1_000), 10_000), 'a'.repeat(4_000));
    assert.equal(await readCapped(streamed(1_000, 64 * 1024), 32_768), null, 'a 64 MB stream is refused after the first piece');
    assert.equal(await readCapped(new Request('http://local/x', { method: 'POST', body: 'x', headers: { 'content-length': '999999' } }), 100), null);
  });

  it('takes state-changing JSON only from the site’s own pages', () => {
    const h = (o: Record<string, string>) => new Headers({ 'content-type': 'application/json', host: 'localhost:3000', ...o });
    assert.equal(fromOwnPages(h({ origin: 'http://localhost:3000' })), true);
    assert.equal(fromOwnPages(h({})), true, 'programs that send no Origin');
    assert.equal(fromOwnPages(h({ origin: 'https://evil.example' })), false);
    assert.equal(fromOwnPages(h({ origin: 'http://localhost:3000', 'content-type': 'text/plain' })), false, 'form posts can’t pose as JSON');
    // Behind a reverse proxy the Host header names the server; the public address still counts.
    assert.equal(fromOwnPages(h({ origin: 'https://picks.example.com', host: '127.0.0.1:3000' }), 'https://picks.example.com'), true);
    assert.equal(fromOwnPages(h({ origin: 'https://evil.example', host: '127.0.0.1:3000' }), 'https://picks.example.com'), false);
  });

  it('counts images drawn on request as costly', () => {
    assert.equal(isCostlyImage('/nba/game/1/opengraph-image'), true);
    assert.equal(isCostlyImage('/brand-icon/512'), true);
    assert.equal(isCostlyImage('/nba/game/1'), false);
  });
});

describe('client keys', () => {
  const h = (xff?: string) => new Headers(xff === undefined ? {} : { 'x-forwarded-for': xff });

  it('reads the address the server filled in, or the proxy’s when one is trusted', () => {
    assert.equal(clientKey(h()), 'unknown');
    assert.equal(clientKey(h('203.0.113.9')), '203.0.113.9');
    // One trusted proxy appended the real address; whatever the client claimed before it is ignored.
    assert.equal(clientKey(h('6.6.6.6, 203.0.113.9'), 1), '203.0.113.9');
    assert.equal(clientKey(h('6.6.6.6, 198.51.100.4, 10.0.0.2'), 2), '198.51.100.4');
    assert.equal(clientKey(h('203.0.113.9'), 3), '203.0.113.9');
  });

  it('counts an IPv6 visitor by their /64, so rotating addresses inside it gains nothing', () => {
    assert.equal(addressKey('2001:db8:1:2:aaaa:bbbb:cccc:dddd'), '2001:db8:1:2::/64');
    assert.equal(addressKey('2001:db8:1:2::1'), '2001:db8:1:2::/64');
    assert.equal(addressKey('2001:DB8:0001:0002:0:0:0:ffff'), '2001:db8:1:2::/64');
    assert.equal(addressKey('2001:db8::1'), '2001:db8:0:0::/64');
    assert.equal(addressKey('::1'), '0:0:0:0::/64');
    assert.equal(addressKey('[2001:db8:1:2::5]:443'), '2001:db8:1:2::/64');
    assert.equal(addressKey('fe80::1%eth0'), 'fe80:0:0:0::/64');
    // IPv4, IPv4 written as IPv6, and anything that isn't an address, as they are.
    assert.equal(addressKey('203.0.113.9'), '203.0.113.9');
    assert.equal(addressKey('::ffff:203.0.113.9'), '203.0.113.9');
    assert.equal(addressKey('not:an:address'), 'not:an:address');
    assert.equal(addressKey('unknown'), 'unknown');
    // Through the proxy chain too.
    assert.equal(clientKey(h('6.6.6.6, 2001:db8:1:2:dead:beef:0:1, 172.70.0.1'), 2), '2001:db8:1:2::/64');
  });
});
