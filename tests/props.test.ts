import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { BoxScore, NbaLine } from '../lib/boxscores';
import type { Game } from '../lib/espn';
import { nbaPlayerPass } from '../lib/model/nbaPlayers';
import { legId, liveDecision, parlayState, parseLegId, propResult } from '../lib/legs';
import type { LegLink } from '../lib/model/correlation';
import { chanceAt, impliedMean, ladder, lineChances, overAt, overChance } from '../lib/model/propModel';
import { liveOverChance } from '../lib/model/liveProps';
import { liveParlayChance, readShareCode, settle, shareCode, summarize, sweatTrail } from '../lib/parlay';
import { parseSplits } from '../lib/playSplits';
import { BOOKS, fairOver, mainLines, parseProps } from '../lib/props';

const close = (a: number, b: number, tolerance = 1e-6) => assert.ok(Math.abs(a - b) <= tolerance, `${a} is not within ${tolerance} of ${b}`);
const [draftKings, espnBet] = BOOKS;

const item = (athlete: string, type: string, line: number, american: string, side?: 'over' | 'under', open?: { line: number; american: string }) => ({
  athlete: { $ref: `http://x/athletes/${athlete}?lang=en` },
  type: { name: type },
  odds: { american: { value: american, open: open?.american }, total: { value: String(line), open: open ? String(open.line) : undefined } },
  current: { target: { value: line }, ...(side ? { [side]: { american } } : {}) },
  open: open ? { target: { value: open.line } } : undefined
});

describe('sportsbook props', () => {
  it("reads DraftKings pairs over-first and ESPN BET's labeled sides", () => {
    const dk = parseProps([item('1', 'Total Points', 21.5, '-118', undefined, { line: 21.5, american: '-113' }), item('1', 'Total Points', 21.5, '-108', undefined, { line: 21.5, american: '-113' })], draftKings, 'nba');
    assert.deepEqual(dk, [{ athleteId: '1', market: 'pts', line: 21.5, over: -118, under: -108, book: 'DraftKings', open: { line: 21.5, over: -113, under: -113 } }]);
    // ESPN BET lists the under first here; its labels win.
    const eb = parseProps([item('2', 'Total Rebounds', 7.5, '+105', 'under'), item('2', 'Total Rebounds', 7.5, '-135', 'over')], espnBet, 'nba');
    assert.equal(eb[0].over, -135);
    assert.equal(eb[0].under, 105);
    // Unlabeled ESPN BET pairs can't be read safely, and one-sided offers aren't over/unders.
    assert.equal(parseProps([item('3', 'Total Assists', 4.5, '-110'), item('3', 'Total Assists', 4.5, '-110')], espnBet, 'nba').length, 0);
    assert.equal(parseProps([item('4', 'Total Points', 30.5, '+150')], draftKings, 'nba').length, 0);
    assert.equal(parseProps([item('5', 'First Basket', 0.5, '+600'), item('5', 'First Basket', 0.5, '-900')], draftKings, 'nba').length, 0);
  });

  it("reads each league's market names", () => {
    const pair = (type: string) => [item('7', type, 2.5, '-120'), item('7', type, 2.5, '+100')];
    assert.equal(parseProps(pair('Total Shots on Goal'), draftKings, 'nhl')[0].market, 'sog');
    // A hockey point is a goal or an assist; the same name means basketball points in the NBA.
    assert.equal(parseProps(pair('Total Points'), draftKings, 'nhl')[0].market, 'pts');
    assert.equal(parseProps(pair('Total Receiving Yards (incl. overtime)'), draftKings, 'nfl')[0].market, 'rec_yds');
    assert.equal(parseProps(pair('Total Shots on Goal'), draftKings, 'nba').length, 0);
  });

  it('keeps a line posted without prices as the book’s 50/50 point', () => {
    const bare = (athlete: string) => ({ athlete: { $ref: `http://x/athletes/${athlete}` }, type: { name: 'Total Passing Yards (incl. overtime)' }, current: { target: { value: 270.5 } } });
    const [line] = parseProps([bare('9'), bare('9')], draftKings, 'nfl');
    assert.equal(line.line, 270.5);
    assert.equal(line.over, null);
    assert.equal(fairOver(line), 0.5);
  });

  it('removes the margin and picks the main line', () => {
    close(fairOver({ over: -110, under: -110 }), 0.5);
    close(fairOver({ over: -150, under: 130 }), 0.6 / (0.6 + 100 / 230));
    const lines = [
      { athleteId: '1', market: 'pts' as const, line: 19.5, over: -200, under: 160, book: 'DraftKings', open: null },
      { athleteId: '1', market: 'pts' as const, line: 21.5, over: -112, under: -108, book: 'DraftKings', open: null },
      { athleteId: '1', market: 'pts' as const, line: 24.5, over: 180, under: -230, book: 'DraftKings', open: null }
    ];
    assert.equal(mainLines(lines)[0].line, 21.5);
  });
});

