import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { LiveBox, NbaLine } from '../lib/boxscores';
import type { Game } from '../lib/espn';
import { LEAGUES } from '../lib/leagues';
import { livePropsFrom } from '../lib/model/gameLiveProps';
import { propBoard, PropBoard, PropCell } from '../lib/model/propBoard';
import type { GameProjection } from '../lib/model/propModel';
import type { PropLine } from '../lib/props';

const side = (teamId: string, score: number | null) => ({ teamId, abbr: teamId, name: teamId, shortName: teamId, logo: null, score, winner: null, record: null, leaders: [], probable: null, periods: [] as number[] });
const game = { id: '9', league: 'nba', date: '2026-10-28T23:00:00Z', seasonYear: 2027, seasonType: 2, state: 'in', completed: false, statusName: 'STATUS_HALFTIME', statusDetail: 'Halftime', period: 2, clock: '0:00', outs: null, neutral: false, venue: null, broadcast: null, note: null, home: side('1', 60), away: side('2', 56), odds: null } as unknown as Game;

const line = (pts: number, min = 20): NbaLine => ({ id: '', name: '', starter: true, min, pts, fgm: 0, fga: 0, ftm: 0, fta: 0, oreb: 0, dreb: 0, ast: 0, stl: 0, blk: 0, tov: 0, pf: 0, pm: 0, dnp: false, reason: null });
const cell = (at: number): PropCell => ({
  projection: at,
  actual: null,
  line: { line: at, over: -110, under: -110, book: 'DraftKings', bookOver: 0.5, modelOver: 0.5, forecastOver: 0.5, edge: null }
});
const row = (id: string, teamId: string) => ({ id, name: id, teamId, detail: '', available: 1, cells: { pts: cell(24.5) } });
const board: PropBoard = { rows: [row('hot', '1'), row('cold', '1'), row('done', '2'), row('bench', '2')], markets: ['pts'], book: 'DraftKings' };
const read: LiveBox = {
  box: { league: 'nba', teams: { '1': [{ ...line(20), id: 'hot' }, { ...line(4), id: 'cold' }], '2': [{ ...line(26), id: 'done' }] } },
  skill: null,
  status: 'Halftime',
  period: 2,
  clock: '0:00',
  margin: 4
};

describe('live props on a game page', () => {
  const live = livePropsFrom(LEAGUES.nba, game, board, read)!;

  it('reads each player’s stat so far, and leaves out who isn’t in the box score', () => {
    assert.equal(live.status, 'Halftime');
    assert.equal(live.cells.hot.pts?.current, 20);
    assert.equal(live.cells.done.pts?.current, 26);
    assert.equal(live.cells.bench.pts?.current, null);
    assert.equal(live.cells.bench.pts?.over, null);
  });

  it('moves the over chance with the pace so far, and settles an over already past its line', () => {
    const hot = live.cells.hot.pts!.over!;
    const cold = live.cells.cold.pts!.over!;
    // 20 at the half against 24.5: well ahead of pace; 4 is far behind it.
    assert.ok(hot > 0.75, `hot ${hot}`);
    assert.ok(cold < 0.1, `cold ${cold}`);
    assert.equal(live.cells.done.pts!.over, 1);
  });

  it('needs a box score to say anything', () => {
    assert.equal(livePropsFrom(LEAGUES.nba, game, board, { ...read, box: null }), null);
    assert.equal(livePropsFrom(LEAGUES.mlb, game, board, read), null);
  });
});

describe('prop boards', () => {
  const projection: GameProjection = {
    home: [{ id: 'a', name: 'A', teamId: '1', detail: '', featured: true, available: 1, mean: { pts: 25 } }],
    away: [{ id: 'b', name: 'B', teamId: '2', detail: '', featured: true, available: 1, mean: { pts: 18 } }],
    source: 'injury report'
  };
  const offer = (athleteId: string, line: number, open: number | null): PropLine => ({
    athleteId,
    market: 'pts',
    line,
    over: -110,
    under: -110,
    book: 'DraftKings',
    open: open === null ? null : { line: open, over: -110, under: -110 }
  });

  it('notes where a line opened only when the book has moved it', () => {
    const made = propBoard(LEAGUES.nba.players!, ['pts'], projection, [offer('a', 26.5, 24.5), offer('b', 17.5, 17.5)], null);
    const line = (id: string) => made.rows.find((r) => r.id === id)?.cells.pts?.line;
    assert.equal(line('a')?.openLine, 24.5);
    assert.equal(line('b')?.openLine, null);
    assert.equal(propBoard(LEAGUES.nba.players!, ['pts'], projection, [offer('a', 26.5, null)], null).rows[0].cells.pts?.line?.openLine, null);
  });
});
