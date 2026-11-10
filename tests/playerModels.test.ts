import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { BoxScore, NflSkillBox, NflSkillLine } from '../lib/boxscores';
import type { Game } from '../lib/espn';
import { nflActuals, nflPlayerPass } from '../lib/model/nflPlayers';
import { nhlActuals, nhlPlayerPass } from '../lib/model/nhlPlayers';

const close = (a: number, b: number, tolerance: number) => assert.ok(Math.abs(a - b) <= tolerance, `${a} is not within ${tolerance} of ${b}`);
const noContext = { teamPoints: new Map(), leaguePoints: new Map() };

function schedule(league: 'nhl' | 'nfl', count: number, daysApart: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: String(i + 1),
    league,
    date: new Date(Date.UTC(2025, 9, 1) + i * daysApart * 86_400_000).toISOString(),
    seasonYear: 2025,
    seasonType: 2,
    state: 'post',
    completed: true,
    neutral: false,
    home: { teamId: 'H', score: 3 },
    away: { teamId: 'A', score: 2 }
  })) as unknown as Game[];
}

describe('NHL player projections', () => {
  it("learn a skater's shots and a goalie's saves from earlier games only", () => {
    const games = schedule('nhl', 40, 2);
    const box: Record<string, BoxScore> = {};
    const team = (prefix: string) => ({
      goalies: [{ id: `${prefix}-g`, name: 'G', toi: 60, sa: 30, ga: 3 }],
      skaters: [
        { id: `${prefix}-shooter`, name: 'Shooter', toi: 20, g: 1, a: 1, sog: 5, bs: 0 },
        ...Array.from({ length: 17 }, (_, k) => ({ id: `${prefix}-s${k}`, name: `S${k}`, toi: 16, g: 0, a: 0, sog: 1.5, bs: 1 }))
      ]
    });
    for (const g of games) box[g.id] = { league: 'nhl', teams: { H: team('H'), A: team('A') } };
    const params = { decay: 0.99, priorToi: 60, toiAlpha: 0.2, teamShare: 0, shotShare: 0, priorShots: 100, modelShare: 0, dispersion: {} };
    const projections = nhlPlayerPass(games, box, params, noContext, { rosters: {}, injuries: {} });

    const late = projections.get('40')!.home;
    const shooter = late.find((p) => p.id === 'H-shooter')!;
    close(shooter.mean.sog!, 5, 0.4);
    close(shooter.mean.pts!, shooter.mean.goals! + shooter.mean.ast!, 1e-9);
    const goalie = late.find((p) => p.id === 'H-g')!;
    assert.equal(goalie.detail, 'Starting goalie');
    // 27 saves on 30 shots a game, and opponents averaging about 30.5 shots.
    close(goalie.mean.saves!, 27.5, 2);
    assert.deepEqual(nhlActuals(box['1'])!.get('H-g'), { saves: 27 });
  });

  it('project the coming game from the current roster: traded players move, and goalies too', () => {
    const played = schedule('nhl', 10, 2);
    const coming = { ...played[9], id: '11', date: new Date(Date.UTC(2025, 9, 25)).toISOString(), state: 'pre', completed: false, home: { teamId: 'H', score: null }, away: { teamId: 'A', score: null } } as unknown as Game;
    const box: Record<string, BoxScore> = {};
    const team = (p: string) => ({
      goalies: [{ id: `${p}-g`, name: `${p}-g`, toi: 60, sa: 30, ga: 3 }],
      skaters: [`${p}-stay`, `${p}-traded`, `${p}-sent-down`].map((id) => ({ id, name: id, toi: 18, g: 0.2, a: 0.3, sog: 2, bs: 1 }))
    });
    for (const g of played) box[g.id] = { league: 'nhl', teams: { H: team('H'), A: team('A') } };
    const params = { decay: 0.99, priorToi: 60, toiAlpha: 0.2, teamShare: 0, shotShare: 0, priorShots: 100, modelShare: 0, dispersion: {} };
    const who = (ids: string[]) => ids.map((id) => ({ id, name: id }));
    // H-traded and H's goalie are now in A's room; H-sent-down is on nobody's roster.
    const rosters = { H: who(['H-stay', 'A-g']), A: who(['A-stay', 'A-traded', 'A-sent-down', 'H-traded', 'H-g']) };
    const projected = nhlPlayerPass([...played, coming], box, params, noContext, { rosters, injuries: {} });
    const ids = (side: 'home' | 'away') => projected.get('11')![side].map((p) => p.id).sort();
    assert.deepEqual(ids('home'), ['A-g', 'H-stay']);
    assert.deepEqual(ids('away'), ['A-sent-down', 'A-stay', 'A-traded', 'H-g', 'H-traded'].sort());

    // Games already played go by who actually played; no roster rewrites them.
    assert.ok(projected.get('10')!.home.some((p) => p.id === 'H-traded'));
    // With no roster to read, a team falls back on who last played for it.
    const without = nhlPlayerPass([...played, coming], box, params, noContext, { rosters: {}, injuries: {} });
    assert.ok(without.get('11')!.home.some((p) => p.id === 'H-traded'));
  });
});

const skill = (id: string, tgt: number, rec: number, recYds: number, rushAtt = 0, rushYds = 0): NflSkillLine => ({ id, name: id, rushAtt, rushYds, rushTd: 0, tgt, rec, recYds, recTd: 0 });

