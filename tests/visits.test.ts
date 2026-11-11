import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { addRobot, addVisit, countable, DayCounts, emptyDay, MAX_KEYS, mergeDays, pageKind, referrerHost, visitor } from '../lib/visits';
import { flushVisits, recordRobot, recordVisit } from '../lib/visitsStore';

const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1';
const headers = (o: Record<string, string>) => (name: string) => o[name] ?? null;

describe('who counts as a visitor', () => {
  const page = { 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document', 'accept-language': 'en-US,en;q=0.9', 'user-agent': CHROME };

  it('counts a person opening a page, in any browser', () => {
    assert.equal(visitor('GET', headers(page)), 'person');
    assert.equal(visitor('GET', headers({ ...page, 'user-agent': SAFARI })), 'person');
    assert.equal(visitor('GET', headers({ ...page, 'sec-ch-ua': '"Google Chrome";v="141", "Chromium";v="141", "Not=A?Brand";v="24"' })), 'person');
    assert.equal(countable('GET', headers(page)), true);
  });

  it("counts a page load the site's offline service worker passed on (Chrome sends it as mode navigate, destination empty)", () => {
    assert.equal(visitor('GET', headers({ ...page, 'sec-fetch-dest': 'empty', accept: 'text/html' })), 'person');
  });

  it("isn't a page load at all: the app's own background fetches, images, frames, prefetches, prerenders", () => {
    assert.equal(visitor('GET', headers({ 'sec-fetch-mode': 'cors', 'sec-fetch-dest': 'empty', 'user-agent': CHROME })), null);
    assert.equal(visitor('GET', headers({ 'sec-fetch-mode': 'no-cors', 'sec-fetch-dest': 'image', 'user-agent': CHROME })), null);
    assert.equal(visitor('GET', headers({ ...page, 'sec-fetch-dest': 'iframe' })), null);
    assert.equal(visitor('GET', headers({ ...page, 'sec-purpose': 'prefetch;prerender' })), null);
    assert.equal(visitor('GET', headers({ ...page, purpose: 'prefetch' })), null);
    assert.equal(visitor('HEAD', headers(page)), null);
  });

  it('sets aside robots, link previews, test tools and anything without a name', () => {
    for (const agent of [
      'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
      'facebookexternalhit/1.1',
      'Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)',
      'Slackbot-LinkExpanding 1.0',
      'Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/141.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Linux; Android 11) Chrome-Lighthouse',
      'Scrapy/2.13 (+https://scrapy.org)',
      'curl/8.4.0',
      'node',
      ''
    ]) {
      assert.equal(visitor('GET', headers({ ...page, 'user-agent': agent })), 'named', agent);
    }
    // A headless Chrome given a normal name still lists itself in its brands.
    assert.equal(visitor('GET', headers({ ...page, 'sec-ch-ua': '"HeadlessChrome";v="141", "Chromium";v="141"' })), 'named');
  });

  it("sets aside a program giving a browser's name without what a browser sends with a page", () => {
    // No fetch metadata: a script with a browser's name, asking for HTML like a browser would.
    assert.equal(visitor('GET', headers({ accept: 'text/html,application/xhtml+xml', 'accept-language': 'en-US', 'user-agent': CHROME })), 'no-fetch-metadata');
    assert.equal(visitor('GET', headers({ 'user-agent': CHROME })), 'no-fetch-metadata');
    assert.equal(visitor('GET', headers({ 'sec-fetch-dest': 'document', 'user-agent': CHROME })), 'no-fetch-metadata');
    // Fetch metadata copied over, but no language.
    assert.equal(visitor('GET', headers({ 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document', 'user-agent': CHROME })), 'no-language');
    assert.equal(countable('GET', headers({ 'user-agent': CHROME })), false);
  });
});

describe('what a visit records', () => {
  it('groups pages by kind, so no single game, team or player is singled out', () => {
    assert.equal(pageKind('/'), '/');
    assert.equal(pageKind('/nba/game/401909960'), '/nba/game/*');
    assert.equal(pageKind('/NFL/player/3918298'), '/nfl/player/*');
    assert.equal(pageKind('/parlay/s/abc123'), '/parlay/s/*');
    assert.equal(pageKind('/nba/standings'), '/nba/standings');
    assert.equal(pageKind('/privacy'), '/privacy');
  });

  it('keeps only the name of the site a visitor came from, never the page or what it said', () => {
    assert.equal(referrerHost('https://www.google.com/search?q=knicks+bucks+prediction', ['picks.example.com']), 'google.com');
    assert.equal(referrerHost('https://old.reddit.com/r/nba/comments/abc', [null]), 'old.reddit.com');
    // Our own pages, by any of the names the site goes by.
    assert.equal(referrerHost('https://picks.example.com/nba', ['localhost:3000', 'picks.example.com']), null);
    assert.equal(referrerHost('http://localhost:3000/nba', ['localhost:3000']), null);
    assert.equal(referrerHost(null, []), null);
    assert.equal(referrerHost('android-app://com.google.android.gm/', []), null);
    assert.equal(referrerHost('not a url', []), null);
  });

  it('adds up a day, with a cap on how many different keys a day can hold', () => {
    const day: DayCounts = emptyDay();
    addVisit(day, '/nba', 'google.com');
    addVisit(day, '/nba', null);
    assert.deepEqual({ ...day }, { arrivals: 2, pages: { '/nba': 2 }, from: { 'google.com': 1, direct: 1 } });
    for (let i = 0; i < MAX_KEYS + 50; i += 1) addVisit(day, `/odd-${i}`, null);
    assert.ok(Object.keys(day.pages).length <= MAX_KEYS + 1);
    assert.ok(day.pages.other > 0);
    assert.equal(day.arrivals, MAX_KEYS + 52);
  });

  it('merges two tallies of one day without losing any', () => {
    const a = { arrivals: 3, pages: { '/': 2, '/nba': 1 }, from: { direct: 3 } };
    const b = { arrivals: 2, pages: { '/nba': 2 }, from: { 'x.com': 2 } };
    assert.deepEqual(mergeDays(a, b), { arrivals: 5, pages: { '/': 2, '/nba': 3 }, from: { direct: 3, 'x.com': 2 } });
  });

  it('keeps robots in a total of their own, never in the people count', () => {
    const day = emptyDay();
    addVisit(day, '/nba', null);
    addRobot(day, '/nba/game/*', 'no-fetch-metadata');
    addRobot(day, '/nba/game/*', 'named');
    assert.equal(day.arrivals, 1);
    assert.deepEqual(day.robots, { arrivals: 2, pages: { '/nba/game/*': 2 }, why: { 'no-fetch-metadata': 1, named: 1 } });
    // A day written before robots were counted merges with one that has them.
    const merged = mergeDays({ arrivals: 4, pages: { '/': 4 }, from: { direct: 4 } }, day);
    assert.equal(merged.arrivals, 5);
    assert.deepEqual(merged.robots, day.robots);
    assert.deepEqual(mergeDays(day, day).robots, { arrivals: 4, pages: { '/nba/game/*': 4 }, why: { 'no-fetch-metadata': 2, named: 2 } });
  });
});

describe('saving the counts', () => {
  it('adds to the day already on disk instead of replacing it, and writes nothing about anyone', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'visits-'));
    try {
      const when = new Date('2026-11-10T18:00:00Z');
      recordVisit('/nba', 'google.com', when);
      await flushVisits(dir);
      recordVisit('/nba', null, when);
      recordVisit('/', null, when);
      await flushVisits(dir);
      const text = await readFile(path.join(dir, '2026-11-10.json'), 'utf8');
      assert.deepEqual(JSON.parse(text), { arrivals: 3, pages: { '/nba': 2, '/': 1 }, from: { 'google.com': 1, direct: 2 } });
      // Only those three keys: no addresses, agents or times.
      assert.deepEqual(Object.keys(JSON.parse(text)).sort(), ['arrivals', 'from', 'pages']);
      recordRobot('/nba/game/*', 'no-language', when);
      await flushVisits(dir);
      const after = JSON.parse(await readFile(path.join(dir, '2026-11-10.json'), 'utf8'));
      assert.equal(after.arrivals, 3);
      assert.deepEqual(after.robots, { arrivals: 1, pages: { '/nba/game/*': 1 }, why: { 'no-language': 1 } });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
