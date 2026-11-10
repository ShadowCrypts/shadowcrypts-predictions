import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { BoxScore, NflPasserLine, NflTeamBox, parseNfl } from '../lib/boxscores';
import type { Game, GameSide, InjuryEntry } from '../lib/espn';
import { LEAGUES } from '../lib/leagues';
import { injuryImpacts } from '../lib/model/adjustments';
import { describeQb, netYards, playCount, QbModel, qbChange, qbInjuryImpacts, qbPass } from '../lib/model/quarterbacks';

const params = LEAGUES.nfl.quarterbacks!;

function passer(id: string, att: number, yds: number, extra: Partial<NflPasserLine> = {}): NflPasserLine {
  return { id, name: id, att, cmp: Math.round(att * 0.65), yds, td: 0, int: 0, sacks: 0, sackYds: 0, rushAtt: 0, rushYds: 0, rushTd: 0, fumLost: 0, ...extra };
}

/** A team-game: the starter throws 32 times at the given yards per attempt. */
function teamBox(starter: string, ypa: number): NflTeamBox {
  return { starter: { id: starter, name: starter }, passers: [passer(starter, 32, Math.round(32 * ypa), { td: 1, int: 1, sacks: 2, sackYds: 14 })] };
}

const side = (teamId: string, score: number | null): GameSide =>
  ({ teamId, abbr: teamId.toUpperCase(), name: teamId, shortName: teamId, logo: null, score, winner: null, record: null, leaders: [], probable: null, periods: [] }) as GameSide;

function game(i: number, completed = true): Game {
  return {
    id: String(i),
    date: new Date(Date.UTC(2025, 8, 7 + i * 7)).toISOString(),
    seasonYear: 2025,
    seasonType: 2,
    state: completed ? 'post' : 'pre',
    completed,
    home: side('h', completed ? 24 : null),
    away: side('a', completed ? 20 : null)
  } as unknown as Game;
}

/** Each team starts the same quarterback for 40 games: h's is well above a's. */
function trained(model = new QbModel(params)) {
  for (let i = 0; i < 40; i += 1) model.record(game(i), { league: 'nfl', teams: { h: teamBox('ace', 8), a: teamBox('vet', 6) } });
  return model;
}

const report = (athleteId: string, status: string, position = 'QB'): InjuryEntry => ({ athleteId, name: athleteId, position, status, comment: null, date: null });

