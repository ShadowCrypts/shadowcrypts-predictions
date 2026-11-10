import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { LegResult } from '../lib/legs';
import { alertsFor, isPushEndpoint, PlayerLines, pruneSent, readWatchRequest, TeamGame, Watch } from '../lib/push';

const p256dh = 'B'.repeat(87);
const auth = 'a'.repeat(22);
const endpoint = 'https://fcm.googleapis.com/fcm/send/abc123';

describe('push addresses', () => {
  it('accept only the browsers’ own push services', () => {
    for (const ok of [endpoint, 'https://updates.push.services.mozilla.com/wpush/v2/x', 'https://web.push.apple.com/QW', 'https://wns2-bn3p.notify.windows.com/w/?token=x']) assert.equal(isPushEndpoint(ok), true, ok);
    for (const bad of [
      'http://fcm.googleapis.com/fcm/send/x',
      'https://localhost/x',
      'https://127.0.0.1/x',
      'https://169.254.169.254/latest/meta-data',
      'https://fcm.googleapis.com:8443/x',
      'https://user:pw@fcm.googleapis.com/x',
      'https://fcm.googleapis.com.evil.example/x',
      'https://evil.example/fcm.googleapis.com',
      'https://notify.windows.com/x',
      'not a url',
      42
    ])
      assert.equal(isPushEndpoint(bad), false, String(bad));
  });

  it('read a watch request strictly, dropping anything malformed', () => {
    const good = readWatchRequest({
      subscription: { endpoint, keys: { p256dh, auth } },
      parlays: [
        { id: 'abc123', price: 450, legs: [{ key: 'k1', id: 'p~nba~401~5~pts~24.5~over', label: 'Player over 24.5\u0000 points\n' }, { key: 'k2', id: 'junk', label: 'x' }] },
        { id: 'bad id!', price: 100, legs: [{ key: 'k', id: 'w~nba~1~2', label: 'x' }] }
      ],
      teams: ['nba:13', 'nba:13', 'zzz:1', 'nfl:<script>'],
      prefs: { games: false }
    })!;
    assert.deepEqual(good.parlays, [{ id: 'abc123', price: 450, legs: [{ key: 'k1', id: 'p~nba~401~5~pts~24.5~over', label: 'Player over 24.5 points' }] }]);
    assert.deepEqual(good.teams, ['nba:13']);
    assert.deepEqual(good.players, []);
    assert.deepEqual(good.prefs, { legs: true, games: false });
    // Players only from leagues with player pages, once each.
    const withPlayers = readWatchRequest({ subscription: { endpoint, keys: { p256dh, auth } }, players: ['nba:3112335', 'nba:3112335', 'mlb:5', 'nfl:x', 'nhl:3895074', 7] })!;
    assert.deepEqual(withPlayers.players, ['nba:3112335', 'nhl:3895074']);
    assert.equal(readWatchRequest({ subscription: { endpoint: 'https://evil.example/x', keys: { p256dh, auth } } }), null);
    assert.equal(readWatchRequest({ subscription: { endpoint, keys: { p256dh: 'short', auth } } }), null);
    assert.equal(readWatchRequest('nope'), null);
  });
});

describe('player lines alerts', () => {
  const watch = (sent: Record<string, string> = {}, games = true): Watch => ({
    subscription: { endpoint, keys: { p256dh, auth } },
    parlays: [],
    teams: [],
    players: ['nba:15'],
    prefs: { legs: true, games },
    createdAt: 1_000,
    updatedAt: 1_000,
    sent
  });
  const lines = (gameId: string, start = 10_000_000): PlayerLines => ({
    key: 'nba:15',
    league: 'nba',
    playerId: '15',
    name: 'Nikola Jokic',
    gameId,
    game: 'DEN @ NO',
    start,
    lines: [
      { label: 'Points', line: 26.5, over: 0.49 },
      { label: 'Rebounds', line: 12.5, over: 0.52 }
    ]
  });

  it('stays quiet about lines already up when a player is first watched, then tells each new game’s lines once', () => {
    const first = alertsFor(watch(), {}, [], 5_000, [lines('g1')]);
    assert.equal(first.notes.length, 0);
    assert.equal(alertsFor(watch(first.sent), {}, [], 6_000, [lines('g1')]).notes.length, 0, 'same game, already known');
    const next = alertsFor(watch(first.sent), {}, [], 7_000, [lines('g2')]);
    assert.equal(next.notes.length, 1);
    assert.equal(next.notes[0].title, 'Lines are up: Nikola Jokic');
    assert.equal(next.notes[0].body, 'DEN @ NO · Points 26.5 (49% over) · Rebounds 12.5 (52% over)');
    assert.equal(next.notes[0].url, '/nba/player/15');
    assert.equal(alertsFor(watch(next.sent), {}, [], 8_000, [lines('g2')]).notes.length, 0, 'once only');
  });

  it('announces lines posted after a player was first watched with none up', () => {
    const quiet = alertsFor(watch(), {}, [], 5_000, []);
    assert.equal(quiet.sent['seenp|nba:15'], '1');
    assert.equal(alertsFor(watch(quiet.sent), {}, [], 6_000, [lines('g1')]).notes.length, 1);
  });

  it('skips started games, unfollowed players and turned-off alerts, and keeps what it has seen when pruning', () => {
    const seen = alertsFor(watch(), {}, [], 5_000, []).sent;
    assert.equal(alertsFor(watch(seen), {}, [], 10_000_001, [lines('g1')]).notes.length, 0);
    assert.equal(alertsFor({ ...watch(seen), players: [] }, {}, [], 6_000, [lines('g1')]).notes.length, 0);
    assert.equal(alertsFor(watch(seen, false), {}, [], 6_000, [lines('g1')]).notes.length, 0);
    const told = alertsFor(watch(seen), {}, [], 6_000, [lines('g1')]).sent;
    assert.deepEqual(pruneSent(told, new Set()), { 'seenp|nba:15': '1', 'lines|nba:15:g1': '1' });
  });
});

