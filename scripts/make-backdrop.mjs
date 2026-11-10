// The site backdrop from the owner's 1920x1080 ShadowCrypt image (all rights reserved: see ARTWORK.md), baked per theme: blended onto that theme's own
// background color at the strongest level where the site's faintest small text (ink-3) still clears WCAG AA (4.5:1)
// on every pixel. Dark: highlights capped, then lightened onto the dark background (screen). Light: each mark drawn
// in a deeper shade of its own color, as strongly as it was bright. Wide for landscape screens, a tall crop for phones.
//
//   node scripts/make-backdrop.mjs 0.06            writes public/backdrop-*.webp (0.06 is the highlight cap in use)
//   node scripts/make-backdrop.mjs 0.04 try        writes previews to .cache/backdrop-preview/ to compare first
//
// If the theme colors in app/styles/globals.css change, change THEMES here to match and run it again: the images
// carry those colors baked in. Sharp comes with Next.js.
import { mkdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, '$1')), '..');
const require = createRequire(path.join(root, 'package.json'));
const sharp = require('sharp');
const source = path.join(root, 'assets', 'shadowcrypt-backdrop-source.webp');
const out = process.argv[3] ? path.join(root, '.cache', 'backdrop-preview') : path.join(root, 'public');
mkdirSync(out, { recursive: true });

const THEMES = {
  dark: { bg: [8, 7, 14], ink3: [146, 140, 170], blend: 'screen' },
  light: { bg: [246, 245, 251], ink3: [100, 94, 124], blend: 'ink' }
};
const TARGET = 4.6;

const lin = (c) => ((c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const ratio = (a, b) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);

/** A deeper shade of a pixel's own color: what it's drawn in on light paper. */
function inkOf(px) {
  const l = lum(px);
  if (l <= 0) return [0, 0, 0];
  const scale = 0.12 / l;
  return px.map((c) => unlin(Math.min(1, lin(c) * scale)));
}

/** One pixel of the image on a theme's background at strength `o` (browser-style, in sRGB). */
function blend(theme, px, o) {
  const { bg, blend: mode } = THEMES[theme];
  if (mode === 'ink') {
    // Light: drawn in ink, as much as the pixel was bright.
    const weight = (o * Math.max(...px)) / 255;
    const ink = inkOf(px);
    return bg.map((b, i) => Math.round(b + weight * (ink[i] - b)));
  }
  return bg.map((b, i) => {
    const p = px[i] / 255;
    const base = b / 255;
    const mixed = mode === 'screen' ? 1 - (1 - base) * (1 - p) : base * p;
    return Math.round((base + o * (mixed - base)) * 255);
  });
}


/** The strongest strength where ink-3 clears the target on the worst pixel. */
function strongest(theme, data) {
  let lo = 0;
  let hi = 1;
  for (let step = 0; step < 18; step += 1) {
    const o = (lo + hi) / 2;
    let worst = Infinity;
    for (let i = 0; i < data.length; i += 3 * 7) worst = Math.min(worst, ratio(THEMES[theme].ink3, blend(theme, [data[i], data[i + 1], data[i + 2]], o)));
    if (worst >= TARGET) lo = o;
    else hi = o;
  }
  return lo;
}

/** Brightness above the cap, scaled back to it with its color kept: the near-white letters stop deciding how faint the rest must be. */
const CAP = Number(process.argv[2] ?? 0.2);
const unlin = (v) => Math.round(255 * (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055));
function compress(raw) {
  const data = Buffer.from(raw.data);
  for (let i = 0; i < data.length; i += 3) {
    const px = [data[i], data[i + 1], data[i + 2]];
    const l = lum(px);
    if (l <= CAP) continue;
    const scale = CAP / l;
    for (let c = 0; c < 3; c += 1) data[i + c] = unlin(lin(px[c]) * scale);
  }
  return { data, info: raw.info };
}

async function bake(region, width, name) {
  const original = await sharp(source).extract(region).resize({ width, kernel: 'lanczos3' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const dark = compress(original);
  // Light draws every mark in ink by its own brightness, so the letters don't need toning down there.
  const light = original;
  for (const [theme, raw] of [['dark', dark], ['light', light]]) {
    const o = strongest(theme, raw.data);
    const baked = Buffer.alloc(raw.data.length);
    let worst = Infinity;
    for (let i = 0; i < raw.data.length; i += 3) {
      const px = blend(theme, [raw.data[i], raw.data[i + 1], raw.data[i + 2]], o);
      baked[i] = px[0];
      baked[i + 1] = px[1];
      baked[i + 2] = px[2];
      worst = Math.min(worst, ratio(THEMES[theme].ink3, px));
    }
    const file = process.argv[3] ? `${name}-${theme}-${process.argv[3]}.webp` : `${name}-${theme}.webp`;
    await sharp(baked, { raw: raw.info }).webp({ quality: 50, effort: 6, smartSubsample: true }).toFile(`${out}/${file}`);
    console.log(`${file} ${raw.info.width}x${raw.info.height} strength ${o.toFixed(3)} worst ink-3 contrast ${worst.toFixed(2)} ${(statSync(`${out}/${file}`).size / 1024).toFixed(0)} KB`);
  }
}

const meta = await sharp(source).metadata();
await bake({ left: 0, top: 0, width: meta.width, height: meta.height }, 1440, 'backdrop-wide');
// Phones: 3:4 around the hood (its middle is about x 960).
const tallWidth = Math.round(meta.height * 0.75);
await bake({ left: Math.round(960 - tallWidth / 2), top: 0, width: tallWidth, height: meta.height }, 600, 'backdrop-tall');