describe('over/under chances', () => {
  it('adds up, and a higher line is less likely to go over', () => {
    const { over, under, push } = lineChances(20, 60, 20);
    close(over + under + push, 1, 1e-9);
    assert.ok(push > 0, 'a whole-number line can push');
    assert.equal(lineChances(20, 60, 20.5).push, 0);
    const params = { dispersion: { pts: [3, 0] } } as Parameters<typeof overChance>[0];
    assert.ok(overChance(params, 'pts', 20, 15.5) > overChance(params, 'pts', 20, 20.5));
    assert.ok(overChance(params, 'pts', 20, 20.5) > overChance(params, 'pts', 20, 25.5));
    // With the mean right on the line, a lumpy count still lands near a coin flip.
    close(overChance(params, 'pts', 20.5, 20.5), 0.5, 0.06);
  });

  it('matches a Poisson when the spread equals the mean', () => {
    // P(X > 2.5) for Poisson(2) is 1 - e^-2 (1 + 2 + 2) = 0.3233.
    close(lineChances(2, 2.000001, 2.5).over, 1 - Math.exp(-2) * 5, 1e-3);
  });
});

describe('chances at any line', () => {
  const params = { dispersion: { pts: [3.972, 0] as [number, number], goals: [1.172, 0] as [number, number] }, lineSpread: { pts: 0.8 } };

  it('reads a line and its chance back as a mean that gives the same chance', () => {
    for (const [line, p] of [
      [24.5, 0.5],
      [24.5, 0.62],
      [9.5, 0.3],
      [0.5, 0.25]
    ] as const) {
      for (const scale of [0.5, 0.8, 1]) {
        close(overAt(params, 'pts', impliedMean(params, 'pts', line, p, scale), line, scale), p, 1e-4);
      }
    }
  });

  it('gives the main line its own chance and falls as the line rises', () => {
    const chance = chanceAt(params, 'pts', 24.5, 0.55);
    assert.equal(chance(24.5), 0.55);
    let last = 1;
    for (let at = 10.5; at <= 40.5; at += 1) {
      assert.ok(chance(at) < last, `chance at ${at} should be below the one before`);
      last = chance(at);
    }
    // A tighter spread around the same line makes far-off lines less likely.
    const wide = chanceAt({ ...params, lineSpread: { pts: 1 } }, 'pts', 24.5, 0.55);
    assert.ok(chance(34.5) < wide(34.5));
  });

  it('picks a handful of round thresholds between likely and unlikely', () => {
    const chance = chanceAt(params, 'pts', 24.5, 0.5);
    const ks = ladder(chance, 24.5);
    assert.ok(ks.length >= 3 && ks.length <= 8, `${ks.length} thresholds`);
    for (const k of ks) assert.ok(chance(k - 0.5) > 0.03 && chance(k - 0.5) < 0.97);
    assert.deepEqual(ks, [...ks].sort((a, b) => a - b));
    assert.deepEqual(ladder(chanceAt(params, 'goals', 0.5, 0.3), 0.5), [1, 2].filter((k) => chanceAt(params, 'goals', 0.5, 0.3)(k - 0.5) > 0.03));
  });

  it('decides legs mid-game only when a count is past the line', () => {
    assert.equal(liveDecision(27, 26.5, 'over', 'pts'), 'won');
    assert.equal(liveDecision(27, 26.5, 'under', 'pts'), 'lost');
    assert.equal(liveDecision(20, 26.5, 'over', 'pts'), null);
    assert.equal(liveDecision(26.5, 26.5, 'under', 'pts'), null);
    // Yards can go back down.
    assert.equal(liveDecision(90, 60.5, 'over', 'rec_yds'), null);
    assert.equal(liveDecision(6, 4.5, 'over', 'rec'), 'won');
  });
});

