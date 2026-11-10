import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { whyForecast } from '../lib/model/explain';
import type { Prediction } from '../lib/model';

type Input = Parameters<typeof whyForecast>[0];
const factor = (label: string, home: number, away: number, kind: 'rating' | 'adjustment' = 'adjustment') => ({ label, detail: '', home, away, kind });
const base = (over: Partial<Input> = {}): Input =>
  ({
    game: { league: 'nba', home: { shortName: 'Pistons', abbr: 'DET' }, away: { shortName: '76ers', abbr: 'PHI' } },
    market: { homeSpread: -1.5, homeProb: 0.53 },
    basis: 'market',
    homeProb: 0.53,
    pick: 'home',
    pickProb: 0.53,
    modelHomeProb: 0.54,
    factors: [factor('Team rating', 1626, 1548, 'rating'), factor('Home field', 70, 0), factor('Rest', 0, 0)],
    injuries: null,
    ...over
  }) as Input;
const say = (over: Partial<Input> = {}, opts: { showSpread?: boolean; movement?: { p: number }[] } = {}) => whyForecast(base(over), { showSpread: true, ...opts });

describe('why the forecast says what it says', () => {
  it('says first that a posted line is what the forecast follows, and that our factors explain our number', () => {
    const [first, second, third] = say();
    assert.match(first, /betting line has the Pistons favored by 1\.5, and the forecast follows it \(Pistons 53%\)/);
    assert.match(second, /about the same place, at 54%/);
    assert.equal(third, "Behind our ratings' number: the Pistons rate higher (1626 to 1548 Elo) and the Pistons have home court.");
  });

  it('names the underdog by the sign of the spread, whichever side the pick is on', () => {
    assert.match(say({ market: { homeSpread: 3.5, homeProb: 0.4 } as Prediction['market'], homeProb: 0.4, pick: 'away', pickProb: 0.6, modelHomeProb: 0.4 })[0], /the 76ers favored by 3\.5/);
  });

  it('says plainly when our ratings disagree with the line, and who has been right', () => {
    const lines = say({ modelHomeProb: 0.42 });
    assert.match(lines[1], /lean the other way, to the 76ers at 58%\. When the two disagree, the line has been right more often/);
  });

  it("doesn't call a coin flip a lean, whichever side of 50% it lands on", () => {
    assert.equal(say({ modelHomeProb: 0.496 })[1], 'Our own ratings call it about even.');
    assert.equal(say({ modelHomeProb: 0.51, pickProb: 0.82, homeProb: 0.82 })[1], 'Our own ratings call it about even.');
  });

  it('says whether our ratings like the pick more or less when they differ', () => {
    assert.match(say({ modelHomeProb: 0.6 })[1], /like the Pistons more, at 60%/);
    assert.match(say({ pickProb: 0.65, homeProb: 0.65, modelHomeProb: 0.55 })[1], /like the Pistons less, at 55%/);
  });

  it('uses the market instead of a spread where spreads mean little, and says when it is about even', () => {
    assert.match(say({ pickProb: 0.58, homeProb: 0.58 }, { showSpread: false })[0], /^The betting market favors the Pistons, and/);
    assert.match(say({ pickProb: 0.51, homeProb: 0.51 }, { showSpread: false })[0], /^The betting market calls it about even/);
  });

  it('never pretends a line exists before one is posted', () => {
    const lines = say({ basis: 'model', market: null, pickProb: 0.6, homeProb: 0.6 });
    assert.match(lines[0], /No betting line is up yet.*Pistons at 60%.*switches to the line/);
    assert.equal(lines.some((l) => /ratings like|same place|lean the other way/.test(l)), false);
    assert.match(lines[1], /^Behind that number: /);
    assert.match(say({ basis: 'model', market: null, pickProb: 0.51 })[0], /calls it about even/);
  });

  it('leaves out factors too small to matter, and keeps the biggest three in order', () => {
    const none = say({ factors: [factor('Team rating', 1505, 1500, 'rating'), factor('Rest', -5, 0)] });
    assert.equal(none.some((l) => l.startsWith('Behind')), false);
    const many = say({
      factors: [factor('Team rating', 1600, 1500, 'rating'), factor('Home field', 70, 0), factor('Rest', -50, 0), factor('Lineups', 0, -20), factor('Travel', 0, -16)]
    }).find((l) => l.startsWith('Behind'))!;
    // Sorted by size: rating 100, home 70, rest 50. Lineups 20 and travel 16 miss the cut.
    assert.match(many, /rate higher.*home court and the Pistons are on a back-to-back\./);
    assert.equal(/Lineups|lineup|traveled/.test(many), false);
  });

  it('turns each factor to favor the right side', () => {
    const line = (f: ReturnType<typeof factor>) => say({ factors: [f] }).find((l) => l.startsWith('Behind'));
    assert.match(line(factor('Rest', 0, -40))!, /the 76ers are on a back-to-back/);
    assert.match(line(factor('Starting goalies', 30, 0))!, /starting goalies favor the Pistons/);
    assert.match(line(factor('Injuries', -40, 0))!, /injuries cost the Pistons more/);
  });

  it('never calls a change against a team\'s own recent players a head-to-head edge', () => {
    // Both factors measure each team against itself: a weak team at full strength isn't the stronger side.
    const line = (f: ReturnType<typeof factor> & { change?: object }) => say({ factors: [f] as Input['factors'] }).find((l) => l.startsWith('Behind'))!;
    assert.match(line(factor('Lineups', -40, 0)), /lineup changes favor the 76ers/);
    assert.match(line(factor('Quarterbacks', 0, 60)), /quarterback changes favor the 76ers/);
    assert.equal(/stronger lineup|quarterback matchup/.test(line(factor('Lineups', -40, 0)) + line(factor('Quarterbacks', 0, 60))), false);
  });

  it('names a quarterback change when the model knows who, on the team it hits', () => {
    const qb = (home: number, away: number, change: { home?: string | null; away?: string | null }) => ({ ...factor('Quarterbacks', home, away), change });
    const line = (f: ReturnType<typeof qb>) => say({ factors: [f] as Input['factors'] }).find((l) => l.startsWith('Behind'))!;
    assert.match(line(qb(-200, 9, { home: 'Joe Fagnano instead of Lamar Jackson', away: null })), /the Pistons are expected to start Joe Fagnano instead of Lamar Jackson\.$/);
    assert.match(line(qb(9, -200, { home: null, away: 'Joe Fagnano instead of Lamar Jackson' })), /the 76ers are expected to start Joe Fagnano/);
    // A better starter than usual counts the same way.
    assert.match(line(qb(40, 0, { home: 'A instead of B', away: null })), /the Pistons are expected to start A instead of B/);
    assert.match(line(qb(-40, 0, { home: null, away: null })), /quarterback changes favor the 76ers/);
  });

  it('names likely absences, briefly', () => {
    const injury = (athleteId: string, name: string) => ({ athleteId, name, missChance: 1, value: -40 });
    const lines = say({ injuries: { home: [injury('1', 'Cade Cunningham')], away: [injury('2', 'Joel Embiid')] } as Prediction['injuries'] });
    assert.ok(lines.includes('Likely out: Joel Embiid (PHI) and Cade Cunningham (DET).') || lines.includes('Likely out: Cade Cunningham (DET) and Joel Embiid (PHI).'), lines.join(' | '));
    const crowd = say({ injuries: { home: ['A', 'B', 'C', 'D', 'E', 'F'].map((n, i) => injury(String(i), n)), away: [] } as unknown as Prediction['injuries'] });
    assert.match(crowd.find((l) => l.startsWith('Likely out'))!, /and 2 more\.$/);
  });

  it('says when the forecast has moved, from the side it moved toward', () => {
    const moved = say({}, { movement: [{ p: 0.45 }, { p: 0.5 }] }).at(-1);
    assert.equal(moved, "It's moved toward the Pistons since we first logged it, from 45% to 53%.");
    const away = say({ homeProb: 0.4, pick: 'away', pickProb: 0.6, market: { homeSpread: 3, homeProb: 0.4 } as Prediction['market'], modelHomeProb: 0.4 }, { movement: [{ p: 0.5 }, { p: 0.4 }] }).at(-1);
    assert.equal(away, "It's moved toward the 76ers since we first logged it, from 50% to 60%.");
    assert.equal(say({}, { movement: [{ p: 0.52 }, { p: 0.53 }] }).some((l) => l.includes('moved')), false);
  });
});
