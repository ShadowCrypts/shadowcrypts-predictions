import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { LeagueModel } from '../lib/model';
import { dailyBrief } from '../lib/model/brief';

const now = new Date('2026-10-24T16:00:00Z');
const team = (abbr: string) => ({ id: abbr, teamId: abbr, abbr, shortName: abbr });
const game = (id: string, hoursAhead: number, homeProb: number, injuries?: object) => ({
  game: { id, league: 'nba', date: new Date(now.getTime() + hoursAhead * 3_600_000).toISOString(), state: 'pre', home: team(`H${id}`), away: team(`A${id}`) },
  homeProb,
  pick: homeProb >= 0.5 ? 'home' : 'away',
  pickProb: Math.max(homeProb, 1 - homeProb),
  injuries
});
const trend = (from: number, to: number) => Array.from({ length: 11 }, (_, i) => from + ((to - from) * i) / 10);

function model(slate: object[], rankings: object[] = []): LeagueModel {
  return { league: 'nba', slate, rankings, season: { phase: 'Regular season' } } as unknown as LeagueModel;
}

describe('daily brief', () => {
  it('picks the biggest favorite, the closest call and the biggest absence', () => {
    const items = dailyBrief(
      [
        model([
          game('1', 3, 0.81),
          game('2', 5, 0.52, { home: [], away: [{ name: 'Star Guard', status: 'Out', elo: -60 }] }),
          game('3', 8, 0.35, { home: [{ name: 'Bench Big', status: 'Questionable', elo: -8 }], away: [] })
        ])
      ],
      now
    );
    const byKind = Object.fromEntries(items.map((i) => [i.kind, i]));
    assert.match(byKind.favorite.title, /H1 81%/);
    assert.match(byKind.tossup.title, /A2 48%, H2 52%/);
    assert.match(byKind.injury.title, /Star Guard \(out\)/);
    assert.equal(items.filter((i) => i.kind === 'injury').length, 1, 'small absences are not headlines');
  });

  it('names a game to watch only when two good teams meet in a close one', () => {
    const rankings = ['H1', 'A1', 'H2', 'A2', 'X', 'Y', 'Z', 'W'].map((abbr, i) => ({ rank: i + 1, team: team(abbr), trend: [] }));
    const close = dailyBrief([model([game('1', 4, 0.55), game('2', 5, 0.85)], rankings)], now);
    assert.equal(close[0].kind, 'watch');
    assert.match(close[0].title, /A1 @ H1/);
    assert.ok(!close.some((i) => i.kind === 'tossup'), 'the close game is not listed twice');
    // The same teams in a lopsided game, or two bad teams in a close one, aren't must-see.
    const lopsided = dailyBrief([model([game('1', 4, 0.85)], rankings)], now);
    assert.ok(!lopsided.some((i) => i.kind === 'watch'));
    const lowly = ['X', 'Y', 'Z', 'W', 'H1', 'A1'].map((abbr, i) => ({ rank: i + 1, team: team(abbr), trend: [] }));
    assert.ok(!dailyBrief([model([game('1', 4, 0.5)], lowly)], now).some((i) => i.kind === 'watch'));
  });

  it('names the prop line moved most since it opened, by a whole point or more', () => {
    const cell = (line: number, openLine: number | null) => ({ projection: line, actual: null, line: { line, openLine, over: -110, under: -110, book: 'DraftKings', bookOver: 0.5, modelOver: 0.5, forecastOver: 0.5, edge: null } });
    const withBoards = (boards: object) => ({ ...model([game('1', 4, 0.6), game('2', 6, 0.7)]), propBoards: boards }) as unknown as LeagueModel;
    const items = dailyBrief(
      [
        withBoards({
          '1': { rows: [{ id: '15', name: 'Big Man', teamId: 'H1', cells: { pts: cell(26.5, 24.5), reb: cell(12.5, 12.5) } }] },
          '2': { rows: [{ id: '16', name: 'Shooter', teamId: 'H2', cells: { ast: cell(5.5, 3.5), pts: cell(20.5, 20) } }] },
          '99': { rows: [{ id: '17', name: 'Not On Soon', teamId: 'X', cells: { pts: cell(30.5, 10.5) } }] }
        })
      ],
      now
    );
    const line = items.find((i) => i.kind === 'line');
    // 3.5 → 5.5 assists is the biggest move for its size; half a point doesn't count, and games not coming up are skipped.
    assert.equal(line?.title, 'Line on the move: Shooter assists 3.5 → 5.5');
    assert.equal(line?.href, '/nba/player/16');
    const still = dailyBrief([withBoards({ '1': { rows: [{ id: '15', name: 'Big Man', teamId: 'H1', cells: { pts: cell(26.5, 26) } }] } })], now);
    assert.ok(!still.some((i) => i.kind === 'line'));
  });

  it('names the game with the most playoff chance riding on it, when it’s a real amount', () => {
    const stake = (home: [number, number], away: [number, number]) => ({ home: { ifWin: home[0], ifLoss: home[1] }, away: { ifWin: away[0], ifLoss: away[1] } });
    const slate = [game('1', 4, 0.6), game('2', 6, 0.55)];
    const items = dailyBrief([model(slate)], now, { nba: { '1': stake([0.5, 0.47], [0.3, 0.28]), '2': stake([0.62, 0.55], [0.58, 0.5]) } });
    const top = items.find((i) => i.kind === 'stakes');
    assert.equal(top?.title, 'Biggest stakes: A2 @ H2');
    assert.match(top!.detail, /^Worth 7 points of playoff chance to H2, 8 to A2/);
    // A few points between them isn't a story.
    assert.ok(!dailyBrief([model(slate)], now, { nba: { '1': stake([0.5, 0.48], [0.3, 0.29]) } }).some((i) => i.kind === 'stakes'));
  });

  it('looks further ahead when nothing is on in the next day and a half', () => {
    const items = dailyBrief([model([game('1', 60, 0.7)])], now);
    assert.equal(items[0]?.kind, 'favorite');
    assert.equal(dailyBrief([model([game('1', 200, 0.7)])], now).length, 0);
  });

  it('names the hottest and coldest teams only when the move is real', () => {
    const rankings = [
      { team: team('UP'), trend: trend(1500, 1540) },
      { team: team('DOWN'), trend: trend(1500, 1470) },
      { team: team('FLAT'), trend: trend(1500, 1505) }
    ];
    const kinds = dailyBrief([model([], rankings)], now).map((i) => [i.kind, i.title]);
    assert.deepEqual(kinds, [
      ['hot', 'Hottest team: UP'],
      ['cold', 'Sliding: DOWN']
    ]);
    const quiet = dailyBrief([model([], [{ team: team('FLAT'), trend: trend(1500, 1505) }])], now);
    assert.equal(quiet.length, 0);
  });
});