describe('live prop chances', () => {
  const base = { dispersion: { pts: [3.972, 0] as [number, number] }, lineSpread: { pts: 0.8 } };
  const live = { checkpoints: [0.25, 0.5, 0.75], pace: [0.95, 1, 0.95], carry: [0, 0.1, 0.1], spread: [1, 1, 1.2], blowout: [0.05, 0.1, 0.3], blowoutFrom: 12, blowoutPer: 10 };
  const at = (current: number, played: number, lead = 0) => liveOverChance(base, live, 'pts', 24.5, 0.55, { current, played, lead });

  it('starts from the pregame chance and settles by the end', () => {
    close(at(0, 0), 0.55, 1e-3);
    assert.equal(at(25, 0.5), 1);
    assert.equal(at(20, 1), 0);
  });

  it('rises with the stat so far, falls as time runs out, and falls in a blowout', () => {
    assert.ok(at(16, 0.5) > at(10, 0.5));
    assert.ok(at(16, 0.75) < at(16, 0.5));
    assert.ok(at(18, 0.75, 25) < at(18, 0.75, 0));
  });

  it('turns tracked legs into a chance to cash now', () => {
    const legs = [
      { key: 'a', league: 'nba', gameId: '1', prob: 0.5, price: -110 },
      { key: 'b', league: 'nba', gameId: '2', prob: 0.4, price: 150, link: { kind: 'win', teamId: '9' } as const },
      { key: 'c', league: 'nba', gameId: '3', prob: 0.5, price: -110, line: 24.5, link: { kind: 'prop', playerId: '1', teamId: '9', market: 'pts', side: 'under' } as const }
    ];
    const tables = {};
    assert.equal(liveParlayChance(legs, { a: 'lost' }, {}, tables), 0);
    // Not started: pregame chances multiply.
    close(liveParlayChance(legs, {}, {}, tables)!, 0.5 * 0.4 * 0.5, 1e-9);
    // One leg won, a team ahead live, an under already past its line.
    const live = (extra: object) => ({ state: 'pending' as const, actual: null, live: { status: 'Q3', decided: null, chance: null, ...extra } });
    close(liveParlayChance(legs, { a: 'won' }, { b: live({ chance: 0.8 }) }, tables)!, 0.8 * 0.5, 1e-9);
    assert.equal(liveParlayChance(legs, { a: 'won' }, { c: { ...live({ decided: 'lost' }), actual: 30 } }, tables), 0);
    // No clock to read yet: no number rather than a made-up one.
    assert.equal(liveParlayChance(legs, {}, { c: { ...live({ played: null, lead: 3 }), actual: 10 } }, tables), null);
  });

  it('leans football props with the score: behind means more throwing, ahead more running', () => {
    const leg = (market: 'rec_yds' | 'rush_yds', line: number) => [
      { key: 'd', league: 'nfl', gameId: '4', prob: 0.5, price: -110, line, link: { kind: 'prop', playerId: '2', teamId: '7', market, side: 'over' } as const }
    ];
    const at = (market: 'rec_yds' | 'rush_yds', line: number, current: number, edge: number) =>
      liveParlayChance(leg(market, line), {}, { d: { state: 'pending', actual: current, live: { status: 'Half', decided: null, chance: null, played: 0.5, lead: Math.abs(edge), edge } } }, {})!;
    assert.ok(at('rec_yds', 60.5, 30, -14) > at('rec_yds', 60.5, 30, 0));
    assert.ok(at('rec_yds', 60.5, 30, 0) > at('rec_yds', 60.5, 30, 14));
    assert.ok(at('rush_yds', 70.5, 35, 10) > at('rush_yds', 70.5, 35, -10));
  });
});

