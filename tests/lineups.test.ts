import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { BoxScore, NbaLine } from '../lib/boxscores';
import type { Game } from '../lib/espn';
import { LEAGUES } from '../lib/leagues';
import { allocateMinutes, gameScore, LineupModel, ruledOut } from '../lib/model/lineups';

const params = LEAGUES.nba.lineups!;

function line(id: string, min: number, pts: number, extra: Partial<NbaLine> = {}): NbaLine {
  return { id, name: id, starter: min > 24, min, pts, fgm: pts / 2.5, fga: pts / 1.8, ftm: 0, fta: 0, oreb: 1, dreb: 4, ast: 3, stl: 1, blk: 0, tov: 2, pf: 2, pm: 0, dnp: min === 0, reason: null, ...extra };
}

/** One team, 240 minutes a game: a high-scoring star, three regulars and a low-scoring bench. */
function teamLines(starMinutes = 36, starReason: string | null = null): NbaLine[] {
  return [
    line('star', starMinutes, starMinutes ? 34 : 0, starMinutes ? {} : { dnp: true, reason: starReason }),
    line('wing', 34, 14),
    line('big', 32, 12),
    line('guard', 30, 11),
    line('bench1', 24, 6),
    line('bench2', 22, 5),
    line('bench3', 22, 4),
    line('bench4', 20, 4),
    line('bench5', 20, 3)
  ];
}

const fakeGame = (i: number): Game =>
  ({ id: String(i), date: new Date(Date.UTC(2026, 0, 1 + i)).toISOString(), home: { teamId: 'h' }, away: { teamId: 'a' } }) as unknown as Game;

/** Enough history for ratings and the team's lineup baseline to settle, as they have in real data. */
function trained() {
  const model = new LineupModel(params);
  for (let i = 0; i < 400; i += 1) {
    const box: Extract<BoxScore, { league: 'nba' }> = { league: 'nba', teams: { h: teamLines(), a: teamLines() } };
    model.record(fakeGame(i), box);
  }
  return model;
}

describe('lineup model', () => {
  it("treats injuries as absences but not coach's decisions", () => {
    assert.equal(ruledOut({ dnp: true, reason: 'LEFT ANKLE SPRAIN' }), true);
    assert.equal(ruledOut({ dnp: true, reason: "COACH'S DECISION" }), false);
    assert.equal(ruledOut({ dnp: false, reason: null }), false);
  });

  it('rates a high-scoring player above a low-scoring one', () => {
    assert.ok(gameScore(line('a', 36, 34)) > gameScore(line('b', 36, 4)));
    const model = trained();
    assert.ok(model.rating('star') > model.rating('bench2'));
  });

  it('marks the usual lineup at about zero', () => {
    const model = trained();
    const view = model.viewFromBox('h', teamLines());
    assert.ok(Math.abs(view.elo) < 5, String(view.elo));
  });

  it('lowers the team when the star is out, and prices the absence', () => {
    const model = trained();
    const view = model.viewFromBox('h', teamLines(0, 'RIGHT KNEE SORENESS'));
    assert.ok(view.elo < -10, String(view.elo));
    assert.ok(model.absenceCost('h', view, 'star') > 10);
    // His minutes go to the others, so the projected rotation still adds up to a full game.
    const minutes = view.players.reduce((s, p) => s + p.minutes, 0);
    assert.ok(Math.abs(minutes - 240) < 1, String(minutes));
    assert.equal(view.players.find((p) => p.id === 'star')!.minutes, 0);
  });

  it('hands out a full game: a full roster keeps its stars closer to their usual minutes, a short one leans the extra to the bench', () => {
    const total = (xs: number[]) => xs.reduce((s, x) => s + x, 0);
    const even = [0.15, 0.15, 0.14, 0.13, 0.12, 0.11, 0.1, 0.1];
    assert.ok(Math.abs(total(allocateMinutes(even)) - 240) < 1e-6);
    // 20% too many minutes: scaled alike the star would lose 6 of his 36; here he loses less, the bench more.
    const full = [0.15, 0.15, 0.15, 0.14, 0.13, 0.12, 0.12, 0.12, 0.12];
    const m = allocateMinutes(full);
    assert.ok(Math.abs(total(m) - 240) < 1e-6);
    assert.ok(m[0] > (0.15 / total(full)) * 240, String(m[0]));
    assert.ok(m[8] < (0.12 / total(full)) * 240, String(m[8]));
    // 25% short: scaled alike the star would gain 9; here he gains less.
    const short = [0.15, 0.15, 0.12, 0.1, 0.08, 0.06, 0.05, 0.04];
    const s = allocateMinutes(short);
    assert.ok(Math.abs(total(s) - 240) < 1e-6);
    assert.ok(s[0] < (0.15 / total(short)) * 240 && s[0] > 0.15 * 240, String(s[0]));
    assert.deepEqual(allocateMinutes([0, 0]), [0, 0]);
  });

  it('leaves out a roster player who has not dressed all season, once the season is a few games old', () => {
    const model = new LineupModel(params);
    // Last season: a two-way player got real minutes. This season he hasn't been in a box score.
    const lastSeason = (i: number): Game => ({ ...fakeGame(i), date: new Date(Date.UTC(2026, 3, 1 + i)).toISOString() }) as Game;
    const thisSeason = (i: number): Game => ({ ...fakeGame(i), date: new Date(Date.UTC(2026, 9, 21 + i)).toISOString() }) as Game;
    for (let i = 0; i < 10; i += 1) model.record(lastSeason(i), { league: 'nba', teams: { h: [...teamLines(), line('twoway', 30, 10)], a: teamLines() } });
    for (let i = 0; i < 4; i += 1) model.record(thisSeason(i), { league: 'nba', teams: { h: teamLines(), a: teamLines() } });
    const roster = [...teamLines(), line('twoway', 30, 10)].map((l) => ({ id: l.id, name: l.name }));
    const at = new Date(Date.UTC(2026, 10, 2)).toISOString();
    const start = new Date(Date.UTC(2026, 9, 21)).toISOString();
    assert.ok(model.project('h', at, roster, []).players.some((p) => p.id === 'twoway'));
    assert.ok(!model.project('h', at, roster, [], start).players.some((p) => p.id === 'twoway'));
    // On the injury report, he stays (and is weighted by it).
    const report = [{ athleteId: 'twoway', name: 'twoway', position: null, status: 'Questionable', comment: null, date: null }];
    assert.ok(model.project('h', at, roster, report, start).players.some((p) => p.id === 'twoway'));
  });

  it('weights a questionable player by his chance of playing', () => {
    const model = trained();
    const roster = teamLines().map((l) => ({ id: l.id, name: l.name }));
    const report = (status: string) => [{ athleteId: 'star', name: 'star', position: null, status, comment: null, date: null }];
    const full = model.project('h', '2026-03-01T00:00:00Z', roster, []);
    const maybe = model.project('h', '2026-03-01T00:00:00Z', roster, report('Questionable'));
    const out = model.project('h', '2026-03-01T00:00:00Z', roster, report('Out'));
    assert.ok(full.elo > maybe.elo && maybe.elo > out.elo, `${full.elo} ${maybe.elo} ${out.elo}`);
    assert.ok(maybe.elo < 0, String(maybe.elo));
  });
});
