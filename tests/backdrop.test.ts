import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

// The backdrop images have each theme's background and faintest text color baked in (scripts/make-backdrop.mjs).
// If the theme changes and the images don't, the edges show and the contrast promise no longer holds.
const root = path.resolve(__dirname, '..');
const css = readFileSync(path.join(root, 'app', 'styles', 'globals.css'), 'utf8');
const script = readFileSync(path.join(root, 'scripts', 'make-backdrop.mjs'), 'utf8');

const themeBlock = (selector: string) => {
  const at = css.indexOf(selector);
  return css.slice(at, css.indexOf('}', at));
};
const token = (block: string, name: string) => block.match(new RegExp(`--${name}:\\s*(\\d+) (\\d+) (\\d+);`))?.slice(1).map(Number);
const baked = (theme: string, key: string) => script.match(new RegExp(`${theme}: \\{[^}]*${key}: \\[(\\d+), (\\d+), (\\d+)\\]`))?.slice(1).map(Number);

describe('the backdrop matches the theme it was baked for', () => {
  for (const [theme, selector] of [
    ['dark', ":root[data-theme='dark']"],
    ['light', ":root[data-theme='light']"]
  ] as const) {
    it(`${theme}: background and faintest text as in the stylesheet`, () => {
      const block = themeBlock(selector);
      assert.deepEqual(baked(theme, 'bg'), token(block, 'bg'));
      assert.deepEqual(baked(theme, 'ink3'), token(block, 'ink-3'));
    });
  }

  it('has every file the stylesheet asks for', () => {
    const files = [...css.matchAll(/url\('\/(backdrop-[a-z-]+\.webp)'\)/g)].map((m) => m[1]);
    assert.equal(files.length, 4);
    for (const file of files) assert.ok(existsSync(path.join(root, 'public', file)), file);
  });
});