describe('shared parlays', () => {
  const legs = [
    { league: 'nba', gameId: '401', link: { kind: 'prop', playerId: '5', teamId: '9', market: 'pts', side: 'over' } as const, line: 24.5 },
    { league: 'nba', gameId: '402', link: { kind: 'win', teamId: '3' } as const }
  ];
  const ids = ['p~nba~401~5~pts~24.5~over', 'w~nba~402~3'];

  it('round-trips legs and the offered price through a link', () => {
    const code = shareCode(legs, 450)!;
    assert.equal(code, `@450,${ids.join(',')}`);
    // Nothing a URL path would have to escape.
    assert.match(code, /^[A-Za-z0-9~.,@+-]+$/);
    assert.deepEqual(readShareCode(code), { ids, price: 450 });
    assert.deepEqual(readShareCode(encodeURIComponent(code)), { ids, price: 450 });
    assert.deepEqual(readShareCode(shareCode(legs, null)!), { ids, price: null });
  });

  it('keeps only well-formed legs, a real price and at most a dozen', () => {
    assert.deepEqual(readShareCode('@99,<script>alert(1)</script>,w~nba~402~3,p~nba~1~2~zzz~1~over,..%2F..%2Fetc,%E0%A4%A'), { ids: ['w~nba~402~3'], price: null });
    const many = Array.from({ length: 30 }, (_, i) => `w~nba~${i + 1}~1`).join(',');
    assert.equal(readShareCode(many).ids.length, 12);
    assert.equal(shareCode([{ league: 'nba', gameId: '1' }], null), null);
  });
});

describe('the sweat', () => {
  const prop = { key: 'a', league: 'nba', gameId: '1', prob: 0.5, price: -110, line: 24.5, link: { kind: 'prop', playerId: '5', teamId: '9', market: 'pts', side: 'over' } as const };
  const win = { key: 'b', league: 'nba', gameId: '1', prob: 0.6, price: -150, link: { kind: 'win', teamId: '9' } as const };
  const later = { key: 'c', league: 'nba', gameId: '2', prob: 0.4, price: 150, link: { kind: 'win', teamId: '3' } as const };
  const id = 'p~nba~1~5~pts~24.5~over';
  const game = { league: 'nba', home: '9', final: true, t: [0, 1, 2], played: [0, 0.5, 1], margin: [0, 10, 8], stats: { [id]: [0, 20, 30] } };

  it('replays the chance to cash from the pregame chance to the final play', () => {
    const points = sweatTrail([prop, win], {}, { 1: game }, {});
    assert.equal(points.length, 3);
    close(points[0].chance!, 0.5 * 0.6, 2e-3);
    // 20 points at halftime and up 10: both legs look better than before the game.
    assert.ok(points[1].legs[0]! > 0.5 && points[1].legs[1]! > 0.6);
    assert.ok(points[1].chance! > points[0].chance!);
    // Over at the final play, graded from it when the tracker hasn't yet.
    assert.deepEqual(points[2].legs, [1, 1]);
    assert.equal(points[2].chance, 1);
    // A grade wins over the replay.
    assert.equal(sweatTrail([prop, win], { a: 'lost' }, { 1: game }, {})[2].chance, 0);
  });

  it('holds a game not started yet at its pregame chance, and drops a voided leg', () => {
    const points = sweatTrail([prop, later], { a: 'void' }, { 1: game }, {});
    assert.deepEqual(
      points.map((p) => p.legs),
      [
        [null, 0.4],
        [null, 0.4],
        [null, 0.4]
      ]
    );
    close(points[2].chance!, 0.4, 1e-9);
  });
});

