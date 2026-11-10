import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Game } from '../lib/espn';
import type { Prediction } from '../lib/model';
import { overlay } from '../lib/model/fresh';

const side = (teamId: string, score: number | null) => ({ teamId, abbr: teamId, name: teamId, shortName: teamId, logo: null, score, winner: null, record: null, leaders: [], probable: null, periods: [] as number[] });
const game = (over: Partial<Game> = {}): Game => ({
  id: '1',
  league: 'nba',
  date: '2026-10-28T23:00:00Z',
  seasonYear: 2027,
  seasonType: 2,
  state: 'in',
  completed: false,
  statusName: 'STATUS_IN_PROGRESS',
  statusDetail: '5:12 - 2nd Quarter',
  period: 2,
  clock: '5:12',
  outs: null,
  neutral: false,
  venue: 'Arena',
  broadcast: null,
  note: null,
  home: side('H', 40),
  away: side('A', 38),
  odds: null,
  ...over
});
const prediction = (g: Game) => ({ game: g, pick: 'home', pickProb: 0.6, homeProb: 0.6, correct: null }) as unknown as Prediction;

describe('latest scores over the model', () => {
  it('leaves a prediction alone when nothing moved', () => {
    const p = prediction(game());
    assert.equal(overlay(p, game()), p);
    assert.equal(overlay(p, undefined), p);
  });

  it('takes the latest score, clock and status, and keeps the forecast', () => {
    const p = prediction(game());
    const now = overlay(p, game({ statusDetail: '0:41 - 3rd Quarter', period: 3, clock: '0:41', home: side('H', 70), away: side('A', 75) }));
    assert.equal(now.game.home.score, 70);
    assert.equal(now.game.away.score, 75);
    assert.equal(now.game.period, 3);
    assert.equal(now.pickProb, 0.6);
    assert.equal(now.game.venue, 'Arena', 'everything else from the model');
    assert.equal(now.correct, null);
  });

  it('grades the forecast the moment the game is final', () => {
    const p = prediction(game());
    const won = overlay(p, game({ state: 'post', completed: true, statusDetail: 'Final', home: side('H', 110), away: side('A', 101) }));
    assert.equal(won.correct, true);
    const lost = overlay(p, game({ state: 'post', completed: true, statusDetail: 'Final', home: side('H', 99), away: side('A', 101) }));
    assert.equal(lost.correct, false);
  });
});
