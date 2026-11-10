import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { FORMAT_RULES, PlayoffFormat, SeasonGameInput, SeasonOutlook, SeasonRecord, SeasonTeamInput, simulateSeason } from '../lib/model/season';

const close = (a: number, b: number, tolerance = 1e-9) => assert.ok(Math.abs(a - b) <= tolerance, `${a} is not within ${tolerance} of ${b}`);
const sum = (outlook: SeasonOutlook, pick: (t: SeasonOutlook['teams'][number]) => number | null) => outlook.teams.reduce((s, t) => s + (pick(t) ?? 0), 0);

const LAYOUT: Record<PlayoffFormat, { divisions: number; perDivision: number }> = {
  nfl: { divisions: 4, perDivision: 4 },
  nba: { divisions: 3, perDivision: 5 },
  mlb: { divisions: 3, perDivision: 5 },
  nhl: { divisions: 2, perDivision: 8 }
};

const empty = (): SeasonRecord => ({ wins: 0, losses: 0, ties: 0, otLosses: 0 });

function makeTeams(format: PlayoffFormat, rating: (i: number) => number = () => 1500, record: (i: number) => SeasonRecord = empty): SeasonTeamInput[] {
  const { divisions, perDivision } = LAYOUT[format];
  const teams: SeasonTeamInput[] = [];
  for (let c = 0; c < 2; c += 1) {
    for (let d = 0; d < divisions; d += 1) {
      for (let k = 0; k < perDivision; k += 1) {
        const i = teams.length;
        teams.push({ id: `t${i}`, conference: `C${c}`, division: `C${c}-D${d}`, record: record(i), rating: rating(i) });
      }
    }
  }
  return teams;
}

describe('a season with games decided by hand', () => {
  const teams = makeTeams('nfl', () => 1500, (i) => ({ ...empty(), wins: 4, losses: 4 + (i % 2) }));
  /** Enough games for every team to matter. */
  const games = () => {
    const list: SeasonGameInput[] = [];
    for (let round = 0; round < 9; round += 1) for (let i = 0; i < teams.length; i += 2) list.push({ homeId: teams[(i + round) % teams.length].id, awayId: teams[(i + round + 1 + round * 2) % teams.length].id, diff: 0 });
    return list.filter((g) => g.homeId !== g.awayId);
  };
  const run = (list: SeasonGameInput[]) => simulateSeason({ format: 'nfl', teams, games: list, homeEdge: 0 }, { sims: 1500, seed: 7 });
  const of = (o: ReturnType<typeof run>, id: string) => o.teams.find((t) => t.id === id)!;

  it('plays a decided game the way it was picked, every time', () => {
    const list = games();
    list[0] = { ...list[0], winner: 'home' };
    const base = run(games());
    const picked = run(list);
    // An even game is worth half a win on average; deciding it is worth a whole one.
    assert.ok(Math.abs(of(picked, list[0].homeId).wins - of(base, list[0].homeId).wins - 0.5) < 0.05, 'the home team gains about half a win');
    assert.ok(Math.abs(of(picked, list[0].awayId).wins - of(base, list[0].awayId).wins + 0.5) < 0.05, 'the visitor loses about half a win');
  });

  it('moves a team that runs the table up, and one that loses out down', () => {
    const id = teams[0].id;
    const decide = (win: boolean) =>
      games().map((g): SeasonGameInput => (g.homeId === id ? { ...g, winner: win ? 'home' : 'away' } : g.awayId === id ? { ...g, winner: win ? 'away' : 'home' } : g));
    const base = of(run(games()), id).playoffs;
    assert.ok(of(run(decide(true)), id).playoffs > base + 0.2);
    assert.ok(of(run(decide(false)), id).playoffs < base - 0.2);
  });

  it('leaves wins untouched for teams outside the picked game, the same luck everywhere else', () => {
    const list = games();
    list[0] = { ...list[0], winner: 'away' };
    const base = run(games());
    const picked = run(list);
    const involved = new Set([list[0].homeId, list[0].awayId]);
    for (const t of base.teams) if (!involved.has(t.id)) assert.equal(of(picked, t.id).wins, t.wins, t.id);
  });

  // Best-of-seven series take a varying number of draws, so with one stream a changed bracket would shift the
  // luck of every later simulation, and teams nowhere near a pick would move. Only the NFL's one-game rounds hide that.
  for (const format of ['nba', 'nhl'] as const) {
    it(`leaves the other conference alone in the ${format.toUpperCase()}, playoffs and all`, () => {
      const field = makeTeams(format, (i) => 1500 + ((i * 37) % 120) - 60, (i) => ({ ...empty(), wins: 10 + (i % 4), losses: 10 }));
      const east = field.filter((t) => t.conference === 'C0');
      const schedule = [...east.flatMap((t, i) => east.slice(i + 1).map((o) => ({ homeId: t.id, awayId: o.id, diff: 0 }))), ...field.filter((t) => t.conference === 'C1').flatMap((t, i, all) => all.slice(i + 1).map((o) => ({ homeId: t.id, awayId: o.id, diff: 0 })))];
      const sim = (list: SeasonGameInput[]) => simulateSeason({ format, teams: field, games: list, homeEdge: 30 }, { sims: 800, seed: 11 });
      const plain = sim(schedule);
      const picked = sim(schedule.map((g, i) => (i === 0 ? { ...g, winner: 'home' as const } : g)));
      for (const t of plain.teams.filter((x) => x.conference === 'C1')) {
        const after = picked.teams.find((x) => x.id === t.id)!;
        assert.equal(after.wins, t.wins, `${t.id} wins`);
        assert.equal(after.playoffs, t.playoffs, `${t.id} playoffs`);
      }
      // The pick did reach its own conference.
      assert.ok(picked.teams.filter((x) => x.conference === 'C0').some((t) => t.playoffs !== plain.teams.find((p) => p.id === t.id)!.playoffs));
    });
  }

  it("doesn't change a run that decides nothing", () => {
    assert.deepEqual(run(games()).teams, run(games()).teams);
  });
});