describe('play-by-play splits', () => {
  const play = (period: number, type: string, text: string, people: [string, string][], start = 75, score?: [number, number]) => ({
    period: { number: period },
    type: { text: type },
    text,
    participants: people.map(([type, id]) => ({ type, athlete: { $ref: `http://x/athletes/${id}?lang=en` } })),
    start: { yardsToEndzone: start },
    ...(score ? { homeScore: score[0], awayScore: score[1] } : {})
  });

  it('rebuilds football stats quarter by quarter the way official scorers count them', () => {
    const plays = [
      play(1, 'Pass Reception', '(Shotgun) J.Hurts pass short right to A.Brown to PHI 37 for 12 yards (X.Y).', [['passer', '1'], ['receiver', '2']]),
      // Holding behind the runner: only the yards to the foul count.
      play(1, 'Rush', 'S.Barkley right end to PHI 45 for 15 yards (T.Adams).PENALTY on PHI-L.Johnson, Offensive Holding, 10 yards, enforced at PHI 32.', [['rusher', '3']], 70, [7, 0]),
      play(2, 'Pass Reception', 'J.Hurts pass short left to D.Smith for 20 yards.PENALTY on PHI-X.Y, Offensive Holding, 10 yards, enforced at PHI 30 - No Play.', [['passer', '1'], ['receiver', '4']]),
      play(2, 'Sack', 'J.Hurts sacked at PHI 20 for -8 yards (X.Y).', [['passer', '1']]),
      play(2, 'Pass Incompletion', 'J.Hurts pass incomplete deep left to A.Brown.', [['passer', '1'], ['receiver', '2']], 75, [7, 3]),
      play(3, 'Passing Touchdown', 'J.Hurts pass short left to A.Brown for 5 yards, TOUCHDOWN. TWO-POINT CONVERSION ATTEMPT. J.Hurts pass to D.Smith is complete. ATTEMPT SUCCEEDS.', [['passer', '1'], ['receiver', '2'], ['patScorer', '4']]),
      play(3, 'Pass Reception', 'J.Hurts pass short left to D.Smith to PHI 40 for no gain. Lateral to A.Brown to 50 for 10 yards (X.Y).', [['passer', '1'], ['receiver', '4']], 60, [15, 3]),
      play(4, 'Pass Incompletion', 'J.Hurts pass short right to D.Smith to PHI 45 for 7 yards.Philadelphia challenged the pass completion ruling, and the play was REVERSED.J.Hurts pass incomplete short right to D.Smith.', [['passer', '1'], ['receiver', '4']]),
      play(4, 'Fumble Recovery (Own)', '(Shotgun) J.Hurts FUMBLES (Aborted) at PHI 30, and recovers at PHI 28.', [['rusher', '1'], ['recoverer', '1']], 75, [15, 10]),
      // Overtime counts toward the fourth quarter.
      play(5, 'Rushing Touchdown', 'S.Barkley up the middle for 3 yards, TOUCHDOWN.', [['rusher', '3']], 3, [21, 15])
    ];
    const s = parseSplits('nfl', { plays })!;
    // Margins after each regulation quarter; overtime doesn't move the last one.
    assert.deepEqual(s.margins, [7, 4, 12, 5]);
    assert.deepEqual(s.players['1'], { pass_att: [1, 1, 2, 1], pass_cmp: [1, 0, 2, 0], pass_yds: [12, 0, 15, 0], pass_td: [0, 0, 1, 0], rush_att: [0, 0, 0, 1] });
    assert.deepEqual(s.players['2'], { rec: [1, 0, 1, 0], rec_yds: [12, 0, 15, 0] });
    assert.deepEqual(s.players['3'], { rush_att: [1, 0, 0, 1], rush_yds: [2, 0, 0, 3] });
    assert.deepEqual(s.players['4'], { rec: [0, 0, 1, 0], rec_yds: [0, 0, 0, 0] });
  });
});