describe('NFL box scores', () => {
  const summary = (withRushing = true) => ({
    boxscore: {
      players: [
        {
          team: { id: '27' },
          statistics: [
            {
              name: 'passing',
              keys: ['completions/passingAttempts', 'passingYards', 'yardsPerPassAttempt', 'passingTouchdowns', 'interceptions', 'sacks-sackYardsLost', 'adjQBR', 'QBRating'],
              athletes: [
                { athlete: { id: '1', displayName: 'Starter QB' }, stats: ['19/24', '180', '7.5', '3', '0', '1-7', '81.8', '137.5'] },
                { athlete: { id: '9', displayName: 'Trick WR' }, stats: ['0/1', '0', '0.0', '0', '0', '0-0', '3.2', '39.6'] }
              ]
            },
            withRushing
              ? {
                  name: 'rushing',
                  keys: ['rushingAttempts', 'rushingYards', 'yardsPerRushAttempt', 'rushingTouchdowns', 'longRushing'],
                  athletes: [{ athlete: { id: '1', displayName: 'Starter QB' }, stats: ['6', '42', '7.0', '1', '18'] }]
                }
              : { name: 'receiving', keys: [], athletes: [] }
          ]
        },
        {
          team: { id: '1' },
          statistics: [
            {
              name: 'passing',
              keys: ['completions/passingAttempts', 'passingYards', 'yardsPerPassAttempt', 'passingTouchdowns', 'interceptions', 'sacks-sackYardsLost', 'adjQBR', 'QBRating'],
              athletes: [
                { athlete: { id: '2', displayName: 'Hurt Starter' }, stats: ['1/2', '8', '4.0', '0', '0', '0-0', '10', '70'] },
                { athlete: { id: '3', displayName: 'Backup' }, stats: ['30/45', '310', '6.9', '2', '1', '3-20', '50', '90'] }
              ]
            }
          ]
        }
      ]
    }
  });

  it('reads passing, sacks and the passer’s own runs', () => {
    const box = parseNfl(summary());
    assert.equal(box?.league, 'nfl');
    if (box?.league !== 'nfl') return;
    const qb = box.teams['27'].passers.find((p) => p.id === '1')!;
    assert.deepEqual(
      { att: qb.att, cmp: qb.cmp, yds: qb.yds, td: qb.td, int: qb.int, sacks: qb.sacks, sackYds: qb.sackYds, rushAtt: qb.rushAtt, rushYds: qb.rushYds, rushTd: qb.rushTd },
      { att: 24, cmp: 19, yds: 180, td: 3, int: 0, sacks: 1, sackYds: 7, rushAtt: 6, rushYds: 42, rushTd: 1 }
    );
    assert.equal(parseNfl(summary(false))?.league, 'nfl');
  });

  it("takes the starter from ESPN's roster, not the busiest passer", () => {
    const box = parseNfl(summary(), { '1': { id: '2', name: 'Starter' } });
    if (box?.league !== 'nfl') return assert.fail('not parsed');
    // Hurt on his second throw, but he started; his full name comes from the box score.
    assert.deepEqual(box.teams['1'].starter, { id: '2', name: 'Hurt Starter' });
    // Without a roster flag the most dropbacks stands in.
    assert.equal(box.teams['27'].starter?.id, '1');
  });
});