describe('alerts', () => {
  const legA = { key: 'a', id: 'p~nba~1~5~pts~24.5~over', label: 'Star over 24.5 points' };
  const legB = { key: 'b', id: 'w~nba~2~9', label: 'Celtics to win' };
  const watch = (sent: Record<string, string> = {}, prefs = { legs: true, games: true }): Watch => ({
    subscription: { endpoint, keys: { p256dh, auth } },
    parlays: [{ id: 'par1', price: 300, legs: [legA, legB] }],
    teams: ['nba:9'],
    prefs,
    createdAt: 1_000,
    updatedAt: 1_000,
    sent
  });
  const pending: LegResult = { state: 'pending', actual: 10, live: { status: 'Q2', decided: null, chance: null } };
  const hit: LegResult = { state: 'pending', actual: 26, live: { status: 'Q3', decided: 'won', chance: null } };
  const won: LegResult = { state: 'won', actual: null };
  const lost: LegResult = { state: 'lost', actual: null };

  it('takes note quietly on the first look, then tells each leg once as it settles', () => {
    const first = alertsFor(watch(), { [legA.id]: hit, [legB.id]: pending }, [], 5_000);
    assert.deepEqual(first.notes, []);
    const again = alertsFor(watch(first.sent), { [legA.id]: hit, [legB.id]: pending }, [], 6_000);
    assert.deepEqual(again.notes, [], 'nothing new, nothing said');
    const before = alertsFor(watch(), { [legA.id]: pending, [legB.id]: pending }, [], 5_000);
    const later = alertsFor(watch(before.sent), { [legA.id]: hit, [legB.id]: pending }, [], 6_000);
    assert.deepEqual(
      later.notes.map((n) => [n.title, n.body]),
      [['Leg hit ✓', 'Star over 24.5 points']]
    );
    const cashed = alertsFor(watch(later.sent), { [legA.id]: won, [legB.id]: won }, [], 7_000);
    assert.deepEqual(
      cashed.notes.map((n) => n.title),
      ['Leg hit ✓', 'Parlay cashed! 🎉']
    );
    assert.match(cashed.notes[1].body, /\+300/);
  });

  it('tells a bust as the bust, not also as the leg that caused it', () => {
    const before = alertsFor(watch(), { [legA.id]: pending, [legB.id]: pending }, [], 5_000);
    const bust = alertsFor(watch(before.sent), { [legA.id]: pending, [legB.id]: lost }, [], 6_000);
    assert.deepEqual(
      bust.notes.map((n) => [n.title, n.body]),
      [['Parlay busted', 'Celtics to win missed.']]
    );
    assert.equal(alertsFor(watch(bust.sent), { [legA.id]: won, [legB.id]: lost }, [], 7_000).notes.length, 1, 'only the newly settled leg');
  });

  it('says nothing about parlays when parlay alerts are off', () => {
    const before = alertsFor(watch({}, { legs: false, games: true }), { [legA.id]: pending }, [], 5_000);
    assert.deepEqual(alertsFor(watch(before.sent, { legs: false, games: true }), { [legA.id]: won, [legB.id]: won }, [], 6_000).notes, []);
  });

  const game = (over: Partial<TeamGame>): TeamGame => ({
    key: 'nba:77',
    league: 'nba',
    id: '77',
    start: 100_000_000,
    state: 'pre',
    completed: false,
    home: { teamId: '9', abbr: 'BOS', name: 'Celtics', score: null },
    away: { teamId: '4', abbr: 'NY', name: 'Knicks', score: null },
    pick: 'home',
    pickProb: 0.64,
    correct: null,
    ...over
  });

  it('announces a followed team’s game once shortly before it starts, and once when it’s final', () => {
    const early = alertsFor(watch(), {}, [game({})], 100_000_000 - 60 * 60_000);
    assert.equal(early.notes.length, 0, 'an hour out is too early');
    const soon = alertsFor(watch(), {}, [game({})], 100_000_000 - 20 * 60_000);
    assert.deepEqual(
      soon.notes.map((n) => [n.title, n.body, n.url]),
      [['NY @ BOS in 20 min', 'Forecast: Celtics 64% to win.', '/nba/game/77']]
    );
    assert.equal(alertsFor(watch(soon.sent), {}, [game({})], 100_000_000 - 10 * 60_000).notes.length, 0, 'once only');
    const final = alertsFor(watch(soon.sent), {}, [game({ state: 'post', completed: true, home: { teamId: '9', abbr: 'BOS', name: 'Celtics', score: 110 }, away: { teamId: '4', abbr: 'NY', name: 'Knicks', score: 101 }, correct: true })], 100_000_000 + 3 * 3_600_000);
    assert.deepEqual(
      final.notes.map((n) => [n.title, n.body]),
      [['Final: NY 101, BOS 110', 'Celtics won · the forecast called it (BOS 64%).']]
    );
    // A game that started before alerts were turned on isn't announced late.
    const old = { ...watch(), createdAt: 200_000_000 };
    assert.equal(alertsFor(old, {}, [game({ state: 'post', completed: true, home: { teamId: '9', abbr: 'BOS', name: 'Celtics', score: 1 }, away: { teamId: '4', abbr: 'NY', name: 'Knicks', score: 0 } })], 200_000_100).notes.length, 0);
    // Teams nobody follows stay quiet.
    assert.equal(alertsFor(watch(), {}, [game({ home: { teamId: '1', abbr: 'A', name: 'A', score: null }, away: { teamId: '2', abbr: 'B', name: 'B', score: null } })], 100_000_000 - 20 * 60_000).notes.length, 0);
  });

  it('announces injury news in a followed team’s game, after a first quiet look', () => {
    const at = 100_000_000 - 20 * 3_600_000;
    const first = alertsFor(watch(), {}, [game({ out: [] })], at);
    assert.equal(first.notes.filter((n) => n.tag.startsWith('news|')).length, 0, 'the first look only notes who’s out');
    const out = alertsFor(watch(first.sent), {}, [game({ out: ['5|NY|Jalen Brunson'], pickProb: 0.71 })], at + 60_000);
    assert.deepEqual(
      out.notes.map((n) => [n.title, n.body]),
      [['Injury news: NY @ BOS', 'Jalen Brunson out. Forecast now: Celtics 71% to win.']]
    );
    assert.equal(alertsFor(watch(out.sent), {}, [game({ out: ['5|NY|Jalen Brunson'] })], at + 120_000).notes.length, 0, 'once per change');
    const back = alertsFor(watch(out.sent), {}, [game({ out: [] })], at + 180_000);
    assert.deepEqual(back.notes.map((n) => n.body), ['Jalen Brunson back. Forecast now: Celtics 64% to win.']);
    // More than two days out stays quiet.
    assert.equal(alertsFor(watch(first.sent), {}, [game({ out: ['5|NY|Jalen Brunson'] })], 100_000_000 - 72 * 3_600_000).notes.length, 0);
  });

  it('calls a close finish once, late in a close game', () => {
    const at = 100_000_000 + 2 * 3_600_000;
    const on = (homeProb: number, remaining: number) =>
      game({ state: 'in', live: { homeProb, remaining, status: '4:12 4th' }, home: { teamId: '9', abbr: 'BOS', name: 'Celtics', score: 97 }, away: { teamId: '4', abbr: 'NY', name: 'Knicks', score: 98 } });
    assert.equal(alertsFor(watch(), {}, [on(0.55, 0.3)], at).notes.length, 0, 'too early');
    assert.equal(alertsFor(watch(), {}, [on(0.9, 0.05)], at).notes.length, 0, 'not close');
    const close = alertsFor(watch(), {}, [on(0.42, 0.08)], at);
    assert.deepEqual(close.notes.map((n) => [n.title, n.body]), [['Close finish: NY 98, BOS 97', '4:12 4th · Knicks 58% to win now.']]);
    assert.equal(alertsFor(watch(close.sent), {}, [on(0.5, 0.03)], at + 60_000).notes.length, 0, 'once per game');
  });

  it('forgets notes on parlays no longer watched, keeps game notes', () => {
    assert.deepEqual(pruneSent({ 'seen|old': '1', 'leg|old|a': 'won', 'seen|par1': '1', 'start|nba:1': '1' }, new Set(['par1'])), { 'seen|par1': '1', 'start|nba:1': '1' });
  });
});