describe('parlays', () => {
  const leg = (gameId: string, prob: number, price: number | null, link?: LegLink) => ({ league: 'nba', gameId, prob, price, link });
  const pts = (market: 'pts' | 'pra', side: 'over' | 'under'): LegLink => ({ kind: 'prop', playerId: '1', teamId: 'T', market, side });
  const table = { nba: { same: { 'pra|pts': 0.9 }, teammate: {}, opponent: {}, win: {}, meta: { games: 0, pairs: 0, from: '', to: '' } } };

  it('multiplies chances and prices across games', () => {
    const s = summarize([leg('1', 0.5, -110), leg('2', 0.5, -110)], null, table)!;
    close(s.chance, 0.25);
    close(s.independent, 0.25);
    assert.equal(s.sameGame, false);
    assert.equal(s.fair, 300);
    close(s.multiplied!.decimal, (1 + 100 / 110) ** 2, 1e-9);
    assert.equal(s.multiplied!.american, 264);
    assert.equal(s.price, 264);
    close(s.expectedReturn!, 0.25 * (1 + 100 / 110) ** 2 - 1, 1e-9);
    assert.ok(s.expectedReturn! < 0, 'two coin flips at -110 lose money');
    assert.equal(summarize([leg('1', 0.6, null)], null, table)!.multiplied, null);
    assert.equal(summarize([], null, table), null);
  });

  it('prices same-game legs jointly and only at the price the book offers', () => {
    const s = summarize([leg('1', 0.5, -110, pts('pts', 'over')), leg('1', 0.5, -110, pts('pra', 'over'))], null, table)!;
    assert.equal(s.sameGame, true);
    close(s.chance, 0.25 + Math.asin(0.9) / (2 * Math.PI), 1e-6);
    // The multiplied price isn't what a book pays on same-game legs, so there's no return until a price is entered.
    assert.equal(s.price, null);
    assert.equal(s.expectedReturn, null);
    const offered = summarize([leg('1', 0.5, -110, pts('pts', 'over')), leg('1', 0.5, -110, pts('pra', 'over'))], 150, table)!;
    close(offered.expectedReturn!, offered.chance * 2.5 - 1, 1e-9);
  });

  it('settles saved parlays, dropping pushed and voided legs', () => {
    const legs = [
      { key: 'a', price: -110 },
      { key: 'b', price: 120 },
      { key: 'c', price: null }
    ];
    assert.deepEqual(settle(legs, 500, { a: 'won', b: 'lost' }), { state: 'lost', profit: -1 });
    assert.deepEqual(settle(legs, 500, { a: 'won', b: 'won' }), { state: 'pending', profit: null });
    assert.deepEqual(settle(legs, 500, { a: 'won', b: 'won', c: 'won' }), { state: 'won', profit: 5 });
    const dropped = settle(legs, 500, { a: 'won', b: 'won', c: 'void' });
    assert.equal(dropped.state, 'won');
    close(dropped.profit!, (1 + 100 / 110) * 2.2 - 1, 1e-9);
    assert.deepEqual(settle(legs, 500, { a: 'won', b: 'push', c: 'won' }), { state: 'won', profit: null });
    assert.deepEqual(settle(legs, 500, { a: 'void', b: 'push', c: 'void' }), { state: 'void', profit: 0 });
  });

  it('turns legs into ids the server can grade', () => {
    const id = legId({ league: 'nba', gameId: '401', link: pts('pts', 'under'), line: 24.5 })!;
    assert.equal(id, 'p~nba~401~1~pts~24.5~under');
    assert.deepEqual(parseLegId(id), { kind: 'prop', league: 'nba', gameId: '401', playerId: '1', market: 'pts', line: 24.5, side: 'under' });
    assert.deepEqual(parseLegId('w~nhl~55~12'), { kind: 'win', league: 'nhl', gameId: '55', teamId: '12' });
    for (const bad of ['p~nba~401~1~constructor~24.5~over', 'p~nba~401~1~pts~~over', 'p~nba~401~x~pts~24.5~over', 'w~nba~401', 'q~nba~1~2']) assert.equal(parseLegId(bad), null);
    assert.equal(legId({ league: 'nba', gameId: '401', link: pts('pts', 'over') }), null);
    assert.deepEqual(propResult(undefined, 24.5, 'over'), { state: 'void', actual: null });
    assert.deepEqual(propResult(25, 25, 'over'), { state: 'push', actual: 25 });
    assert.deepEqual(propResult(20, 24.5, 'under'), { state: 'won', actual: 20 });
    assert.equal(parlayState(['won', 'push', 'pending']), 'pending');
    assert.equal(parlayState(['won', 'lost', 'pending']), 'lost');
  });
});

