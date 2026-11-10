import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Game, GameSide } from '../lib/espn';
import { pctCapped, signed, spreadLabel } from '../lib/format';
import { LEAGUES } from '../lib/leagues';
import type { Prediction } from '../lib/model';
import { toCard } from '../lib/model/card';
import { replay, winProbability } from '../lib/model/elo';
import { gameFlow, liveProbability, normalCdf, normalQuantile, remainingNow } from '../lib/model/live';
import { blendProbability, fairAmerican, impliedProbability, marketView } from '../lib/model/market';
import { bandFor, byBand, calibration, summarize } from '../lib/model/metrics';
import { etDateKey } from '../lib/time';

const close = (a: number, b: number, tolerance = 1e-6) => assert.ok(Math.abs(a - b) <= tolerance, `${a} is not within ${tolerance} of ${b}`);

function side(teamId: string, score: number | null, periods: number[] = []): GameSide {
  return { teamId, abbr: teamId.toUpperCase(), name: teamId, shortName: teamId, logo: null, score, winner: null, record: null, leaders: [], probable: null, periods };
}

function game(id: string, date: string, home: GameSide, away: GameSide, extra: Partial<Game> = {}): Game {
  const completed = home.score !== null && away.score !== null;
  return {
    id,
    league: 'nba',
    date,
    seasonYear: 2026,
    seasonType: 2,
    state: completed ? 'post' : 'pre',
    completed,
    statusName: '',
    statusDetail: completed ? 'Final' : '',
    period: null,
    clock: null,
    outs: null,
    neutral: false,
    venue: null,
    broadcast: null,
    note: null,
    home,
    away,
    odds: null,
    ...extra
  };
}

describe('metrics', () => {
  it('scores a coin flip at 0.25 Brier and ln 2 log loss', () => {
    const m = summarize([
      { homeProb: 0.5, homeWon: true },
      { homeProb: 0.5, homeWon: false }
    ]);
    close(m.brier, 0.25);
    close(m.logLoss, Math.log(2));
    assert.equal(m.games, 2);
  });

  it('counts a pick as correct when the favorite wins', () => {
    const m = summarize([
      { homeProb: 0.7, homeWon: true },
      { homeProb: 0.3, homeWon: false },
      { homeProb: 0.6, homeWon: false }
    ]);
    assert.equal(m.correct, 2);
  });

  it('bands by the pick side, not the home side', () => {
    assert.equal(bandFor(0.75), 'Strong');
    assert.equal(bandFor(0.5), 'Toss-up');
    const bands = byBand([{ homeProb: 0.2, homeWon: false }]);
    assert.equal(bands.find((b) => b.band === 'Strong')!.games, 1);
  });

  it('buckets calibration by stated confidence', () => {
    const buckets = calibration([
      { homeProb: 0.72, homeWon: true },
      { homeProb: 0.28, homeWon: true }
    ]);
    assert.equal(buckets.length, 1);
    assert.equal(buckets[0].games, 2);
    close(buckets[0].actual, 0.5);
  });

  it('returns zeros for no games instead of NaN', () => {
    assert.equal(summarize([]).accuracy, 0);
  });
});

describe('market', () => {
  it('converts American odds to implied probability', () => {
    close(impliedProbability(-150), 0.6);
    close(impliedProbability(150), 0.4);
    close(impliedProbability(100), 0.5);
  });

  it('removes the bookmaker margin from a moneyline', () => {
    const view = marketView({ provider: 'Book', details: null, homeSpread: null, overUnder: null, homeMoneyline: -110, awayMoneyline: -110 }, LEAGUES.nba);
    close(view!.homeProb, 0.5);
  });

  it('prices a spread only where points convert to probability', () => {
    const odds = { provider: 'Book', details: null, homeSpread: -3, overUnder: null, homeMoneyline: null, awayMoneyline: null };
    assert.ok(marketView(odds, LEAGUES.nba)!.homeProb > 0.5);
    assert.equal(marketView(odds, LEAGUES.mlb), null);
  });

  it('prices a probability as fair American odds, round-tripping through implied probability', () => {
    assert.equal(fairAmerican(0.5), -100);
    assert.equal(fairAmerican(0.6), -150);
    assert.equal(fairAmerican(0.4), 150);
    close(impliedProbability(fairAmerican(0.72)), 0.72, 0.002);
  });

  it('follows the market when the model share is 0', () => {
    close(blendProbability(0.9, 0.55, 0), 0.55);
    close(blendProbability(0.9, 0.55, 1), 0.9);
  });
});

describe('elo', () => {
  it('gives 64% for a 100-point edge', () => {
    close(winProbability(100), 0.64, 0.001);
    close(winProbability(0), 0.5);
  });

  it('keeps ratings zero-sum and grades every game before applying it', () => {
    const games = [
      game('1', '2026-01-01T00:00:00Z', side('a', 110), side('b', 100)),
      game('2', '2026-01-03T00:00:00Z', side('b', 105), side('a', 99)),
      game('3', '2026-01-05T00:00:00Z', side('a', null), side('b', null))
    ];
    const result = replay(games, LEAGUES.nba.elo);
    const total = [...result.ratings.values()].reduce((s, r) => s + r, 0);
    close(total, 3000, 1e-9);
    // The first game is predicted from even ratings plus home court only.
    close(result.contexts.get('1')!.homeProb, winProbability(LEAGUES.nba.elo.hfa));
    assert.ok(result.contexts.has('3'), 'upcoming games still get a forecast');
  });

  it('adds outside adjustments to the forecast', () => {
    const games = [game('1', '2026-01-01T00:00:00Z', side('a', null), side('b', null))];
    const plain = replay(games, LEAGUES.nba.elo).contexts.get('1')!;
    const adjusted = replay(games, LEAGUES.nba.elo, undefined, new Map([['1', -50]])).contexts.get('1')!;
    close(adjusted.diff, plain.diff - 50);
  });
});

