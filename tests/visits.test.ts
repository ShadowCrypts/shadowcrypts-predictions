import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { addVisit, countable, DayCounts, emptyDay, MAX_KEYS, mergeDays, pageKind, referrerHost } from '../lib/visits';
import { flushVisits, recordVisit } from '../lib/visitsStore';

const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const headers = (o: Record<string, string>) => (name: string) => o[name] ?? null;

describe('who counts as a visitor', () => {
  const page = { 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document', 'user-agent': CHROME };

  it('counts a person opening a page', () => {
    assert.equal(countable('GET', headers(page)), true);
    // A browser too old to say what it's fetching, asking for a page.
    assert.equal(countable('GET', headers({ accept: 'text/html,application/xhtml+xml', 'user-agent': CHROME })), true);
  });

  it("counts a page load the site's offline service worker passed on (Chrome sends it as mode navigate, destination empty)", () => {
    assert.equal(countable('GET', headers({ ...page, 'sec-fetch-dest': 'empty', accept: 'text/html' })), true);
  });

  it("leaves out the app's own background fetches, images, frames, prefetches and prerenders", () => {
    assert.equal(countable('GET', headers({ 'sec-fetch-mode': 'cors', 'sec-fetch-dest': 'empty', 'user-agent': CHROME })), false);
    assert.equal(countable('GET', headers({ 'sec-fetch-mode': 'no-cors', 'sec-fetch-dest': 'image', 'user-agent': CHROME })), false);
    assert.equal(countable('GET', headers({ ...page, 'sec-fetch-dest': 'iframe' })), false);
    assert.equal(countable('GET', headers({ ...page, 'sec-purpose': 'prefetch;prerender' })), false);
    assert.equal(countable('GET', headers({ ...page, purpose: 'prefetch' })), false);
    assert.equal(countable('GET', headers({ 'sec-fetch-dest': 'document', 'user-agent': CHROME })), false);
    assert.equal(countable('GET', headers({ 'user-agent': CHROME })), false);
    assert.equal(countable('HEAD', headers(page)), false);
  });

  it('leaves out robots, link previews, test tools and anything without a name', () => {
    for (const agent of [
      'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
      'facebookexternalhit/1.1',
      'Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)',
      'Slackbot-LinkExpanding 1.0',
      'Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/141.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Linux; Android 11) Chrome-Lighthouse',
      'curl/8.4.0',
      'node',
      ''
    ]) {
      assert.equal(countable('GET', headers({ 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document', 'user-agent': agent })), false, agent);
    }
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
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
