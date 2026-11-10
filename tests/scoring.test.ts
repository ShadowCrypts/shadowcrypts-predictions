import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Game, GameSide } from '../lib/espn';
import { projectScore, scoringPass } from '../lib/model/scoring';

const close = (a: number, b: number, tolerance = 1e-6) => assert.ok(Math.abs(a - b) <= tolerance, `${a} is not within ${tolerance} of ${b}`);

const side = (teamId: string, score: number | null): GameSide => ({
  teamId,
  abbr: teamId,
  name: teamId,
  shortName: teamId,
  logo: null,
  score,
  winner: null,
  record: null,
  leaders: [],
  probable: null,
  periods: []
});

let day = 0;
function game(home: string, away: string, homeScore: number | null, awayScore: number | null, seasonYear = 2024): Game {
  day += 1;
  const completed = homeScore !== null;
  return {
    id: String(day),
    league: 'nfl',
    date: new Date(Date.UTC(seasonYear, 8, 1) + day * 86_400_000).toISOString(),
    seasonYear,
    seasonType: 2,
    state: completed ? 'post' : 'pre',
    completed,
    statusName: '',
    statusDetail: '',
    period: null,
    clock: null,
    outs: null,
    neutral: false,
    venue: null,
    broadcast: null,
    note: null,
    home: side(home, homeScore),
    away: side(away, awayScore),
    odds: null
  };
}

describe('scoring model', () => {
  it('learns which teams score and which defenses leak, using only earlier games', () => {
    const games: Game[] = [];
    // A scores 30 on everyone, B scores 20; whoever faces C scores 6 more.
    for (let i = 0; i < 40; i += 1) {
      games.push(game('A', 'B', 30, 20));
      games.push(game('C', 'A', 20, 36));
      games.push(game('B', 'C', 26, 20));
    }
    const upcoming = game('C', 'B', null, null);
    games.push(upcoming);
    const pass = scoringPass(games, { k: 0.1, regress: 0, leagueStep: 0.01, venueK: 0 });
    // The first game knew nothing yet.
    const first = pass.expected.get(games[0].id)!;
    close(first.home, first.away);
    assert.ok(pass.state.offense.get('A')! > pass.state.offense.get('B')!, 'A scores more');
    assert.ok(pass.state.defense.get('C')! > pass.state.defense.get('A')!, 'C allows more');
    const next = pass.expected.get(upcoming.id)!;
    assert.ok(next.away > next.home, 'B should outscore C, whose defense leaks');
  });

  it('pulls ratings back toward average between seasons', () => {
    const games = [game('A', 'B', 40, 10, 2023), game('A', 'B', null, null, 2024)];
    const kept = scoringPass(games, { k: 0.1, regress: 0, leagueStep: 0, venueK: 0 });
    const halved = scoringPass(games, { k: 0.1, regress: 0.5, leagueStep: 0, venueK: 0 });
    const gap = (p: typeof kept) => p.expected.get(games[1].id)!.home - p.expected.get(games[1].id)!.away;
    close(gap(halved), gap(kept) / 2, 1e-9);
  });

  it('projects a score that agrees with the forecast and the posted numbers', () => {
    const expected = { home: 24, away: 20 };
    const params = { marginPerLogit: 7 };
    // Posted spread and total win where they exist.
    const posted = projectScore(0.7, expected, { homeSpread: -3.5, overUnder: 47.5 }, params, true);
    close(posted.home, 25.5);
    close(posted.away, 22);
    assert.equal(posted.totalFrom, 'market');
    assert.equal(posted.marginFrom, 'spread');
    // Without a line, the total is the model's and the margin follows the probability.
    const model = projectScore(0.5, expected, null, params, true);
    close(model.home, 22);
    close(model.away, 22);
    assert.equal(model.totalFrom, 'model');
    // Run lines don't carry a margin, so the probability sets it even with a line posted.
    const baseball = projectScore(0.6, { home: 4.5, away: 4 }, { homeSpread: -1.5, overUnder: 8.5 }, { marginPerLogit: 2 }, false);
    close(baseball.home + baseball.away, 8.5);
    close(baseball.home - baseball.away, 2 * Math.log(0.6 / 0.4));
  });
});
