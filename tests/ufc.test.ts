import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isKnownPage } from '../lib/routes';
import { rateFights, UFC_ELO, winChance } from '../lib/ufc/elo';
import { boutEnding, parseBout, parseSeason, parseUfcOdds, type UfcBout } from '../lib/ufc/feed';
import { lockedUfcEntry, type UfcLedgerEntry } from '../lib/ufc/ledger';
import { divisionOf, favoriteBand, noMargin, publishedChance, weightName } from '../lib/ufc/model';

const competitor = (id: string, name: string, order: number, winner = false) => ({
  id,
  order,
  winner,
  athlete: { displayName: name, shortName: name, flag: { alt: 'Brazil', href: 'https://a.espncdn.com/i/teamlogos/countries/500/bra.png' } },
  records: [{ name: 'overall', type: 'total', summary: '24-8-0' }]
});
const rawBout = (over: Record<string, unknown> = {}) => ({
  id: '401757863',
  date: '2025-04-13T02:00Z',
  type: { abbreviation: 'Featherweight' },
  format: { regulation: { periods: 5 } },
  status: { period: 5, displayClock: '5:00', type: { state: 'post', completed: true } },
  competitors: [competitor('2', 'Diego Lopes', 2), competitor('1', 'Alexander Volkanovski', 1, true)],
  ...over
});

describe('UFC feed', () => {
  it('reads a fight: the first-listed fighter is A (the "home" side of the line), and the result', () => {
    const bout = parseBout('600053165', rawBout(), 12)!;
    assert.equal(bout.a.name, 'Alexander Volkanovski');
    assert.equal(bout.b.name, 'Diego Lopes');
    assert.equal(bout.a.winner, true);
    assert.equal(bout.b.winner, false);
    assert.equal(bout.rounds, 5);
    assert.equal(bout.order, 13);
    assert.equal(bout.weightClass, 'Featherweight');
    assert.equal(bout.a.country, 'Brazil');
    assert.equal(bout.a.listedRecord, '24-8-0');
    assert.equal(boutEnding(bout), 'Decision');
  });

  it('keeps no result before a fight is over, and none when the feed marks both as winners', () => {
    const pre = parseBout('1', rawBout({ status: { type: { state: 'pre', completed: false } } }), 0)!;
    assert.equal(pre.state, 'pre');
    assert.equal(pre.a.winner, null);
    assert.equal(pre.round, null);
    assert.equal(boutEnding(pre), null);
    const both = parseBout('1', rawBout({ competitors: [competitor('1', 'A', 1, true), competitor('2', 'B', 2, true)] }), 0)!;
    assert.equal(both.a.winner, null);
    assert.equal(both.b.winner, null);
  });

  it('turns away a fight with a fighter missing or fighting themselves', () => {
    assert.equal(parseBout('1', rawBout({ competitors: [competitor('1', 'A', 1)] }), 0), null);
    assert.equal(parseBout('1', rawBout({ competitors: [competitor('1', 'A', 1), competitor('1', 'A', 2)] }), 0), null);
    assert.equal(parseBout('1', rawBout({ id: 'x' }), 0), null);
  });

  it('tells a decision from a stoppage by where the fight ended', () => {
    const at = (period: number, clock: string, winner = true) =>
      boutEnding(parseBout('1', rawBout({ format: { regulation: { periods: 3 } }, status: { period, displayClock: clock, type: { state: 'post', completed: true } }, competitors: [competitor('1', 'A', 1, winner), competitor('2', 'B', 2)] }), 0)!);
    assert.equal(at(3, '5:00'), 'Decision');
    assert.equal(at(2, '3:14'), 'Stoppage, round 2 (3:14)');
    assert.equal(at(3, '4:59'), 'Stoppage, round 3 (4:59)');
    assert.equal(at(3, '5:00', false), 'Draw');
    assert.equal(at(1, '0:41', false), 'Draw or no contest');
  });

  it('leaves the Contender Series (tryouts for a contract) off the schedule', () => {
    const events = parseSeason({
      events: [
        { id: '1', name: 'UFC 334: Gane vs. Hokit', competitions: [rawBout()] },
        { id: '2', name: "Dana White's Contender Series: Season 10, Week 10", competitions: [rawBout()] },
        { id: '3', name: 'UFC Fight Night: Empty', competitions: [] }
      ]
    });
    assert.deepEqual(
      events.map((e) => e.id),
      ['1']
    );
  });

  it('reads the line: pregame books before live ones, the closing price once there is one', () => {
    const odds = parseUfcOdds({
      items: [
        { provider: { name: 'ESPN BET - Live Odds', priority: 0 }, homeAthleteOdds: { moneyLine: -900 }, awayAthleteOdds: { moneyLine: 600 } },
        { provider: { name: 'DraftKings', priority: 1 }, homeAthleteOdds: { moneyLine: -230, close: { moneyLine: { american: '-250' } } }, awayAthleteOdds: { moneyLine: 190, close: { moneyLine: { american: '+210' } } } }
      ]
    });
    assert.deepEqual(odds, { provider: 'DraftKings', aMoneyline: -250, bMoneyline: 210 });
    assert.equal(parseUfcOdds({ items: [{ provider: { name: 'X' }, homeAthleteOdds: { moneyLine: 50 }, awayAthleteOdds: {} }] }), null);
    assert.equal(parseUfcOdds(null), null);
    // With the margin taken out, the two sides add up to one.
    const a = noMargin({ provider: 'X', aMoneyline: -230, bMoneyline: 190 });
    assert.ok(a > 0.65 && a < 0.68, String(a));
  });
});