/** One game between every pair of teams, home side alternating. */
function roundRobin(teams: SeasonTeamInput[], homeEdge: number): SeasonGameInput[] {
  const games: SeasonGameInput[] = [];
  teams.forEach((a, i) =>
    teams.slice(i + 1).forEach((b, j) => {
      const [home, away] = (i + j) % 2 ? [a, b] : [b, a];
      games.push({ homeId: home.id, awayId: away.id, diff: home.rating - away.rating + homeEdge });
    })
  );
  return games;
}

/** A finished regular season: team i has `wins(i)` wins and the rest losses. */
function finished(format: PlayoffFormat, wins: (i: number) => number) {
  return (i: number) => ({ ...empty(), wins: wins(i), losses: FORMAT_RULES[format].seasonGames - wins(i) });
}

const FIELD: Record<PlayoffFormat, { playoffs: number; divisions: number; byes: number }> = {
  nfl: { playoffs: 14, divisions: 8, byes: 2 },
  nba: { playoffs: 16, divisions: 0, byes: 0 },
  mlb: { playoffs: 12, divisions: 6, byes: 4 },
  nhl: { playoffs: 16, divisions: 4, byes: 0 }
};

describe('season simulation', () => {
  for (const format of ['nfl', 'nba', 'mlb', 'nhl'] as PlayoffFormat[]) {
    it(`fills every ${format.toUpperCase()} playoff slot exactly once per simulation`, () => {
      const teams = makeTeams(format, (i) => 1500 + ((i * 37) % 200) - 100);
      const outlook = simulateSeason({ format, teams, games: roundRobin(teams, 30), homeEdge: 30 }, { sims: 2000 });
      assert.equal(outlook.sims, 2000);
      close(sum(outlook, (t) => t.title), 1);
      close(sum(outlook, (t) => t.final), 2);
      close(sum(outlook, (t) => t.playoffs), FIELD[format].playoffs);
      close(sum(outlook, (t) => t.divisionTitle), FIELD[format].divisions);
      close(sum(outlook, (t) => t.bye), FIELD[format].byes);
      if (format === 'nba') close(sum(outlook, (t) => t.playIn), 8);
      for (const t of outlook.teams) {
        assert.ok(t.title <= t.final && t.final <= t.playoffs, `${t.id}: title ${t.title}, final ${t.final}, playoffs ${t.playoffs}`);
        assert.ok(t.winsLow <= t.wins && t.wins <= t.winsHigh, `${t.id}: ${t.winsLow} ≤ ${t.wins} ≤ ${t.winsHigh}`);
      }
    });
  }

  it('reports a game’s playoff stakes: winning it helps both teams’ chances, and they bracket the overall odds', () => {
    // Late in an NFL season with the bubble close: one tracked game between two bubble teams.
    const teams = makeTeams('nfl', () => 1500, (i) => ({ ...empty(), wins: 9 - (i % 5), losses: 6 + (i % 5) }));
    const games = roundRobin(teams, 0).slice(0, 40);
    games[0] = { ...games[0], id: 'g0' };
    const outlook = simulateSeason({ format: 'nfl', teams, games, homeEdge: 0 }, { sims: 4000 });
    const stakes = outlook.stakes.g0;
    assert.ok(stakes, 'the tracked game has stakes');
    assert.deepEqual(Object.keys(outlook.stakes), ['g0'], 'only tracked games');
    for (const side of ['home', 'away'] as const) {
      const id = side === 'home' ? games[0].homeId : games[0].awayId;
      const overall = outlook.teams.find((t) => t.id === id)!.playoffs;
      assert.ok(stakes[side].ifWin > stakes[side].ifLoss, `${side}: ${stakes[side].ifWin} > ${stakes[side].ifLoss}`);
      assert.ok(stakes[side].ifLoss <= overall + 1e-9 && overall <= stakes[side].ifWin + 1e-9, `${side}: ${stakes[side].ifLoss} ≤ ${overall} ≤ ${stakes[side].ifWin}`);
    }
  });

  it('finds the total that gets a team in: more wins, better odds, and the cutoff sits where they cross half', () => {
    const teams = makeTeams('nba', (i) => 1500 + ((i * 37) % 200) - 100);
    const outlook = simulateSeason({ format: 'nba', teams, games: roundRobin(teams, 30), homeEdge: 30 }, { sims: 4000 });
    const withCutoff = outlook.teams.filter((t) => t.cutoff !== null);
    assert.ok(withCutoff.length > 20, `${withCutoff.length} teams with a cutoff`);
    for (const t of withCutoff) {
      // In a 30-team, 82-game league the line is somewhere around 40 wins, not at either extreme.
      assert.ok(t.cutoff! > 30 && t.cutoff! < 55, `${t.id}: ${t.cutoff}`);
    }
  });

  it('doesn’t confuse a game’s stakes with the team being drawn stronger', () => {
    // Early season, nothing decided: with big rating drift, a team that wins a game in a run is often one drawn
    // stronger, so splitting runs by the result would inflate the stakes. Tracked games ignore the drift.
    const teams = makeTeams('nba');
    const games = roundRobin(teams, 0);
    games[0] = { ...games[0], id: 'g0' };
    const outlook = simulateSeason({ format: 'nba', teams, games, homeEdge: 0 }, { sims: 6000, drift: 120 });
    const s = outlook.stakes.g0;
    // One game of 82 between average teams: a few points at most, not the 10+ the drift would fake.
    assert.ok(s.home.ifWin - s.home.ifLoss < 0.06, `home swing ${s.home.ifWin - s.home.ifLoss}`);
    assert.ok(s.away.ifWin - s.away.ifLoss < 0.06, `away swing ${s.away.ifWin - s.away.ifLoss}`);
  });

  it('plays every team to a full season, filling games not yet scheduled', () => {
    const teams = makeTeams('nba');
    const games = roundRobin(teams, 0);
    const outlook = simulateSeason({ format: 'nba', teams, games, homeEdge: 0 }, { sims: 500 });
    // A round robin is 29 games each, so 53 per team are against an average opponent.
    assert.equal(outlook.unscheduled, 30 * 53);
    for (const t of outlook.teams) {
      assert.equal(t.games, 82);
      close(t.wins + t.losses, 82, 1e-9);
    }
  });

  it('gives each scheduled game exactly one winner', () => {
    const teams = makeTeams('nfl', (i) => 1400 + i * 6, () => ({ wins: 3, losses: 2, ties: 0, otLosses: 0 }));
    // Twelve more games each, so nothing needs filling: 17 in all.
    const games: SeasonGameInput[] = [];
    for (let round = 1; round <= 12; round += 1) {
      for (let i = 0; i < teams.length; i += 2) {
        const a = teams[i];
        const b = teams[(i + 2 * round + 1) % teams.length];
        games.push({ homeId: a.id, awayId: b.id, diff: a.rating - b.rating });
      }
    }
    const outlook = simulateSeason({ format: 'nfl', teams, games, homeEdge: 36 }, { sims: 1000 });
    assert.equal(outlook.unscheduled, 0);
    close(sum(outlook, (t) => t.wins) - sum(outlook, (t) => t.current.wins), games.length, 1e-6);
    close(sum(outlook, (t) => t.losses) - sum(outlook, (t) => t.current.losses), games.length, 1e-6);
  });

  it('makes a dominant team a near-certain champion', () => {
    for (const format of ['nba', 'nhl', 'mlb'] as PlayoffFormat[]) {
      const teams = makeTeams(format, (i) => (i === 3 ? 2300 : 1500));
      const outlook = simulateSeason({ format, teams, games: roundRobin(teams, 30), homeEdge: 30 }, { sims: 2000, drift: 0 });
      const best = outlook.teams[3];
      assert.ok(best.playoffs > 0.999, `${format} playoffs ${best.playoffs}`);
      assert.ok(best.title > 0.97, `${format} title ${best.title}`);
    }
    // Single-elimination football is less forgiving, but not by much at this gap.
    const nfl = makeTeams('nfl', (i) => (i === 3 ? 2300 : 1500));
    const outlook = simulateSeason({ format: 'nfl', teams: nfl, games: [], homeEdge: 36 }, { sims: 2000, drift: 0 });
    assert.ok(outlook.teams[3].title > 0.9, `nfl title ${outlook.teams[3].title}`);
  });

  it('splits the title evenly between identical teams', () => {
    const teams = makeTeams('nhl');
    const outlook = simulateSeason({ format: 'nhl', teams, games: [], homeEdge: 0 }, { sims: 10_000 });
    for (const t of outlook.teams) {
      close(t.title, 1 / 32, 0.01);
      close(t.playoffs, 0.5, 0.03);
    }
  });

  it('keeps a finished regular season fixed and plays the NBA play-in', () => {
    // Team i finishes with 70 - 2i wins, so seeds follow team order within each conference.
    const teams = makeTeams('nba', () => 1500, finished('nba', (i) => 70 - 2 * (i % 15)));
    const outlook = simulateSeason({ format: 'nba', teams, games: [], homeEdge: 40 }, { sims: 4000, drift: 0 });
    assert.equal(outlook.unscheduled, 0);
    const conference = outlook.teams.slice(0, 15);
    for (const t of conference.slice(0, 6)) assert.equal(t.playoffs, 1);
    for (const t of conference.slice(10)) assert.equal(t.playoffs, 0);
    for (const t of conference.slice(6, 10)) {
      assert.equal(t.playIn, 1);
      assert.ok(t.playoffs > 0 && t.playoffs < 1);
    }
    close(sum({ ...outlook, teams: conference.slice(6, 10) }, (t) => t.playoffs), 2);
    // The 7th seed hosts both of its chances, so it gets in far more often than the 10th.
    assert.ok(conference[6].playoffs > 0.6 && conference[9].playoffs < 0.4, `${conference[6].playoffs} vs ${conference[9].playoffs}`);
    assert.equal(conference[0].wins, 70);
  });

  it('seeds NFL division winners first and gives the top seed a bye', () => {
    const teams = makeTeams('nfl', () => 1500, finished('nfl', (i) => 16 - (i % 16)));
    const outlook = simulateSeason({ format: 'nfl', teams, games: [], homeEdge: 36 }, { sims: 2000, drift: 0 });
    assert.equal(outlook.teams[0].bye, 1);
    // The first team in each division wins it.
    for (const i of [0, 4, 8, 12]) assert.equal(outlook.teams[i].divisionTitle, 1);
    // Three wild cards: the best three of the rest (teams 1, 2 and 3 have 15, 14 and 13 wins).
    for (const i of [1, 2, 3]) assert.equal(outlook.teams[i].playoffs, 1);
    assert.equal(outlook.teams[5].playoffs, 0);
  });

  it('counts NHL overtime losses as points', () => {
    const teams = makeTeams('nhl');
    const outlook = simulateSeason({ format: 'nhl', teams, games: [], homeEdge: 0 }, { sims: 2000, otRate: 0.25 });
    const games = FORMAT_RULES.nhl.seasonGames;
    for (const t of outlook.teams) {
      close(t.points!, 2 * t.wins + t.otLosses);
      close(t.wins + t.losses + t.otLosses, games, 1e-9);
      // Half the games are lost, a quarter of those past regulation.
      close(t.otLosses, games * 0.5 * 0.25, 1.5);
    }
  });

  it('is reproducible with a seed', () => {
    const teams = makeTeams('mlb', (i) => 1450 + i * 3);
    const input = { format: 'mlb' as const, teams, games: roundRobin(teams, 18), homeEdge: 18 };
    assert.deepEqual(simulateSeason(input, { sims: 300, seed: 7 }), simulateSeason(input, { sims: 300, seed: 7 }));
  });

  it('refuses a conference layout the format does not fit', () => {
    const teams = makeTeams('nfl').map((t) => ({ ...t, division: t.division.replace('D3', 'D2') }));
    assert.throws(() => simulateSeason({ format: 'nfl', teams, games: [], homeEdge: 36 }, { sims: 10 }), /structure/);
  });
});
