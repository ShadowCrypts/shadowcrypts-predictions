import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { BracketGame, BracketInput, BracketOutlook, BracketStage, BracketTeam, ROUNDS, seriesWinProbability, simulateBracket } from '../lib/model/bracket';
import { FORMAT_RULES, PlayoffFormat } from '../lib/model/season';

const close = (a: number, b: number, tolerance = 1e-9) => assert.ok(Math.abs(a - b) <= tolerance, `${a} is not within ${tolerance} of ${b}`);

/** Two conferences, each with a full field; team ids are `${conference}${seed}`, e.g. A1. */
function field(format: PlayoffFormat, rating: (id: string) => number = () => 1500): BracketTeam[] {
  const teams: BracketTeam[] = [];
  for (const conference of ['A', 'B']) {
    for (let seed = 1; seed <= FORMAT_RULES[format].field; seed += 1) {
      const id = `${conference}${seed}`;
      // NHL: odd seeds in one division, even in the other, so each has four teams in the field.
      teams.push({ id, conference, division: `${conference}-${seed % 2}`, seed, standing: 1 - seed / 100 - (conference === 'B' ? 0.001 : 0), rating: rating(id) });
    }
  }
  return teams;
}

/** `wins` finished games won by `winner`, at the winner's park. */
function won(winner: string, loser: string, wins: number, stage: BracketStage = 'playoffs'): BracketGame[] {
  return Array.from({ length: wins }, () => ({ homeId: winner, awayId: loser, stage, winnerId: winner, homeProb: null, neutral: false }));
}

const run = (input: BracketInput, sims = 20_000) => simulateBracket(input, { sims });
const team = (outlook: BracketOutlook, id: string) => outlook.teams.find((t) => t.id === id)!;
const sum = (outlook: BracketOutlook, pick: (t: BracketOutlook['teams'][number]) => number) => outlook.teams.reduce((s, t) => s + pick(t), 0);

/** MLB with every series decided except the World Series between A1 and B1 (A1 hosts the opener). */
function worldSeries(games: BracketGame[], rating?: (id: string) => number): BracketInput {
  const path = (c: string) => [
    ...won(`${c}3`, `${c}6`, 2),
    ...won(`${c}4`, `${c}5`, 2),
    ...won(`${c}1`, `${c}4`, 3),
    ...won(`${c}2`, `${c}3`, 3),
    ...won(`${c}1`, `${c}2`, 4)
  ];
  return { format: 'mlb', teams: field('mlb', rating), games: [...path('A'), ...path('B'), ...games], homeEdge: 0 };
}

describe('series math', () => {
  it('matches known best-of-seven values with even games', () => {
    close(seriesWinProbability(7, 3, 1, () => 0.5), 0.875);
    close(seriesWinProbability(7, 3, 0, () => 0.5), 0.9375);
    close(seriesWinProbability(7, 0, 0, () => 0.5), 0.5);
    close(seriesWinProbability(7, 1, 3, () => 0.5), 0.125);
    close(seriesWinProbability(7, 3, 3, () => 0.5), 0.5);
    // Up 2-0: lose at most three of the next five.
    close(seriesWinProbability(7, 2, 0, () => 0.5), 0.8125);
  });

  it('returns certainties for a settled series and the game odds for a single game', () => {
    assert.equal(seriesWinProbability(7, 4, 2, () => 0.1), 1);
    assert.equal(seriesWinProbability(5, 1, 3, () => 0.9), 0);
    close(seriesWinProbability(1, 0, 0, () => 0.62), 0.62);
  });

  it('uses each game’s own odds', () => {
    // Best of three from 0-0: win both, or split the first two and win the third.
    const odds = [0.7, 0.4, 0.6];
    close(seriesWinProbability(3, 0, 0, (g) => odds[g]), 0.7 * 0.4 + 0.7 * 0.6 * 0.6 + 0.3 * 0.4 * 0.6);
  });
});