describe('quarterback model', () => {
  it('scores plays by adjusted net yards, runs included at the shipped weight', () => {
    const line = passer('x', 30, 250, { td: 2, int: 1, sacks: 2, sackYds: 15, rushAtt: 4, rushYds: 20, rushTd: 1 });
    assert.equal(netYards(line, 0), 250 + 40 - 45 - 15);
    assert.equal(playCount(line, 0), 32);
    assert.equal(netYards(line, 1), 250 + 40 - 45 - 15 + 20 + 20);
    assert.equal(playCount(line, 1), 36);
  });

  it('rates a proven efficient passer above an unknown one, and shrinks small samples', () => {
    const model = trained();
    assert.ok(model.rating('ace') > model.rating('vet'));
    assert.equal(model.rating('nobody'), params.priorRating);
    model.record(game(41), { league: 'nfl', teams: { h: teamBox('ace', 8), a: { starter: { id: 'vet', name: 'vet' }, passers: [passer('vet', 30, 180), passer('rookie', 3, 60)] } } });
    // Twenty yards an attempt on three throws barely moves a rookie off the prior.
    assert.ok(model.rating('rookie') - params.priorRating < 0.3, String(model.rating('rookie')));
  });

  it('marks the usual starter at about zero, even after a big game', () => {
    const model = trained();
    assert.ok(Math.abs(model.viewFromBox('h', teamBox('ace', 8)).elo) < 1);
    model.record(game(41), { league: 'nfl', teams: { h: teamBox('ace', 14), a: teamBox('vet', 6) } });
    // His rating rose, but so did the team's usual level: the team rating already follows form.
    assert.ok(Math.abs(model.viewFromBox('h', teamBox('ace', 8)).elo) < 1);
  });

  it('lowers the team when a backup starts, and raises it again as the starter returns', () => {
    const model = trained();
    const backup = model.viewFromBox('h', teamBox('backup', 6));
    assert.ok(backup.elo < -100, String(backup.elo));
    for (let i = 41; i < 45; i += 1) model.record(game(i), { league: 'nfl', teams: { h: teamBox('backup', 6), a: teamBox('vet', 6) } });
    // Four backup starts later the usual level has slipped, so the starter's return counts as a boost.
    assert.ok(model.viewFromBox('h', teamBox('ace', 8)).elo > 10);
  });

  it("weights a questionable starter by his chance of playing, and prices his absence", () => {
    const model = trained();
    const depth = [
      { id: 'ace', name: 'ace' },
      { id: 'backup', name: 'backup' }
    ];
    const healthy = model.project('h', depth, []);
    const maybe = model.project('h', depth, [report('ace', 'Questionable')]);
    const out = model.project('h', depth, [report('ace', 'Out')]);
    assert.ok(healthy.elo > maybe.elo && maybe.elo > out.elo, `${healthy.elo} ${maybe.elo} ${out.elo}`);
    assert.equal(maybe.options[0].chance, 0.65);
    assert.ok(Math.abs(maybe.options[0].cost - (healthy.elo - maybe.elo)) < 1e-9);
    assert.match(describeQb(maybe), /^ace \(65%\) or backup \(35%\)$/);
    assert.match(describeQb(out), /^backup, ace out$/);
  });

  it('falls back to recent starters without a depth chart', () => {
    const model = trained();
    assert.deepEqual(model.recentStarters('h'), [{ id: 'ace', name: 'ace' }]);
    assert.ok(Math.abs(model.project('h', undefined, []).elo) < 1);
  });

  it('charges a replaced usual starter with the team’s shortfall', () => {
    const model = trained();
    const team = model.project('h', [{ id: 'backup', name: 'backup' }], []);
    const [impact] = qbInjuryImpacts([report('ace', 'Injured Reserve')], team);
    assert.equal(team.usual?.id, 'ace');
    assert.ok(impact.elo < -100 && Math.abs(impact.elo + Math.max(0, -team.elo)) < 1e-9, String(impact.elo));
    assert.match(describeQb(team), /usually ace/);
  });

  it('names who starts instead of the usual quarterback, and nothing when he plays', () => {
    const model = trained();
    assert.equal(qbChange(model.project('h', [{ id: 'backup', name: 'backup' }], [])), 'backup instead of ace');
    assert.equal(qbChange(model.project('h', [{ id: 'ace', name: 'ace' }], [])), null);
    assert.equal(qbChange({ options: [], usual: { id: 'ace', name: 'ace' } }), null);
    assert.equal(qbChange({ options: [{ id: 'x', name: 'x', chance: 1, status: null }] as never, usual: null }), null);
  });

  it('feeds both replays through qbPass: a backup start is a negative home adjustment', () => {
    const games = Array.from({ length: 42 }, (_, i) => game(i, i < 41));
    const box: Record<string, BoxScore | null> = {};
    for (let i = 0; i < 41; i += 1) box[String(i)] = { league: 'nfl', teams: { h: teamBox(i === 40 ? 'backup' : 'ace', 8), a: teamBox('vet', 6) } };
    const { extra, starters } = qbPass(games, box, params, { depth: { h: [{ id: 'ace', name: 'ace' }] }, injuries: { h: [report('ace', 'Doubtful')] } });
    assert.ok(extra.get('40')! < -100, String(extra.get('40')));
    assert.equal(starters.get('40')?.source, 'box score');
    // The upcoming game reads the depth chart and the injury report.
    assert.equal(starters.get('41')?.source, 'depth chart');
    assert.ok(extra.get('41')! < -50, String(extra.get('41')));
  });
});

describe('NFL injury heuristic', () => {
  it('no longer values the passing leader (the quarterback model does)', () => {
    const leaders = [
      { category: 'passingLeader', athleteId: 'qb', value: 2000, display: '2,000 YDS' },
      { category: 'rushingLeader', athleteId: 'rb', value: 600, display: '600 YDS' }
    ];
    const { impacts } = injuryImpacts('nfl', side('h', null), [report('qb', 'Out'), report('rb', 'Out', 'RB')], [], leaders);
    assert.equal(Math.abs(impacts.find((i) => i.athleteId === 'qb')!.elo), 0);
    assert.equal(impacts.find((i) => i.athleteId === 'rb')!.elo, -15);
  });
});
