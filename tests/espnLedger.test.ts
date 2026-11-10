import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Game } from '../lib/espn';
import { espnHeadToHead, gamesToRead, parseEspnForecast, withReadings } from '../lib/model/espnLedger';

const close = (a: number | null, b: number) => assert.ok(a !== null && Math.abs(a - b) < 1e-9, `${a} is not ${b}`);
const side = (value?: number) => ({ statistics: value === undefined ? [] : [{ name: 'gameProjection', value }, { name: 'teamChanceLoss', value: 100 - value }] });

describe("ESPN's forecasts", () => {
  it('reads the home team\'s chance, from either side of the feed', () => {
    close(parseEspnForecast({ homeTeam: side(60), awayTeam: side(40) }), 0.6);
    // The NBA's feed often leaves the home side empty.
    close(parseEspnForecast({ homeTeam: side(), awayTeam: side(48.7) }), 0.513);
    close(parseEspnForecast({ homeTeam: side(37.5), awayTeam: side() }), 0.375);
    // Football keeps a sliver for ties; shares are of the two outcomes that grade.
    close(parseEspnForecast({ homeTeam: side(56.6), awayTeam: side(43) }), 56.6 / 99.6);
  });

  it('refuses what makes no sense rather than logging it', () => {
    assert.equal(parseEspnForecast({}), null);
    assert.equal(parseEspnForecast(null), null);
    assert.equal(parseEspnForecast({ homeTeam: side(), awayTeam: side() }), null);
    assert.equal(parseEspnForecast({ homeTeam: side(100), awayTeam: side(0) }), null);
    assert.equal(parseEspnForecast({ homeTeam: side(140), awayTeam: side() }), null);
  });

  const now = new Date('2026-11-04T12:00:00Z');
  const at = (hours: number) => new Date(now.getTime() + hours * 3_600_000).toISOString();

  it('reads only games that have not started and start within a day', () => {
    const games = [
      { id: 'soon', date: at(2), state: 'pre' },
      { id: 'later', date: at(30), state: 'pre' },
      { id: 'on', date: at(-1), state: 'in' },
      { id: 'late', date: at(-1), state: 'pre' },
      { id: 'sooner', date: at(1), state: 'pre' }
    ] as Game[];
    assert.deepEqual(gamesToRead(games, now).map((g) => g.id), ['sooner', 'soon']);
  });

  it('never lets a reading after the start count, and keeps the last one before it', () => {
    const game = { id: 'g', date: at(1) };
    const first = withReadings({}, [{ game, homeProb: 0.6 }], now);
    assert.equal(first.g.homeProb, 0.6);
    // Closer to the start, a new number replaces it.
    const closer = withReadings(first, [{ game, homeProb: 0.62 }], new Date(at(0.5)));
    assert.equal(closer.g.homeProb, 0.62);
    // Once it has started, the number stands, whatever ESPN shows now.
    const afterStart = withReadings(closer, [{ game, homeProb: 0.99 }], new Date(at(2)));
    assert.equal(afterStart.g.homeProb, 0.62);
    // A failed read changes nothing.
    assert.equal(withReadings(closer, [{ game, homeProb: null }], new Date(at(0.6))).g.homeProb, 0.62);
  });

  it('grades both only on games where both were locked, and skips ties and games still to finish', () => {
    const game = (id: string, home: number | null, away: number | null) => ({ id, completed: home !== null, home: { score: home }, away: { score: away } }) as unknown as Game;
    const games = [game('both', 100, 90), game('both2', 90, 100), game('only-espn', 100, 90), game('only-ours', 100, 90), game('tie', 20, 20), game('coming', null, null)];
    const entry = (homeProb: number) => ({ homeProb, takenAt: '2026-11-04T10:00:00Z', start: '2026-11-04T12:00:00Z' });
    const espn = { both: entry(0.6), both2: entry(0.6), 'only-espn': entry(0.9), tie: entry(0.5), coming: entry(0.5) };
    const ours = { both: { homeProb: 0.8 }, both2: { homeProb: 0.4 }, 'only-ours': { homeProb: 0.9 }, tie: { homeProb: 0.5 }, coming: { homeProb: 0.5 } };
    const record = espnHeadToHead(games, espn, ours)!;
    assert.equal(record.games, 2);
    // We called both; ESPN called the first and missed the second.
    assert.equal(record.ours.correct, 2);
    assert.equal(record.espn.correct, 1);
    assert.equal(record.since, '2026-11-04T10:00:00Z');
    assert.equal(espnHeadToHead(games, {}, ours), null);
  });
});