describe('bracket simulation', () => {
  for (const format of ['nfl', 'nba', 'mlb', 'nhl'] as PlayoffFormat[]) {
    it(`fills every ${format.toUpperCase()} round and crowns one champion per simulation`, () => {
      const outlook = run({ format, teams: field(format, (id) => 1450 + Number(id.slice(1)) * -7 + (id[0] === 'A' ? 10 : 0)), games: [], homeEdge: 30 }, 4000);
      close(sum(outlook, (t) => t.title), 1);
      // Two teams per series in each round; byes count as alive.
      const slots: Record<PlayoffFormat, number[]> = { nfl: [14, 8, 4, 2], nba: [20, 16, 8, 4, 2], mlb: [12, 8, 4, 2], nhl: [16, 8, 4, 2] };
      slots[format].forEach((expected, r) => close(sum(outlook, (t) => t.reach[r]), expected, 1e-9));
      for (const t of outlook.teams) {
        for (let r = 1; r < t.reach.length; r += 1) assert.ok(t.reach[r] <= t.reach[r - 1], `${t.id} round ${r}`);
        assert.ok(t.title <= t.reach[t.reach.length - 1]);
      }
      assert.equal(outlook.current, 0);
      assert.equal(outlook.rounds.length, ROUNDS[format].length);
    });
  }

  it('plays a series on from its score: 3-1 with even games is 87.5%', () => {
    const outlook = run(worldSeries([...won('A1', 'B1', 2), ...won('B1', 'A1', 1), ...won('A1', 'B1', 1)]));
    const final = outlook.series.find((s) => s.round === 3)!;
    assert.deepEqual(final.teams, ['A1', 'B1']);
    assert.deepEqual(final.wins, [3, 1]);
    close(final.odds, 0.875, 0.01);
    close(team(outlook, 'A1').title, final.odds);
    close(team(outlook, 'A1').title + team(outlook, 'B1').title, 1);
    assert.equal(outlook.current, 3);
  });

  it('gives an even series at 0-0 even odds', () => {
    const outlook = run(worldSeries([]));
    close(outlook.series.find((s) => s.round === 3)!.odds, 0.5, 0.012);
  });

  it('keeps eliminated teams at zero', () => {
    const outlook = run(worldSeries([]), 2000);
    for (const t of outlook.teams.filter((x) => !['A1', 'B1'].includes(x.id))) {
      assert.equal(t.title, 0, t.id);
      assert.notEqual(t.out, null, t.id);
      assert.equal(t.reach[t.out! + 1], 0, t.id);
    }
    assert.equal(team(outlook, 'A5').out, 0);
    assert.equal(team(outlook, 'A4').out, 1);
    assert.equal(team(outlook, 'A2').out, 2);
    assert.equal(team(outlook, 'A1').reached, 3);
    // Settled series read as certainties.
    for (const s of outlook.series.filter((x) => x.round < 3)) assert.equal(s.odds, 1);
  });

  it('uses each scheduled game’s forecast at its real home team', () => {
    // A1 hosts games 1-2 and 6-7, B1 hosts 3-5; the forecast favors the home side 70-30 every time.
    const host = ['A1', 'A1', 'B1', 'B1', 'B1', 'A1', 'A1'];
    const schedule: BracketGame[] = host.map((h) => ({ homeId: h, awayId: h === 'A1' ? 'B1' : 'A1', stage: 'playoffs', winnerId: null, homeProb: 0.7, neutral: false }));
    const outlook = run(worldSeries(schedule), 40_000);
    const exact = seriesWinProbability(7, 0, 0, (g) => (host[g] === 'A1' ? 0.7 : 0.3));
    const final = outlook.series.find((s) => s.round === 3)!;
    close(final.odds, exact, 0.01);
    assert.deepEqual(final.next, { game: 1, homeId: 'A1', prob: 0.7, live: false });
  });

  it('falls back to ratings and the 2-3-2 pattern for games not on the schedule', () => {
    const rating = (id: string) => (id === 'A1' ? 1600 : 1500);
    const outlook = run({ ...worldSeries([], rating), homeEdge: 40 }, 40_000);
    const elo = (diff: number) => 1 / (1 + 10 ** (-diff / 400));
    const pattern = [1, 1, -1, -1, -1, 1, 1];
    const exact = seriesWinProbability(7, 0, 0, (g) => elo(100 + pattern[g] * 40));
    close(outlook.series.find((s) => s.round === 3)!.odds, exact, 0.01);
  });

  it('keeps the NBA 7-vs-8 play-in loser alive for a second chance', () => {
    const games = [...won('A8', 'A7', 1, 'play-in'), ...won('A9', 'A10', 1, 'play-in')];
    const outlook = run({ format: 'nba', teams: field('nba'), games, homeEdge: 30 }, 2000);
    assert.equal(team(outlook, 'A7').out, null);
    assert.equal(team(outlook, 'A10').out, 0);
    // A8 is now the 7 seed and meets A2 in the first round.
    assert.ok(outlook.series.some((s) => s.round === 1 && s.teams.includes('A2') && s.teams.includes('A8')));
    // The 7/8 loser hosts the 9/10 winner for the last spot.
    const last = outlook.series.find((s) => s.round === 0 && s.teams.includes('A7') && s.teams.includes('A9'))!;
    assert.deepEqual(last.teams, ['A7', 'A9']);
    const after = run({ format: 'nba', teams: field('nba'), games: [...games, ...won('A9', 'A7', 1, 'play-in')], homeEdge: 30 }, 2000);
    assert.equal(team(after, 'A7').out, 0);
    assert.equal(team(after, 'A9').reached, 1);
  });

  it('reseeds the NFL divisional round: the top seed hosts the lowest seed left', () => {
    const games = [...won('A2', 'A7', 1), ...won('A6', 'A3', 1), ...won('A4', 'A5', 1)];
    const outlook = run({ format: 'nfl', teams: field('nfl'), games, homeEdge: 36 }, 2000);
    const divisional = outlook.series.filter((s) => s.round === 1 && s.conference === 'A').map((s) => s.teams);
    assert.deepEqual(divisional, [
      ['A1', 'A6'],
      ['A2', 'A4']
    ]);
    // Until every wild-card game is in, neither pairing is known.
    const partial = run({ format: 'nfl', teams: field('nfl'), games: games.slice(0, 2), homeEdge: 36 }, 500);
    assert.equal(partial.series.filter((s) => s.round === 1 && s.conference === 'A').length, 0);
    assert.equal(team(partial, 'A1').reached, 1);
  });

  it('pairs the better NHL division winner with the second wild card', () => {
    // Division A-1 holds seeds 1, 3, 5, 7 and A-0 holds 2, 4, 6, 8: top three each, then 7 and 8 are the wild cards.
    const outlook = run({ format: 'nhl', teams: field('nhl'), games: [], homeEdge: 30 }, 200);
    const firstRound = outlook.series.filter((s) => s.round === 0 && s.conference === 'A').map((s) => [...s.teams].sort().join('-'));
    assert.deepEqual(firstRound.sort(), ['A1-A8', 'A2-A7', 'A3-A5', 'A4-A6']);
  });

  it('refuses results that don’t fit the bracket the seeds imply', () => {
    // MLB's 1 seed has a bye; it can't have played the 6 seed in the wild-card round.
    assert.throws(() => run({ format: 'mlb', teams: field('mlb'), games: won('A1', 'A6', 1), homeEdge: 18 }, 50), /don't fit/);
    // A seed missing from the field.
    assert.throws(() => run({ format: 'mlb', teams: field('mlb').filter((t) => t.id !== 'B4'), games: [], homeEdge: 18 }, 50), /seeds/);
  });

  it('reports a decided final as the champion', () => {
    const outlook = run(worldSeries(won('B1', 'A1', 4)), 100);
    assert.equal(outlook.champion, 'B1');
    assert.equal(team(outlook, 'B1').title, 1);
    assert.equal(team(outlook, 'A1').out, 3);
    assert.equal(outlook.current, 4);
  });

  it('is reproducible with a seed', () => {
    const input: BracketInput = { format: 'nhl', teams: field('nhl', (id) => 1480 + id.length * 9 + Number(id.slice(1))), games: [], homeEdge: 30 };
    assert.deepEqual(simulateBracket(input, { sims: 500, seed: 3 }), simulateBracket(input, { sims: 500, seed: 3 }));
  });
});