describe('live win probability', () => {
  it('inverts the normal CDF', () => {
    for (const p of [0.01, 0.2, 0.5, 0.77, 0.99]) close(normalCdf(normalQuantile(p)), p, 1e-6);
  });

  it('starts at the pregame forecast and ends at the result', () => {
    close(liveProbability(0.63, 0, 1, 19.2, 0.1), 0.63, 1e-6);
    assert.equal(liveProbability(0.63, 2, 0, 19.2, 0.1), 1);
    assert.equal(liveProbability(0.63, -1, 0, 19.2, 0.1), 0);
  });

  it('gives a tie at the end to the favorite in overtime, but only slightly', () => {
    const p = liveProbability(0.7, 0, 0, 19.2, 5 / 48);
    assert.ok(p > 0.5 && p < 0.6, String(p));
  });

  it('moves toward the leader as time runs out', () => {
    const early = liveProbability(0.5, 6, 0.75, 19.2, 0.1);
    const late = liveProbability(0.5, 6, 0.1, 19.2, 0.1);
    assert.ok(late > early && early > 0.5);
  });

  it('reads the clock and innings from the feed', () => {
    close(remainingNow('nba', { period: 3, clock: '6:00', outs: null, statusDetail: '' })!, 18 / 48);
    close(remainingNow('nba', { period: 4, clock: '30.0', outs: null, statusDetail: '' })!, 0.5 / 48);
    close(remainingNow('mlb', { period: 5, clock: null, outs: 0, statusDetail: 'Mid 5th' })!, 9 / 18);
    assert.equal(remainingNow('nba', { period: null, clock: null, outs: null, statusDetail: '' }), null);
  });

  it('builds a flow from period scores, ending at the final', () => {
    const final = game('1', '2026-01-01T00:00:00Z', side('a', 100, [25, 25, 25, 25]), side('b', 90, [20, 20, 25, 25]));
    const flow = gameFlow('nba', final, 0.6);
    assert.deepEqual(
      flow.map((p) => p.label),
      ['Start', 'Q1', 'Q2', 'Q3', 'Final']
    );
    assert.equal(flow[flow.length - 1].homeProb, 1);
    assert.equal(flow[2].homeScore, 50);
  });
});

describe('cards', () => {
  it('carry a live probability only while the game is on', () => {
    const base: Omit<Prediction, 'game'> = {
      homeProb: 0.6,
      pick: 'home',
      pickProb: 0.6,
      band: 'Lean',
      modelHomeProb: 0.6,
      marketRatingHomeProb: 0.6,
      preLineHomeProb: 0.6,
      basis: 'model',
      netElo: 70,
      factors: [],
      modelSpread: null,
      market: null,
      disagreement: null,
      injuries: null,
      lineups: null,
      projected: null,
      source: 'live',
      correct: null
    };
    const live = game('1', '2026-01-01T00:00:00Z', side('a', 80, [25, 25, 30]), side('b', 60, [20, 20, 20]), { state: 'in', completed: false, period: 4, clock: '2:00', statusDetail: '2:00 - 4th' });
    const upcoming = game('2', '2026-01-02T00:00:00Z', side('a', null), side('b', null));
    const liveCard = toCard({ ...base, game: live });
    assert.ok(liveCard.liveHomeProb !== null && liveCard.liveHomeProb > 0.95, String(liveCard.liveHomeProb));
    assert.equal(toCard({ ...base, game: upcoming }).liveHomeProb, null);
  });
});

describe('formatting', () => {
  it('signs numbers with a true minus', () => {
    assert.equal(signed(3), '+3');
    assert.equal(signed(-3), '−3');
    assert.equal(signed(0.2), '0');
  });

  it('never shows an unsettled chance as 0% or 100%', () => {
    assert.equal(pctCapped(0.997), '>99%');
    assert.equal(pctCapped(0.003), '<1%');
    assert.equal(pctCapped(1), '100%');
    assert.equal(pctCapped(0.62), '62%');
  });

  it('labels spreads from the favorite', () => {
    assert.equal(spreadLabel('MIL', 'CHI', -1.5), 'MIL -1.5');
    assert.equal(spreadLabel('MIL', 'CHI', 2.5), 'CHI -2.5');
    assert.equal(spreadLabel('MIL', 'CHI', 0), 'Pick ’em');
  });

  it('groups games by Eastern date', () => {
    // 11:30 PM ET on Jan 1 is already Jan 2 in UTC.
    assert.equal(etDateKey('2026-01-02T04:30:00Z'), '2026-01-01');
  });
});
