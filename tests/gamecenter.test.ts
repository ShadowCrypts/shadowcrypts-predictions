import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseGameCenter } from '../lib/gamecenter';
import type { LeagueConfig } from '../lib/leagues';

const league = (id: string) => ({ id }) as LeagueConfig;
const play = (id: string, text: string, extra: object = {}) => ({ id, text, period: { number: 1 }, clock: { displayValue: '5:00' }, awayScore: 0, homeScore: 0, ...extra });

describe('game center', () => {
  describe('football plays', () => {
    const data = {
      drives: {
        previous: [
          { team: { id: '3' }, plays: [play('1', 'Kickoff'), play('2', 'Pass complete')] },
          { team: { id: '26' }, plays: [play('3', 'Run for 4'), play('4', 'END QUARTER 1', { type: { text: 'End Period' } })] }
        ],
        current: { team: { id: '3' }, plays: [play('5', 'Sack'), play('3', 'Run for 4')] }
      },
      scoringPlays: [{ ...play('9', 'Touchdown'), team: { id: '3' } }]
    };

    it('come from inside each drive, newest first, under the team with the ball', () => {
      const { recent } = parseGameCenter(league('nfl'), data);
      // Kept once however often a play is repeated, and without the clock markers.
      assert.deepEqual(recent.map((p) => p.text), ['Sack', 'Run for 4', 'Pass complete', 'Kickoff']);
      assert.deepEqual(recent.map((p) => p.teamId), ['3', '26', '3', '3']);
    });

    it('take a play from the drive still going, and stay separate from the scoring plays', () => {
      const center = parseGameCenter(league('nfl'), data);
      assert.equal(center.recent[0].text, 'Sack');
      assert.deepEqual(center.scoring.map((p) => [p.text, p.scoring]), [['Touchdown', true]]);
    });

    it('come back empty rather than failing when a game has no drives yet', () => {
      assert.deepEqual(parseGameCenter(league('nfl'), {}).recent, []);
    });
  });

  it('reads every other sport from its one list of plays', () => {
    const data = { plays: [play('1', 'First'), play('2', 'Second', { team: { id: '7' }, scoringPlay: true })] };
    const center = parseGameCenter(league('nhl'), data);
    assert.deepEqual(center.recent.map((p) => [p.text, p.teamId]), [['Second', '7'], ['First', null]]);
    assert.deepEqual(center.scoring.map((p) => p.text), ['Second']);
  });

  describe('baseball leaders, which ESPN leaves out of the summary', () => {
    const batter = (name: string, id: string, line: string, h: number, hr: number, rbi: number) => ({ athlete: { id, displayName: name }, stats: [line, '4', '1', String(h), String(rbi), String(hr)] });
    const pitcher = (name: string, id: string, ip: string, er: number, k: number) => ({ athlete: { id, displayName: name }, stats: [ip, '5', String(er), String(er), '1', String(k), '0', '90-60', '3.00', '90'] });
    const box = {
      boxscore: {
        players: [
          {
            team: { id: '30' },
            statistics: [
              { type: 'batting', keys: ['hits-atBats', 'atBats', 'runs', 'hits', 'RBIs', 'homeRuns'], athletes: [batter('Singles', '1', '3-4', 3, 0, 0), batter('Slugger', '2', '1-4', 1, 1, 3), batter('Bench', '3', '0-1', 0, 0, 0)] },
              { type: 'pitching', keys: ['fullInnings.partInnings', 'hits', 'runs', 'earnedRuns', 'walks', 'strikeouts', 'homeRuns', 'pitches-strikes', 'ERA', 'pitches'], athletes: [pitcher('Reliever', '4', '1.0', 0, 2), pitcher('Starter', '5', '6.2', 2, 7)] }
            ]
          }
        ]
      }
    };

    it("come from the box score: the best day at the plate and whoever pitched longest", () => {
      const [{ teamId, performers }] = parseGameCenter(league('mlb'), box).leaders;
      assert.equal(teamId, '30');
      // A home run and three driven in beat three singles.
      assert.deepEqual(performers[0], { category: 'Batting', name: 'Slugger', value: '1-4, 1 HR, 3 RBI', id: '2' });
      assert.deepEqual(performers[1], { category: 'Pitching', name: 'Starter', value: '6.2 IP, 2 ER, 7 K', id: '5' });
    });

    it('leave out what a hitter did not do, and any other league alone', () => {
      const singles = { boxscore: { players: [{ team: { id: '1' }, statistics: [{ type: 'batting', keys: box.boxscore.players[0].statistics[0].keys, athletes: [batter('Singles', '1', '3-4', 3, 0, 0)] }] }] } };
      assert.equal(parseGameCenter(league('mlb'), singles).leaders[0].performers[0].value, '3-4');
      assert.deepEqual(parseGameCenter(league('nfl'), box).leaders, []);
    });
  });
});
