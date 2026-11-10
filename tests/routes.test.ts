import assert from 'node:assert/strict';
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { isKnownPage } from '../lib/routes';

/** Every page and image route in app/, as a sample address (dynamic segments filled with real-looking values). */
function routes(dir = path.join(process.cwd(), 'app'), prefix = ''): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === 'api' || name === 'components' || name === 'styles' || name.startsWith('.') || name.startsWith('(')) continue;
      const segment = name === '[league]' ? 'nba' : name === '[code]' ? 'w~nba~401~2' : name === '[size]' ? '192' : /^\[.+\]$/.test(name) ? '401909877' : name;
      out.push(...routes(full, `${prefix}/${segment}`));
    } else if (/^page\.tsx$/.test(name)) out.push(prefix || '/');
    else if (/^(route\.tsx?|opengraph-image\.tsx)$/.test(name)) out.push(`${prefix}${name.startsWith('opengraph') ? '/opengraph-image' : ''}`);
    else if (/^(icon|apple-icon|opengraph-image)\.tsx?$/.test(name)) out.push(`${prefix}/${name.replace(/\.tsx?$/, '')}`);
  }
  return out;
}

describe('known page addresses', () => {
  it('include every page and image route in the app folder', () => {
    const all = routes();
    assert.ok(all.length >= 20, `found ${all.length} routes`);
    for (const route of all) assert.ok(isKnownPage(route), `${route} should be a known page`);
  });

  it('refuse everything else before the app runs', () => {
    for (const junk of ['/zzz', '/wp-admin', '/wp-login', '/nba/game/abc', '/nba/game/1/extra', '/xyz/team/1', '/nba/coach/1', '/nba/players/1', '/parlay/x', '/live/now', '/nba/game/1234567890123456'])
      assert.equal(isKnownPage(junk), false, junk);
    // Build output, dev tooling, the API and well-known files are never the proxy's to refuse.
    for (const pass of ['/', '/_next/webpack-hmr', '/__nextjs_original-stack-frames', '/api/anything', '/.well-known/security.txt']) assert.equal(isKnownPage(pass), true, pass);
  });
});
