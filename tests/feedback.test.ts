import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { FEEDBACK_LIMITS, FeedbackEntry } from '../lib/feedback';
import { feedbackPage, readFeedback } from '../lib/feedbackRead';
import { saveFeedback } from '../lib/feedbackStore';

const NOW = new Date('2026-11-12T02:00:00Z');
const ok = { kind: 'idea', message: 'Add the WNBA please', contact: '@fan', page: '/nba/game/401909960', website: '', elapsedMs: 9_000 };

describe('feedback the server takes', () => {
  it('keeps a message with its kind, page and contact', () => {
    assert.deepEqual(readFeedback(ok, NOW), {
      entry: { at: '2026-11-12T02:00:00.000Z', kind: 'idea', message: 'Add the WNBA please', page: '/nba/game/401909960', contact: '@fan' }
    });
  });

  it('cleans the text: line breaks stay, control characters and direction tricks go', () => {
    const read = readFeedback({ ...ok, message: '  Line one\r\n\r\n\r\n\r\nLine\u0007 two‮\t!  ', contact: '  me@\nexample.com \u0000 ' }, NOW);
    assert.ok('entry' in read);
    assert.equal(read.entry.message, 'Line one\n\nLine two !');
    assert.equal(read.entry.contact, 'me@ example.com');
  });

  it('says what’s wrong with an empty, overlong or rushed message', () => {
    for (const message of ['', '  ', 'hi', 12]) assert.deepEqual(readFeedback({ ...ok, message }, NOW), { error: 'Write a few words first.' });
    assert.match((readFeedback({ ...ok, message: 'x'.repeat(FEEDBACK_LIMITS.message + 1) }, NOW) as { error: string }).error, /under 2,000/);
    for (const elapsedMs of [0, 800, undefined, 'soon', Infinity]) assert.match((readFeedback({ ...ok, elapsedMs }, NOW) as { error: string }).error, /quick/);
    assert.ok('error' in readFeedback(null, NOW));
    assert.ok('error' in readFeedback('text', NOW));
  });

  it('springs the trap on the hidden field only programs fill in', () => {
    assert.deepEqual(readFeedback({ ...ok, website: 'https://spam.example' }, NOW), { trap: true });
  });

  it('falls back to "other" for an unknown kind and drops a contact that’s only spaces', () => {
    const read = readFeedback({ ...ok, kind: 'praise', contact: '   ' }, NOW);
    assert.ok('entry' in read);
    assert.equal(read.entry.kind, 'other');
    assert.equal(read.entry.contact, null);
    const long = readFeedback({ ...ok, contact: 'a'.repeat(500) }, NOW);
    assert.ok('entry' in long);
    assert.equal(long.entry.contact?.length, FEEDBACK_LIMITS.contact);
  });

  it('keeps only a page of the site’s own, without its query string', () => {
    assert.equal(feedbackPage('/nba/game/401909960?x=1#top'), '/nba/game/401909960');
    assert.equal(feedbackPage('/'), '/');
    for (const junk of ['https://evil.example/', '//evil.example/x', '/wp-admin', '/api/predictions', '/_next/static/x.js', 'nba', null, 7, `/${'a'.repeat(300)}`]) {
      assert.equal(feedbackPage(junk), null, String(junk));
    }
  });
});

describe('the feedback box', () => {
  const entry = (at: string, message = 'Something looks off on this page'): FeedbackEntry => ({ at, kind: 'data', message, page: '/nba', contact: null });

  it('adds each message to its month’s file, one line each, readable by the site’s user only', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'feedback-'));
    try {
      assert.equal(await saveFeedback(entry('2026-11-12T02:00:00.000Z'), dir), 'saved');
      assert.equal(await saveFeedback(entry('2026-11-30T23:00:00.000Z', 'Second'), dir), 'saved');
      assert.equal(await saveFeedback(entry('2026-12-01T00:00:00.000Z', 'Next month'), dir), 'saved');
      const november = (await readFile(path.join(dir, '2026-11.jsonl'), 'utf8')).trimEnd().split('\n').map((l) => JSON.parse(l));
      assert.deepEqual(
        november.map((e) => e.message),
        ['Something looks off on this page', 'Second']
      );
      assert.equal((await readFile(path.join(dir, '2026-12.jsonl'), 'utf8')).trimEnd().split('\n').length, 1);
      if (process.platform !== 'win32') assert.equal((await stat(path.join(dir, '2026-11.jsonl'))).mode & 0o777, 0o600);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('turns new messages away once a month’s file is full', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'feedback-'));
    try {
      assert.equal(await saveFeedback(entry('2026-11-12T02:00:00.000Z'), dir, 100), 'saved');
      assert.equal(await saveFeedback(entry('2026-11-12T03:00:00.000Z'), dir, 100), 'full');
      assert.equal(await saveFeedback(entry('2026-12-01T00:00:00.000Z'), dir, 100), 'saved');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
