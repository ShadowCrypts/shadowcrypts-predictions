import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Prediction } from '../lib/model';
import { injuryNews, keyAbsences } from '../lib/model/injuryNews';
import { biggestMovers, mergeSnapshots, moveReason, readingAt, Snapshot, worthKeeping } from '../lib/model/movement';

const snap = (t: string, p: number, line: number | null = null, basis: Snapshot['basis'] = 'model'): Snapshot => ({ t, p, line, basis });

describe('forecast movement', () => {
  it('keeps real moves and skips noise', () => {
    const last = snap('2026-10-24T12:00:00Z', 0.6);
    assert.equal(worthKeeping(undefined, last), true);
    assert.equal(worthKeeping(last, snap('2026-10-24T12:10:00Z', 0.602)), false, 'a 0.2-point wobble 10 minutes later');
    assert.equal(worthKeeping(last, snap('2026-10-24T12:10:00Z', 0.61)), true, 'a 1-point move');
    assert.equal(worthKeeping(last, snap('2026-10-24T12:10:00Z', 0.6, 0.58, 'market')), true, 'the line being posted');
    assert.equal(worthKeeping(last, snap('2026-10-24T16:00:00Z', 0.6)), true, 'a heartbeat every few hours');
  });

  it('reads the forecast in effect at any moment', () => {
    const history = [snap('2026-10-24T12:00:00Z', 0.6), snap('2026-10-24T14:00:00Z', 0.55)];
    assert.equal(readingAt(history, Date.parse('2026-10-24T13:00:00Z'))?.p, 0.6);
    assert.equal(readingAt(history, Date.parse('2026-10-24T15:00:00Z'))?.p, 0.55);
    assert.equal(readingAt(history, Date.parse('2026-10-23T00:00:00Z'))?.p, 0.6, 'before tracking began: the first reading');
    assert.equal(readingAt([], 0), null);
  });

  it('says what moved a forecast', () => {
    assert.equal(moveReason(snap('t', 0.5), { basis: 'market', line: 0.45 }), 'line posted');
    assert.equal(moveReason(snap('t', 0.5, 0.5, 'market'), { basis: 'market', line: 0.45 }), 'line moved');
    assert.equal(moveReason(snap('t', 0.5, 0.5, 'market'), { basis: 'model', line: null }), 'line pulled');
    assert.equal(moveReason(snap('t', 0.5), { basis: 'model', line: null }), 'model update');
  });

  it('ranks the biggest moves since a time and ignores small ones', () => {
    const now = (id: string, homeProb: number, line: number | null = null) =>
      ({ game: { id, league: 'nfl' }, homeProb, basis: line === null ? 'model' : 'market', market: line === null ? null : { homeProb: line } }) as unknown as Prediction;
    const movement = {
      a: [snap('2026-10-23T10:00:00Z', 0.51, 0.5, 'market')],
      b: [snap('2026-10-23T10:00:00Z', 0.6)],
      c: [snap('2026-10-23T10:00:00Z', 0.4)]
    };
    const movers = biggestMovers(movement, [now('a', 0.43, 0.43), now('b', 0.62), now('c', 0.5, 0.5), now('d', 0.7)], Date.parse('2026-10-23T12:00:00Z'));
    assert.deepEqual(
      movers.map((m) => [m.gameId, m.reason]),
      [
        ['c', 'line posted'],
        ['a', 'line moved']
      ]
    );
  });

  it('names the injury news behind a move: key players out or back', () => {
    const injury = (athleteId: string, name: string, status: string, missChance: number, value: number) => ({ athleteId, name, status, missChance, value, elo: -value * missChance });
    const game = { id: 'g', league: 'nba', home: { abbr: 'LAL' }, away: { abbr: 'MIA' } };
    const p = (home: ReturnType<typeof injury>[], away: ReturnType<typeof injury>[] = []) => ({ game, injuries: { home, away } }) as unknown as Prediction;
    // Only likely absences worth real Elo count: a questionable star and a bench player out don't.
    const keys = keyAbsences(p([injury('1', 'Luka Doncic', 'Out', 1, 60), injury('2', 'Bench Guy', 'Out', 1, 3), injury('3', 'Austin Reaves', 'Questionable', 0.35, 30)]));
    assert.deepEqual(keys, ['1|LAL|Luka Doncic']);
    assert.deepEqual(injuryNews([], keys), { out: [{ name: 'Luka Doncic', team: 'LAL' }], back: [] });
    assert.deepEqual(injuryNews(keys, []), { out: [], back: [{ name: 'Luka Doncic', team: 'LAL' }] });
    assert.equal(injuryNews(keys, keys), null);
    assert.equal(injuryNews(undefined, keys), null, 'readings from before absences were kept say nothing');
    // A change in who's out is worth a reading on its own.
    const last = { ...snap('2026-11-02T12:00:00Z', 0.6), out: [] };
    assert.equal(worthKeeping(last, { ...snap('2026-11-02T12:10:00Z', 0.6), out: keys }), true);
    assert.equal(worthKeeping(last, { ...snap('2026-11-02T12:10:00Z', 0.6), out: [] }), false);
    // And the mover carries it.
    const movement = { g: [{ ...snap('2026-11-02T10:00:00Z', 0.62), out: [] }] };
    const now = { ...p([injury('1', 'Luka Doncic', 'Out', 1, 60)]), homeProb: 0.48, basis: 'model', market: null } as unknown as Prediction;
    const [mover] = biggestMovers(movement, [now], Date.parse('2026-11-02T11:00:00Z'));
    assert.deepEqual(mover.news, { out: [{ name: 'Luka Doncic', team: 'LAL' }], back: [] });
  });

  it('merges two writers without losing or duplicating readings', () => {
    const a = [snap('2026-10-24T12:00:00Z', 0.6), snap('2026-10-24T14:00:00Z', 0.62)];
    const b = [snap('2026-10-24T13:00:00Z', 0.61), snap('2026-10-24T14:00:00Z', 0.62)];
    const merged = mergeSnapshots(a, b);
    assert.deepEqual(
      merged.map((s) => s.t),
      ['2026-10-24T12:00:00Z', '2026-10-24T13:00:00Z', '2026-10-24T14:00:00Z']
    );
  });
});
