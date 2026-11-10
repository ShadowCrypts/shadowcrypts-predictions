import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { BoxScore, NflSkillBox } from '../lib/boxscores';
import type { Game } from '../lib/espn';
import { metricText, METRICS, teamMetrics } from '../lib/model/teamMetrics';

const close = (a: number, b: number, tolerance = 0.005) => assert.ok(Math.abs(a - b) <= tolerance, `${a} is not within ${tolerance} of ${b}`);
const game = (id: string) => ({ id, home: { teamId: 'H' }, away: { teamId: 'A' } }) as unknown as Game;

describe('team metrics', () => {
  it('rates basketball per 100 possessions, the same possessions for both teams', () => {
    const line = (o: Partial<Record<string, number | boolean>>) => ({ id: 'x', name: 'x', starter: true, min: 48, pts: 0, fgm: 0, fga: 0, ftm: 0, fta: 0, oreb: 0, dreb: 0, ast: 0, stl: 0, blk: 0, tov: 0, pf: 0, pm: 0, dnp: false, reason: null, ...o });
    const box: Record<string, BoxScore> = {
      g: {
        league: 'nba',
        teams: {
          // Home: 90 + 0.44 × 25 − 10 + 12 = 103 possessions. Away: 85 + 0.44 × 20 − 8 + 14 = 99.8. Shared: 101.4.
          H: [line({ pts: 120, fga: 90, fta: 25, oreb: 10, dreb: 35, tov: 12, min: 240 }), line({ pts: 999, fga: 999, dnp: true })],
          A: [line({ pts: 100, fga: 85, fta: 20, oreb: 8, dreb: 30, tov: 14, min: 240 })]
        }
      } as BoxScore
    };
    const { H, A } = teamMetrics('nba', [game('g')], box, {});
    close(H.off, (100 * 120) / 101.4);
    close(H.def, (100 * 100) / 101.4);
    close(H.net, H.off - H.def);
    close(H.net, -A.net);
    close(H.pace, 101.4);
    // A player who sat counts for nothing. 120 points on 90 shots and 25 free throws.
    close(H.ts, 120 / (2 * (90 + 0.44 * 25)));
    close(H.tov, 12 / 103);
    // Ten of their misses back, against 30 rebounds by the other side.
    close(H.oreb, 10 / 40);
  });

  it('adds up shots and goaltending in hockey', () => {
    const skaters = (sog: number, g: number) => [{ id: 's', name: 's', toi: 20, g, a: 0, sog, bs: 0 }];
    const goalies = (sa: number, ga: number) => [{ id: 'g', name: 'g', toi: 60, sa, ga }];
    const box = { g: { league: 'nhl', teams: { H: { skaters: skaters(30, 3), goalies: goalies(20, 1) }, A: { skaters: skaters(20, 1), goalies: goalies(30, 3) } } } } as unknown as Record<string, BoxScore>;
    const { H, A } = teamMetrics('nhl', [game('g')], box, {});
    close(H.share, 0.6);
    close(A.share, 0.4);
    close(H.sf, 30);
    close(H.sa, 20);
    close(H.sh, 0.1);
    close(H.sv, 0.95);
    close(H.pdo, 105);
    // A team's shooting and its opponent's saves are the same goals, so the two PDOs meet at 100 on average.
    close((H.pdo + A.pdo) / 2, 100);
  });

  it('counts passes, sacks and runs in football, a quarterback\'s runs only once', () => {
    const passer = (att: number, yds: number, sacks: number, sackYds: number, rushAtt: number, rushYds: number) => ({ id: 'qb', name: 'qb', att, cmp: 0, yds, td: 0, int: 0, sacks, sackYds, rushAtt, rushYds, rushTd: 0, fumLost: 0 });
    const runner = (id: string, rushAtt: number, rushYds: number) => ({ id, name: id, rushAtt, rushYds, rushTd: 0, tgt: 0, rec: 0, recYds: 0, recTd: 0 });
    const box = { g: { league: 'nfl', teams: { H: { starter: null, passers: [passer(30, 250, 2, 10, 4, 20)] }, A: { starter: null, passers: [passer(20, 150, 1, 5, 0, 0)] } } } } as unknown as Record<string, BoxScore>;
    // The quarterback's 4 carries for 20 are in the rushers' list; his passing line must not add them again.
    const skill: Record<string, NflSkillBox> = { g: { teams: { H: [runner('qb', 4, 20), runner('rb', 20, 100)], A: [runner('rb', 25, 75)] } } };
    const { H, A } = teamMetrics('nfl', [game('g')], box, skill);
    close(H.pass, 240 / 32);
    close(H.rush, 120 / 24);
    close(H.off, 360 / 56);
    close(H.def, (145 + 75) / (21 + 25));
    close(A.off, H.def);
    close(H.net, H.off - H.def);
    close(H.passD, 145 / 21);
  });

  it('skips a game without a box score, and a league with none stored', () => {
    assert.deepEqual(teamMetrics('nba', [game('missing')], {}, {}), {});
    assert.deepEqual(teamMetrics('mlb', [game('g')], {}, {}), {});
  });

  it('reads each number the way it should', () => {
    assert.equal(metricText({ digits: 1, percent: true }, 0.5678), '56.8%');
    assert.equal(metricText({ digits: 1, signed: true }, 4.21), '+4.2');
    assert.equal(metricText({ digits: 1, signed: true }, -4.21), '−4.2');
    assert.equal(metricText({ digits: 2, signed: true }, 0.001), '0.00');
    assert.equal(metricText({ digits: 2 }, 6.333), '6.33');
    assert.equal(metricText({ digits: 1 }, null), '—');
    // Every metric's key is unique within its league.
    for (const group of Object.values(METRICS)) assert.equal(new Set(group!.list.map((m) => m.key)).size, group!.list.length);
  });
});
