import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { LeagueModel } from '../lib/model';
import { nextGameRow } from '../lib/model/playerLog';

const game = (id: string, date: string, state = 'pre') => ({ game: { id, date, state } });
const player = (id: string, points: number) => ({ id, name: id, teamId: 't', detail: '', featured: true, available: 1, mean: { pts: points } });
const row = (id: string, line: number) => ({ id, name: id, teamId: 't', detail: '', available: 1, cells: { pts: { projection: line, actual: null, line: { line } } } });

function model(parts: { boards?: Record<string, ReturnType<typeof row>[]>; projections?: Record<string, ReturnType<typeof player>[]>; games: ReturnType<typeof game>[] }) {
  return {
    predictions: Object.fromEntries(parts.games.map((g) => [g.game.id, g])),
    propBoards: Object.fromEntries(Object.entries(parts.boards ?? {}).map(([id, rows]) => [id, { rows, markets: ['pts'], book: 'DK' }])),
    playerProjections: Object.fromEntries(Object.entries(parts.projections ?? {}).map(([id, home]) => [id, { home, away: [], source: 'injury report' }]))
  } as unknown as LeagueModel;
}

describe('a player\'s next game', () => {
  it('falls back to the projections alone before any book has lines', () => {
    const next = nextGameRow(model({ games: [game('1', '2026-11-04')], projections: { '1': [player('p', 24)] } }), 'p');
    assert.equal(next?.game.id, '1');
    assert.equal(next?.row.cells.pts?.projection, 24);
    assert.equal(next?.row.cells.pts?.line, null);
  });

  it('prefers the lined row for the same game', () => {
    const next = nextGameRow(model({ games: [game('1', '2026-11-04')], boards: { '1': [row('p', 25.5)] }, projections: { '1': [player('p', 24)] } }), 'p');
    assert.equal(next?.row.cells.pts?.line?.line, 25.5);
  });

  it('takes the sooner game, lined or not, and skips one already under way', () => {
    const soonerUnlined = model({
      games: [game('1', '2026-11-04'), game('2', '2026-11-06')],
      boards: { '2': [row('p', 25.5)] },
      projections: { '1': [player('p', 24)], '2': [player('p', 23)] }
    });
    assert.equal(nextGameRow(soonerUnlined, 'p')?.game.id, '1');
    const underWay = model({ games: [game('1', '2026-11-03', 'in'), game('2', '2026-11-05')], projections: { '1': [player('p', 24)], '2': [player('p', 23)] } });
    assert.equal(nextGameRow(underWay, 'p')?.game.id, '2');
  });

  it('is null for a player in neither', () => {
    assert.equal(nextGameRow(model({ games: [game('1', '2026-11-04')], projections: { '1': [player('p', 24)] } }), 'q'), null);
  });
});
