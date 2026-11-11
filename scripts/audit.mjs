/**
 * Lighthouse over the pages that matter, on a phone and a desktop profile:
 * performance, accessibility, best practices and SEO, with every check that
 * didn't pass. Run against a production server (`npm run build`, then
 * `npm run start` or `npm run serve`):
 *
 *   npm run audit                      every page, phone and desktop
 *   npm run audit -- --min=95          fail (exit 1) if any score is under 95
 *   npm run audit -- --only=/live      one page
 *   npm run audit -- --base=https://…  another server
 *
 * Full reports go to .cache/audits/ (open the .html files in a browser). With
 * the phone profile it also loads every page at 375px and fails if any is
 * wider than that (which would scroll sideways).
 * Plain JavaScript on purpose: Lighthouse runs some of its own functions inside
 * the browser, and a TypeScript loader's helpers break them there.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import * as chromeLauncher from 'chrome-launcher';
import lighthouse from 'lighthouse';
import desktopConfig from 'lighthouse/core/config/desktop-config.js';

const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
const BASE = (arg('base') ?? 'http://localhost:3000').replace(/\/$/, '');
const MIN = arg('min') ? Number(arg('min')) : null;
const ONLY = arg('only');
const DEVICES = arg('device') ? [arg('device')] : ['mobile', 'desktop'];
const CATEGORIES = ['performance', 'accessibility', 'best-practices', 'seo'];
const OUT = path.join(process.cwd(), '.cache', 'audits');

async function pages() {
  // A real game to audit, from the site's own API.
  const nba = await fetch(`${BASE}/api/predictions?league=nba`)
    .then((r) => r.json())
    .catch(() => null);
  const game = nba?.leagues?.[0]?.predictions?.[0]?.id;
  return [
    '/',
    '/live',
    '/nba',
    ...(game ? [`/nba/game/${game}`] : []),
    '/nba/player/3112335',
    '/nba/team/7',
    '/nba/players',
    '/nfl/players',
    '/nba/compare?a=3112335&b=3059318',
    '/nfl/fantasy',
    '/nfl/injuries',
    '/nhl/standings',
    '/privacy',
    '/props?league=nfl',
    '/parlay',
    '/picks',
    '/record',
    '/matchup',
    '/results'
  ].filter((p) => !ONLY || p === ONLY);
}

/** A phone's width; a page wider than this scrolls sideways. */
const PHONE = { width: 375, height: 812 };

/**
 * Lighthouse doesn't check that a page fits a phone's width. Each page is
 * loaded at 375px as a touch phone and measured: wider content makes the
 * browser widen the whole page, which then scrolls sideways (an absolutely
 * positioned child escaping its table's scroller did exactly that once).
 * Uses Lighthouse's own puppeteer-core; without it the check is skipped.
 */
async function phoneWidths(port, paths) {
  let puppeteer;
  try {
    puppeteer = (await import('puppeteer-core')).default;
  } catch {
    console.log('\nPhone width check skipped: puppeteer-core is not installed.');
    return;
  }
  const browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${port}` });
  const wide = [];
  try {
    for (const p of paths) {
      const tab = await browser.newPage();
      try {
        await tab.emulate({ viewport: { ...PHONE, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }, userAgent: 'Mozilla/5.0 (Linux; Android 14) Mobile' });
        await tab.goto(`${BASE}${p}`, { waitUntil: 'networkidle2', timeout: 60_000 });
        const [inner, scroll] = await tab.evaluate(() => [window.innerWidth, document.documentElement.scrollWidth]);
        if (Math.max(inner, scroll) > PHONE.width + 1) wide.push(`${p} (${Math.max(inner, scroll)}px)`);
      } finally {
        await tab.close().catch(() => undefined);
      }
    }
  } finally {
    await browser.disconnect();
  }
  if (wide.length) {
    console.error(`\nWider than a ${PHONE.width}px phone: ${wide.join(', ')}`);
    process.exitCode = 1;
  } else {
    console.log(`\nEvery page fits a ${PHONE.width}px phone.`);
  }
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const chrome = await chromeLauncher.launch({ chromeFlags: ['--headless=new', '--disable-gpu'] });
  let worst = 100;
  const failing = new Map();
  try {
    for (const page of await pages()) {
      for (const device of DEVICES) {
        const run = await lighthouse(
          `${BASE}${page}`,
          { port: chrome.port, output: ['json', 'html'], logLevel: 'error', onlyCategories: CATEGORIES },
          device === 'desktop' ? desktopConfig : undefined
        );
        if (!run) continue;
        const { lhr, report } = run;
        const name = `${page.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '') || 'home'}-${device}`;
        const [json, html] = Array.isArray(report) ? report : [report, ''];
        writeFileSync(path.join(OUT, `${name}.json`), json);
        if (html) writeFileSync(path.join(OUT, `${name}.html`), html);
        const scores = CATEGORIES.map((c) => Math.round((lhr.categories[c]?.score ?? 0) * 100));
        worst = Math.min(worst, ...scores);
        const shown = (id) => lhr.audits[id]?.displayValue ?? '';
        console.log(
          `${page.padEnd(28)} ${device.padEnd(7)} perf ${scores[0]} · a11y ${scores[1]} · best ${scores[2]} · seo ${scores[3]}   FCP ${shown('first-contentful-paint')} · LCP ${shown('largest-contentful-paint')} · CLS ${shown('cumulative-layout-shift')} · TBT ${shown('total-blocking-time')}`
        );
        for (const c of CATEGORIES) {
          for (const ref of lhr.categories[c]?.auditRefs ?? []) {
            const audit = lhr.audits[ref.id];
            if (!audit || ref.weight === 0 || audit.score === null || audit.score >= 0.9) continue;
            const key = `${c}: ${audit.id} · ${audit.title}${audit.displayValue ? ` (${audit.displayValue})` : ''}`;
            failing.set(key, (failing.get(key) ?? new Set()).add(`${page} ${device}`));
          }
        }
      }
    }
    if (DEVICES.includes('mobile')) await phoneWidths(chrome.port, await pages());
  } finally {
    // On Windows, Chrome's launcher can fail to delete its temporary profile; that's not an audit failure.
    await Promise.resolve(chrome.kill()).catch(() => undefined);
  }
  if (failing.size) {
    console.log('\nChecks under 90:');
    for (const [key, where] of [...failing].sort()) console.log(`  ${key}  [${[...where].join(', ')}]`);
  }
  console.log(`\nLowest score: ${worst}. Reports in ${OUT}`);
  if (MIN !== null && worst < MIN) {
    console.error(`Below the minimum of ${MIN}.`);
    process.exitCode = 1;
  }
}

// Exit with the audit's own verdict: Chrome's launcher can fail to clean up its temporary profile on Windows
// after everything is done, which would otherwise surface as a stray error code.
main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => process.exit(process.exitCode ?? 0));
