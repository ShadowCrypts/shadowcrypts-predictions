import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Game } from '../lib/espn';
import type { CorrelationTable } from '../lib/model/correlation';
import type { Actuals } from '../lib/model/propModel';
import { pickStandouts } from '../lib/model/standouts';
import { Outcome, shiftsGiven } from '../lib/model/whatIf';

const table: CorrelationTable = {
  same: { 'pra|pts': 0.8 },
  teammate: { 'pts|pts': -0.1 },
  opponent: {},
  win: { pts: 0.25 },
  meta: { games: 100, pairs: 1000, from: '2025-01-01', to: '2025-06-01' }
};
const tables = { nba: table };
const over = (playerId: string, teamId: string, market: 'pts' | 'pra', prob: number): Outcome => ({
  key: `${playerId}:${market}`,
  label: `${playerId} ${market}`,
  prob,
  link: { kind: 'prop', playerId, teamId, market, side: 'over' }
});
const win = (teamId: string, prob: number): Outcome => ({ key: `win:${teamId}`, label: `${teamId} win`, prob, link: { kind: 'win', teamId } });

describe('standouts', () => {
  const game = (id: string) => ({ id, home: { teamId: 'H', abbr: 'HOM' }, away: { teamId: 'A', abbr: 'AWY' } }) as unknown as Game;
  const stats = new Map([
    ['g1', new Map([['star', { pts: 41, reb: 12, ast: 9 }], ['big', { pts: 18, reb: 15, ast: 2 }]])],
    ['g2', new Map([['guard', { pts: 30, reb: 4, ast: 13 }], ['bench', { pts: 0, reb: 0, ast: 0 }]])]
  ]) as Map<string, Actuals>;
  const who = new Map([
    ['g1', new Map([['star', { name: 'Star', teamId: 'H' }], ['big', { name: 'Big', teamId: 'A' }]])],
    ['g2', new Map([['guard', { name: 'Guard', teamId: 'A' }], ['bench', { name: 'Bench', teamId: 'H' }]])]
  ]);

  it('takes the day’s best in each headline stat, nobody twice', () => {
    const picks = pickStandouts('nba', [game('g1'), game('g2')], stats, who);
    assert.deepEqual(
      picks.map((p) => [p.market, p.name, p.value, p.team]),
      [
        ['pts', 'Star', 41, 'HOM'],
        ['reb', 'Big', 15, 'AWY'],
        ['ast', 'Guard', 13, 'AWY']
      ]
    );
    assert.deepEqual(pickStandouts('mlb', [game('g1')], stats, who), []);
  });
});

describe('what if', () => {
  const star = over('star', 'H', 'pts', 0.5);
  const all = [win('A', 0.4), win('H', 0.6), star, over('star', 'H', 'pra', 0.5), over('mate', 'H', 'pts', 0.5), over('rival', 'A', 'pts', 0.5)];
  const shifts = shiftsGiven('nba', 'g1', star, all, tables);
  const after = (key: string) => shifts.find((s) => s.key === key)?.after;

  it('moves the outcomes linked to what happened, most first', () => {
    assert.equal(shifts[0].key, 'star:pra', 'his own points + rebounds + assists move most');
    assert.ok(after('star:pra')! > 0.75);
    assert.ok(after('win:H')! > 0.6, 'his team wins more often when he goes over');
    assert.ok(after('win:A')! < 0.4, 'and the other team less');
    assert.ok(after('mate:pts')! < 0.5, 'a teammate takes a few fewer shots');
  });

  it('leaves unlinked outcomes where they were, and itself out', () => {
    assert.ok(Math.abs(after('rival:pts')! - 0.5) < 1e-6);
    assert.equal(after('star:pts'), undefined);
  });

  it('never pairs the two teams winning, and stays a chance', () => {
    const given = shiftsGiven('nba', 'g1', win('H', 0.6), all, tables);
    assert.equal(given.find((s) => s.key === 'win:A'), undefined);
    for (const s of given) assert.ok(s.after >= 0 && s.after <= 1);
    assert.deepEqual(shiftsGiven('nba', 'g1', { ...star, prob: 0 }, all, tables), []);
  });
});
