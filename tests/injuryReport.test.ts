import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { InjuryEntry } from '../lib/espn';
import type { InjuryImpact } from '../lib/model/adjustments';
import { biggestAbsences, eloToPoints, teamInjuryReport } from '../lib/model/injuryReport';

const entry = (athleteId: string, status: string, name = `P${athleteId}`): InjuryEntry => ({ athleteId, name, position: 'G', status, comment: null, date: null });
const impact = (e: InjuryEntry, elo: number): InjuryImpact => ({ ...e, missChance: 1, value: -elo, elo, reason: 'Reason' });
const team = { id: 'A', name: 'Alphas of A', shortName: 'Alphas', abbr: 'AAA', logo: null, color: '#000' };
const side = (teamId: string, abbr: string) => ({ teamId, abbr }) as never;
const next = (home: InjuryImpact[], away: InjuryImpact[], homeId = 'A') => ({ game: { id: 'g1', date: '2026-11-08T18:00Z', home: side(homeId, homeId === 'A' ? 'AAA' : 'BBB'), away: side(homeId === 'A' ? 'B' : 'A', homeId === 'A' ? 'BBB' : 'AAA') }, injuries: { home, away } });

describe('injury report', () => {
  it('prices each player from his own side of the next game, costliest first', () => {
    const star = entry('1', 'Out');
    const bench = entry('2', 'Out');
    const report = teamInjuryReport(team, [bench, star], next([impact(star, -40), impact(bench, -2)], [impact(entry('1', 'Out'), -99)]));
    assert.deepEqual(report.rows.map((r) => [r.id, r.elo]), [['1', -40], ['2', -2]]);
    assert.deepEqual(report.next, { gameId: 'g1', opponent: 'BBB', home: true, date: '2026-11-08T18:00Z' });
  });

  it('reads the away side when the team is away', () => {
    const star = entry('1', 'Out');
    const report = teamInjuryReport(team, [star], next([impact(star, -99)], [impact(star, -5)], 'B'));
    assert.equal(report.rows[0].elo, -5);
    assert.equal(report.next?.home, false);
    assert.equal(report.next?.opponent, 'BBB');
  });

  it('leaves "Active" off, and says nothing about cost with no game on the board', () => {
    const report = teamInjuryReport(team, [entry('1', 'Active'), entry('2', 'Questionable')], null);
    assert.deepEqual(report.rows.map((r) => r.id), ['2']);
    assert.equal(report.rows[0].elo, null);
    assert.equal(report.next, null);
  });

  it('counts someone the forecast left out as costing nothing, not as unknown', () => {
    assert.equal(teamInjuryReport(team, [entry('9', 'Out')], next([], [])).rows[0].elo, 0);
  });

  it('breaks a tie in cost by who is more likely to sit', () => {
    const report = teamInjuryReport(team, [entry('1', 'Questionable', 'A'), entry('2', 'Out', 'B')], next([], []));
    assert.deepEqual(report.rows.map((r) => r.id), ['2', '1']);
  });

  it('lists only absences anyone could notice, across teams, worst first', () => {
    const one = teamInjuryReport(team, [entry('1', 'Out'), entry('2', 'Out')], next([impact(entry('1', 'Out'), -10), impact(entry('2', 'Out'), -0.2)], []));
    const two = teamInjuryReport({ ...team, id: 'C' }, [entry('3', 'Out')], next([impact(entry('3', 'Out'), -30)], [], 'C'));
    assert.deepEqual(biggestAbsences([one, two]).map((b) => b.row.id), ['3', '1']);
    assert.equal(biggestAbsences([one, two], 1).length, 1);
  });

  it('turns Elo into points of win chance for an even game', () => {
    assert.ok(Math.abs(eloToPoints(100) - 14) < 0.1);
    assert.ok(Math.abs(eloToPoints(-100) + 14) < 0.1);
    assert.equal(eloToPoints(0), 0);
  });
});
