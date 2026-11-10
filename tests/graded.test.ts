import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Prediction } from '../lib/model';
import { GRADED_COLUMNS, gradedCsv } from '../lib/model/api';

const side = (abbr: string, score: number | null) => ({ abbr, score });
const prediction = (id: string, date: string, over: Partial<Prediction> = {}, scores: [number | null, number | null] = [100, 110], completed = true): Prediction =>
  ({
    game: { id, league: 'nba', date, seasonYear: 2026, completed, away: side('A,X', scores[0]), home: side('H"Q', scores[1]) },
    homeProb: 0.61234,
    market: { homeProb: 0.6 },
    source: 'core',
    ...over
  }) as unknown as Prediction;

describe('graded games as CSV', () => {
  const csv = gradedCsv([
    // Logged at 45% for the home side, but graded (like every game) on its backtest forecast of 62%.
    prediction('2', '2026-02-01T00:00:00Z', { source: 'logged', homeProb: 0.45, gradedHomeProb: 0.62 }, [120, 100]),
    prediction('1', '2026-01-01T00:00:00Z', { market: null }),
    prediction('3', '2026-03-01T00:00:00Z', {}, [100, 110], false),
    prediction('4', '2026-03-02T00:00:00Z', {}, [99, 99]),
    prediction('5', '2026-03-03T00:00:00Z', { homeProb: 0.5 }, [90, 80])
  ]);
  const lines = csv.trimEnd().split('\r\n');

  it('lists finished, decided games only, oldest first', () => {
    assert.equal(lines[0], GRADED_COLUMNS.join(','));
    assert.deepEqual(
      lines.slice(1).map((l) => l.split(',')[1]),
      ['1', '2', '5']
    );
  });

  it('grades the backtest forecast, picks home at 50%, and keeps the logged number beside it', () => {
    assert.ok(lines[1].endsWith('"A,X","H""Q",100,110,0.6123,"H""Q",0.6123,true,false,'));
    assert.ok(lines[2].endsWith('120,100,0.62,"H""Q",0.62,false,true,0.45'));
    assert.ok(lines[3].endsWith('90,80,0.5,"H""Q",0.5,false,true,'));
    assert.ok(csv.endsWith('\r\n'));
  });

  it('keeps text a spreadsheet would run as a formula as text', () => {
    const risky = gradedCsv([
      prediction('9', '2026-01-01T00:00:00Z', {
        game: { id: '9', league: 'nba', date: '2026-01-01T00:00:00Z', seasonYear: 2026, completed: true, away: side('=HYPERLINK("x")', 1), home: side('@SUM', 2) } as never
      })
    ]);
    assert.ok(risky.includes(`"'=HYPERLINK(""x"")",'@SUM`));
  });
});