describe('NFL player projections', () => {
  it('give receivers their share of the targets, and hand an absent one’s share to the rest', () => {
    const games = schedule('nfl', 12, 7);
    const box: Record<string, BoxScore> = {};
    const skills: Record<string, NflSkillBox> = {};
    for (const [i, g] of games.entries()) {
      const out = i === 11; // the top receiver misses the last game
      const passer = { id: 'H-qb', name: 'QB', att: 32, cmp: 21, yds: 240, td: 2, int: 1, sacks: 2, sackYds: 12, rushAtt: 3, rushYds: 15, rushTd: 0, fumLost: 0 };
      box[g.id] = { league: 'nfl', teams: { H: { starter: { id: 'H-qb', name: 'QB' }, passers: [passer] }, A: { starter: { id: 'A-qb', name: 'QB' }, passers: [{ ...passer, id: 'A-qb' }] } } };
      const lines = [...(out ? [] : [skill('H-wr1', 10, 7, 90)]), skill('H-wr2', out ? 13 : 8, out ? 8 : 5, 60), skill('H-te', out ? 9 : 6, 4, 40), skill('H-rb', 4, 3, 20, 18, 80), skill('H-qb', 0, 0, 0, 3, 15)];
      skills[g.id] = { teams: { H: lines, A: lines.map((l) => ({ ...l, id: l.id.replace('H-', 'A-') })) } };
    }
    const params = { decay: 0.9, priorTargets: 10, priorCarries: 20, priorAttempts: 100, teamShare: 0, volumeAlpha: 0.3, modelShare: 0, dispersion: {} };
    const live = { rosters: {}, injuries: {}, starters: new Map() };
    const projections = nflPlayerPass(games, box, skills, params, noContext, live);

    const before = projections.get('11')!.home;
    const wr1 = before.find((p) => p.id === 'H-wr1')!;
    assert.match(wr1.detail, /targets/);
    // About 10 of 32 targets, caught 70% of the time.
    close(wr1.mean.rec!, 7, 1.2);
    const qb = before.find((p) => p.id === 'H-qb')!;
    close(qb.mean.pass_att!, 32, 2);
    close(qb.mean.pass_rush_yds!, qb.mean.pass_yds! + qb.mean.rush_yds!, 1e-9);
    const rb = before.find((p) => p.id === 'H-rb')!;
    assert.match(rb.detail, /^RB/);

    // Projected off the box score of the game WR1 missed: WR2's targets go up.
    const after = projections.get('12')!.home;
    assert.equal(after.find((p) => p.id === 'H-wr1'), undefined);
    const wr2Before = before.find((p) => p.id === 'H-wr2')!.mean.rec!;
    const wr2After = after.find((p) => p.id === 'H-wr2')!.mean.rec!;
    assert.ok(wr2After > wr2Before, `WR2 receptions ${wr2Before.toFixed(2)} → ${wr2After.toFixed(2)}`);
    assert.equal(nflActuals(box['1'], skills['1'])!.get('H-qb')!.pass_rush_yds, 255);
  });

  it('project the coming game from the current roster: a traded receiver moves, a released one goes', () => {
    const played = schedule('nfl', 8, 7);
    const coming = { ...played[7], id: '9', date: new Date(Date.UTC(2025, 10, 30)).toISOString(), state: 'pre', completed: false, home: { teamId: 'H', score: null }, away: { teamId: 'A', score: null } } as unknown as Game;
    const box: Record<string, BoxScore> = {};
    const skills: Record<string, NflSkillBox> = {};
    const passer = (id: string) => ({ id, name: id, att: 32, cmp: 21, yds: 240, td: 2, int: 1, sacks: 2, sackYds: 12, rushAtt: 3, rushYds: 15, rushTd: 0, fumLost: 0 });
    for (const g of played) {
      box[g.id] = { league: 'nfl', teams: { H: { starter: { id: 'H-qb', name: 'H-qb' }, passers: [passer('H-qb')] }, A: { starter: { id: 'A-qb', name: 'A-qb' }, passers: [passer('A-qb')] } } };
      skills[g.id] = { teams: { H: [skill('H-wr', 8, 5, 60), skill('H-traded', 10, 7, 90), skill('H-released', 6, 4, 40)], A: [skill('A-wr', 8, 5, 60)] } };
    }
    const params = { decay: 0.9, priorTargets: 10, priorCarries: 20, priorAttempts: 100, teamShare: 0, volumeAlpha: 0.3, modelShare: 0, dispersion: {} };
    const who = (ids: string[]) => ids.map((id) => ({ id, name: id }));
    const rosters = { H: who(['H-qb', 'H-wr']), A: who(['A-qb', 'A-wr', 'H-traded']) };
    const projected = nflPlayerPass([...played, coming], box, skills, params, noContext, { rosters, injuries: {}, starters: new Map() });
    const ids = (side: 'home' | 'away') => projected.get('9')![side].map((p) => p.id);
    assert.ok(ids('away').includes('H-traded'), ids('away').join());
    assert.equal(ids('home').includes('H-traded'), false);
    assert.equal(ids('home').includes('H-released'), false);
    assert.ok(ids('home').includes('H-wr'));
    // Played games keep who played in them.
    assert.ok(projected.get('8')!.home.some((p) => p.id === 'H-traded'));
  });
});
