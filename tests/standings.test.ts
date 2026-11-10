import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { byRecord, bySeed, gamesBehind, NHL_WILD_CARDS, parseStandingRow, parseStandings, StandingRow, wildCardTables } from '../lib/standings';

const entry = (id: string, stats: Record<string, unknown>, records: Record<string, string> = {}) => ({
  team: { id, abbreviation: id.toUpperCase(), shortDisplayName: `Team ${id}`, logos: [{ href: `https://a.espncdn.com/${id}.png` }] },
  stats: [
    ...Object.entries(stats).map(([name, value]) => ({ name, value, displayValue: String(value) })),
    ...Object.entries(records).map(([name, displayValue]) => ({ name, displayValue }))
  ]
});
const row = (o: Partial<StandingRow>): StandingRow => ({ teamId: 'x', abbr: 'X', name: 'X', logo: null, wins: 0, losses: 0, ties: 0, otLosses: 0, points: null, pct: 0, seed: null, streak: null, pointsFor: null, pointsAgainst: null, home: null, road: null, lastTen: null, ...o });

describe('reading a standings line', () => {
  it('reads an NHL line, keeping points and overtime losses and cutting the points off its records', () => {
    const r = parseStandingRow('nhl', entry('bos', { wins: 11, losses: 4, otLosses: 1, points: 23, playoffSeed: 2, pointsFor: 58, pointsAgainst: 38, streak: 'W2' }, { Home: '7-1-0', Road: '4-3-1', 'Last Ten Games': '7-2-1, 0 PTS' }))!;
    assert.deepEqual([r.wins, r.losses, r.otLosses, r.points, r.seed], [11, 4, 1, 23, 2]);
    assert.deepEqual([r.home, r.road, r.lastTen], ['7-1-0', '4-3-1', '7-2-1']);
    assert.equal(r.streak, 'W2');
    assert.equal(r.logo, 'https://a.espncdn.com/bos.png');
  });

  it("ignores the feed's points and overtime figures outside hockey, where they mean something else", () => {
    const r = parseStandingRow('nba', entry('bkn', { wins: 2, losses: 6, points: -2, otLosses: 11, winPercent: '.250' }))!;
    assert.equal(r.points, null);
    assert.equal(r.otLosses, 0);
    assert.equal(r.pct, 0.25);
  });

  it('reads a missing or zero seed as no seed, and missing stats as nothing rather than zero', () => {
    const r = parseStandingRow('nfl', entry('a', { wins: 1, losses: 0, playoffSeed: 0 }))!;
    assert.equal(r.seed, null);
    assert.equal(r.pointsFor, null);
    assert.equal(r.home, null);
    assert.equal(parseStandingRow('nfl', {}), null);
  });
});

describe('putting teams in order', () => {
  it("sorts a division by record, not the feed's order, level teams by official seed", () => {
    const rows = [row({ name: 'Third', pct: 0.4, seed: 1 }), row({ name: 'Tied, seeded later', pct: 0.6, seed: 5 }), row({ name: 'Tied, seeded first', pct: 0.6, seed: 2 })];
    assert.deepEqual([...rows].sort(byRecord('nba')).map((r) => r.name), ['Tied, seeded first', 'Tied, seeded later', 'Third']);
  });

  it('sorts hockey by points', () => {
    const rows = [row({ name: 'Better percentage', pct: 0.9, points: 10 }), row({ name: 'More points', pct: 0.5, points: 20 })];
    assert.equal([...rows].sort(byRecord('nhl'))[0].name, 'More points');
  });

  it('runs a conference by seed, with anyone unseeded behind by record', () => {
    const rows = [row({ name: 'No seed, worse', pct: 0.1 }), row({ name: 'Seed 2', seed: 2 }), row({ name: 'No seed, better', pct: 0.3 }), row({ name: 'Seed 1', seed: 1 })];
    assert.deepEqual([...rows].sort(bySeed('nfl')).map((r) => r.name), ['Seed 1', 'Seed 2', 'No seed, better', 'No seed, worse']);
  });

  it('builds conferences and divisions from the feed', () => {
    const standings = parseStandings('nba', {
      children: [
        {
          name: 'Eastern Conference',
          abbreviation: 'East',
          children: [
            { name: 'Atlantic', standings: { seasonDisplayName: '2026-27', entries: [entry('a', { wins: 1, losses: 7, winPercent: 0.125, playoffSeed: 15 }), entry('b', { wins: 6, losses: 2, winPercent: 0.75, playoffSeed: 1 })] } },
            { name: 'Central', standings: { entries: [entry('c', { wins: 4, losses: 4, winPercent: 0.5, playoffSeed: 8 })] } }
          ]
        }
      ]
    });
    assert.equal(standings.season, '2026-27');
    const [east] = standings.conferences;
    assert.equal(east.abbr, 'East');
    assert.deepEqual(east.divisions[0].rows.map((r) => r.teamId), ['b', 'a']);
    assert.deepEqual(east.rows.map((r) => r.teamId), ['b', 'c', 'a']);
  });

  it('has nothing to show from an empty feed', () => {
    assert.deepEqual(parseStandings('nba', {}).conferences, []);
  });
});

describe('the NHL wild card', () => {
  const team = (name: string, points: number, seed = 0) => row({ name, abbr: name, points, seed: seed || null });
  const strong = { name: 'Atlantic', rows: [team('A1', 30), team('A2', 28), team('A3', 26), team('A4', 25), team('A5', 24), team('A6', 23)] };
  const weak = { name: 'Metropolitan', rows: [team('M1', 27), team('M2', 20), team('M3', 12), team('M4', 11)] };

  it("keeps a weak division's third place in and a strong division's sixth out, though he has more points", () => {
    const [atlantic, metro, wild] = wildCardTables({ divisions: [strong, weak] });
    assert.deepEqual(atlantic.rows.map((r) => r.name), ['A1', 'A2', 'A3']);
    assert.deepEqual(metro.rows.map((r) => r.name), ['M1', 'M2', 'M3']);
    assert.equal(wild.name, 'Wild card');
    // M3 is in on 12 points; A6 has 23 and sits third in the wild-card table, on the wrong side of the line.
    assert.deepEqual(wild.rows.map((r) => r.name), ['A4', 'A5', 'A6', 'M4']);
    assert.ok(wild.rows.slice(0, NHL_WILD_CARDS).every((r) => r.name !== 'A6'));
  });

  it('leaves the conference as it found it', () => {
    wildCardTables({ divisions: [strong, weak] });
    assert.equal(strong.rows.length, 6);
    assert.equal(strong.rows[0].name, 'A1');
  });
});

describe('games behind', () => {
  it('counts wins and losses as half a game each', () => {
    const leader = { wins: 10, losses: 2 };
    assert.equal(gamesBehind(leader, leader), 0);
    assert.equal(gamesBehind(leader, { wins: 8, losses: 3 }), 1.5);
    assert.equal(gamesBehind(leader, { wins: 10, losses: 3 }), 0.5);
    // A team with fewer games can sit ahead of the leader by percentage's order: that reads as less than nothing.
    assert.equal(gamesBehind(leader, { wins: 11, losses: 2 }), -0.5);
  });
});