describe('UFC ratings and forecasts', () => {
  const fight = (id: string, a: string, b: string, aWins: boolean | null, date: string, clock = '5:00'): UfcBout => ({
    id,
    eventId: 'e',
    date,
    order: 1,
    weightClass: 'Lightweight',
    rounds: 3,
    state: 'post',
    completed: true,
    round: 3,
    clock,
    a: { id: a, name: a, shortName: a, country: null, flag: null, listedRecord: null, winner: aWins === null ? null : aWins },
    b: { id: b, name: b, shortName: b, country: null, flag: null, listedRecord: null, winner: aWins === null ? null : !aWins }
  });

  it('moves the winner up and the loser down, more for a newcomer and for a finish', () => {
    const { fighters, rated } = rateFights([fight('1', 'x', 'y', true, '2020-01-01')]);
    const x = fighters.get('x')!;
    const y = fighters.get('y')!;
    assert.equal(rated.get('1')!.chanceA, 0.5);
    assert.ok(x.rating > UFC_ELO.debut && y.rating < UFC_ELO.debut);
    assert.equal(Math.round(x.rating - UFC_ELO.debut), Math.round(UFC_ELO.debut - y.rating));
    assert.deepEqual([x.wins, x.losses, y.wins, y.losses], [1, 0, 0, 1]);
    const finish = rateFights([fight('1', 'x', 'y', true, '2020-01-01', '2:10')]).fighters.get('x')!;
    assert.ok(finish.rating > x.rating, 'a finish counts for more');
  });

  it('scores a draw at the distance as half a win each, and a no contest not at all', () => {
    const draw = rateFights([fight('1', 'x', 'y', null, '2020-01-01')]).fighters;
    assert.equal(draw.get('x')!.draws, 1);
    assert.equal(draw.get('x')!.rating, UFC_ELO.debut);
    const nc = rateFights([{ ...fight('1', 'x', 'y', null, '2020-01-01'), round: 1, clock: '0:30' }]).fighters;
    assert.equal(nc.get('x')!.noContests, 1);
    assert.equal(nc.get('x')!.fights, 0);
  });

  it('rates fights in date order, whatever order they come in', () => {
    const later = fight('2', 'x', 'z', true, '2021-01-01');
    const earlier = fight('1', 'x', 'y', true, '2020-01-01');
    const { rated } = rateFights([later, earlier]);
    assert.equal(rated.get('1')!.chanceA, 0.5);
    assert.ok(rated.get('2')!.chanceA > 0.5, 'x was already up a win by the second fight');
    assert.ok(winChance(1600, 1400) > 0.75 && winChance(1400, 1600) < 0.25);
  });

  it('shows the market where there is a line and the ratings where there isn’t', () => {
    assert.equal(publishedChance(0.8, 0.6), 0.6);
    assert.equal(publishedChance(0.8, null), 0.8);
  });

  it('names divisions as people say them, and ranks no one at catchweight', () => {
    assert.equal(weightName('W Flyweight'), "Women's Flyweight");
    assert.equal(weightName("Women's Strawweight"), "Women's Strawweight");
    assert.equal(divisionOf('Catch Weight'), null);
    assert.equal(divisionOf('Heavyweight'), 'Heavyweight');
  });

  it('finds the favorite’s band from either side, only with enough fights behind it', () => {
    const bands = [
      { lo: 0.6, hi: 0.65, fights: 600, said: 0.62, won: 0.64 },
      { lo: 0.9, hi: 1, fights: 13, said: 0.91, won: 0.92 }
    ];
    assert.equal(favoriteBand(bands, 0.62)?.won, 0.64);
    assert.equal(favoriteBand(bands, 0.38)?.won, 0.64);
    assert.equal(favoriteBand(bands, 0.95), null);
  });
});

describe('UFC locked forecasts and addresses', () => {
  const entry = (takenAt: string, chanceA: number): UfcLedgerEntry => ({ takenAt, eventId: 'e', date: '2026-11-14T22:00:00Z', aId: 'a', bId: 'b', chanceA, ratingsA: 0.5, marketA: chanceA });
  const start = Date.parse('2026-11-14T22:00:00Z');

  it('keeps the last forecast taken before the fight', () => {
    assert.equal(lockedUfcEntry(entry('2026-11-14T21:00:00Z', 0.6), entry('2026-11-14T21:50:00Z', 0.62), start).chanceA, 0.62);
    assert.equal(lockedUfcEntry(entry('2026-11-14T21:50:00Z', 0.62), entry('2026-11-14T22:30:00Z', 0.9), start).chanceA, 0.62);
    assert.equal(lockedUfcEntry(entry('2026-11-14T22:40:00Z', 0.8), entry('2026-11-14T22:30:00Z', 0.9), start).chanceA, 0.9);
  });

  it('knows the UFC pages and nothing else under /ufc', () => {
    for (const ok of ['/ufc', '/ufc/event/600061400', '/ufc/fight/401913646', '/ufc/fighter/4426000']) assert.ok(isKnownPage(ok), ok);
    for (const bad of ['/ufc/event', '/ufc/fight/abc', '/ufc/fighters/1', '/ufc/fight/1/extra', '/ufc/standings']) assert.equal(isKnownPage(bad), false, bad);
  });
});
