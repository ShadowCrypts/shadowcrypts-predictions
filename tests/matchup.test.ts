import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { matchupProbability, matchupScore, seriesProbability } from '../lib/model/matchup';

const close = (a: number, b: number, tolerance = 1e-4) => assert.ok(Math.abs(a - b) <= tolerance, `${a} is not within ${tolerance} of ${b}`);
const team = (id: string, elo: number, market = elo, scoring = { offense: 0, defense: 0, venue: 0 }) => ({
  id,
  abbr: id,
  name: id,
  shortName: id,
  logo: null,
  elo,
  market,
  ...scoring
});
const league = { hfa: 40, ratingsShare: 0.2 };

describe('matchup machine', () => {
  it('is even for identical teams on neutral ground', () => {
    close(matchupProbability(league, team('a', 1500), team('b', 1500), 'neutral').probability, 0.5);
  });

  it('gives home field to whichever side hosts, symmetrically', () => {
    const a = team('a', 1550);
    const b = team('b', 1500);
    const aHome = matchupProbability(league, a, b, 'a').probability;
    const bHomeSeenFromB = matchupProbability(league, b, a, 'a').probability;
    close(matchupProbability(league, a, b, 'b').probability, 1 - bHomeSeenFromB);
    assert.ok(aHome > matchupProbability(league, a, b, 'neutral').probability);
  });

  it('projects a score whose winner is the favorite and whose total adds up', () => {
    const scoring = { scoring: { average: 22, marginPerLogit: 7 } };
    const even = matchupScore(scoring, team('a', 1500), team('b', 1500), 'neutral', 0.5);
    close(even.a, 22);
    close(even.b, 22);
    // A good offense facing a leaky defense, at a high-scoring venue.
    const a = team('a', 1550, 1550, { offense: 3, defense: -1, venue: 2 });
    const b = team('b', 1500, 1500, { offense: 0, defense: 2, venue: 0 });
    const s = matchupScore(scoring, a, b, 'a', 0.65);
    close(s.a + s.b, 44 + 2 + 3 + 2 + 0 - 1);
    assert.ok(s.a > s.b);
    close(s.a - s.b, 7 * Math.log(0.65 / 0.35));
  });

  it('wins a best-of-7 at the textbook rates', () => {
    close(seriesProbability(0.5, 0.5, [1, 1, 0, 0, 1, 0, 1]), 0.5);
    // A 60% team in every game wins a best-of-7 about 71% of the time.
    close(seriesProbability(0.6, 0.6, [1, 1, 0, 0, 1, 0, 1]), 0.71021, 1e-4);
    // Home court only matters through which games are at home.
    assert.ok(seriesProbability(0.6, 0.4, [1, 1, 0, 0, 1, 0, 1]) > 0.5);
  });
});