const nbaLine = (id: string, min: number, pts: number, dnp = false, reason: string | null = null): NbaLine => ({
  id,
  name: id,
  starter: true,
  min,
  pts,
  fgm: 0,
  fga: 0,
  ftm: 0,
  fta: 0,
  oreb: 0,
  dreb: 5,
  ast: 3,
  stl: 1,
  blk: 0,
  tov: 2,
  pf: 2,
  pm: 0,
  dnp,
  reason
});

describe('player projections', () => {
  it("use only earlier games and hand an absent player's minutes to the rest", () => {
    const games: Game[] = [];
    const box: Record<string, BoxScore> = {};
    // 240 minutes a game: the star's 36 plus eight teammates at 25.5.
    const team = (id: string, star: { min: number; pts: number; out?: boolean }) => [
      nbaLine(`${id}-star`, star.out ? 0 : star.min, star.out ? 0 : star.pts, !!star.out, star.out ? 'LEFT ANKLE SPRAIN' : null),
      nbaLine(`${id}-wing`, 25.5, 12),
      ...Array.from({ length: 7 }, (_, k) => nbaLine(`${id}-p${k}`, 25.5, 10))
    ];
    for (let i = 0; i < 30; i += 1) {
      const id = String(i + 1);
      games.push({
        id,
        league: 'nba',
        date: new Date(Date.UTC(2025, 0, 1 + i)).toISOString(),
        seasonYear: 2025,
        seasonType: 2,
        state: 'post',
        completed: true,
        neutral: false,
        home: { teamId: 'H', score: 110 },
        away: { teamId: 'A', score: 100 }
      } as unknown as Game);
      box[id] = { league: 'nba', teams: { H: team('H', { min: 36, pts: 30, out: i === 29 }), A: team('A', { min: 36, pts: 24 }) } };
    }
    const params = { decay: 0.97, priorMinutes: 15, teamShare: 0, paceShare: 0, modelShare: 0, dispersion: {} };
    const lineupParams = { decay: 0.99, priorMinutes: 700, pmWeight: 0.45, shareAlpha: 0.25, baselineAlpha: 0.04, eloPerPoint: 45 };
    const context = { teamPoints: new Map(), leaguePoints: new Map() };
    const projections = nbaPlayerPass(games, box, params, lineupParams, context, { rosters: {}, injuries: {} });

    const early = projections.get('1')!.home.find((p) => p.id === 'H-star')!;
    const late = projections.get('29')!.home.find((p) => p.id === 'H-star')!;
    assert.ok(late.mean.pts! > early.mean.pts!, 'learns that the star scores more than an average player');
    close(late.mean.pts!, 30, 1.5);
    close(late.mean.pra!, late.mean.pts! + late.mean.reb! + late.mean.ast!, 1e-9);
    // In the last game the star is out: no projection for him, and his teammates' minutes (and points) rise.
    const last = projections.get('30')!.home;
    assert.equal(last.find((p) => p.id === 'H-star'), undefined);
    const minutes = (p: { detail: string }) => Number.parseFloat(p.detail);
    const wingBefore = projections.get('29')!.home.find((p) => p.id === 'H-wing')!;
    const wingAfter = last.find((p) => p.id === 'H-wing')!;
    assert.ok(minutes(wingAfter) > minutes(wingBefore) + 3, `wing minutes ${wingBefore.detail} → ${wingAfter.detail}`);
    assert.ok(wingAfter.mean.pts! > wingBefore.mean.pts!);
  });
});
