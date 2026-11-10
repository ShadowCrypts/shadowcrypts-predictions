/**
 * Season projections: a Monte Carlo simulation of the rest of a regular
 * season and the playoffs after it (a postseason already underway is
 * simulated from its bracket in bracket.ts). Each league's playoff format is
 * approximated, and ties in the simulated standings are broken by coin flip
 * rather than the leagues' tiebreaker rules.
 */

export type PlayoffFormat = 'nfl' | 'nba' | 'mlb' | 'nhl';

type FormatRules = {
  /** Regular-season games per team; a team short of it plays the rest against a league-average opponent. */
  seasonGames: number;
  /** Divisions per conference the format needs (the NBA seeds by conference only). */
  divisions: number | null;
  /** Seeds per conference in the postseason field (NBA: 1-10, play-in included). */
  field: number;
  /** NHL standings go by points, with one for an overtime or shootout loss. */
  points: boolean;
  /**
   * Spread (SD, in Elo) of the random shift given to every team's rating in
   * each simulation, for how far off the current ratings may be and how much
   * teams change over the rest of a season.
   */
  drift: number;
  /** Share of final win totals that landed inside the simulated 10th-90th percentile range in the backtest below. */
  rangeCoverage: number;
};

// Drift was chosen by re-running the last two or three finished seasons from their
// quarter, half and three-quarter marks with only what was known then, and scoring
// the playoff odds (log loss) and win ranges against what happened (Oct 2026). The
// NFL's two seasons disagreed (60 vs 160+); 80 sits between them. NBA ranges run
// narrow at any drift: late-season tanking and resting move win totals more than
// the ratings can see, and wider drift made the playoff odds worse.
export const FORMAT_RULES: Record<PlayoffFormat, FormatRules> = {
  nfl: { seasonGames: 17, divisions: 4, field: 7, points: false, drift: 80, rangeCoverage: 0.83 },
  nba: { seasonGames: 82, divisions: null, field: 10, points: false, drift: 30, rangeCoverage: 0.61 },
  mlb: { seasonGames: 162, divisions: 3, field: 6, points: false, drift: 30, rangeCoverage: 0.85 },
  // 84 games from 2026-27 on (82 before).
  nhl: { seasonGames: 84, divisions: 2, field: 8, points: true, drift: 30, rangeCoverage: 0.8 }
};

export type SeasonRecord = { wins: number; losses: number; ties: number; otLosses: number };

export type SeasonTeamInput = {
  id: string;
  conference: string;
  division: string;
  /** Regular-season record so far. */
  record: SeasonRecord;
  /** Pre-line rating (Elo scale), used for playoff games and games not yet scheduled. */
  rating: number;
};

export type SeasonGameInput = {
  homeId: string;
  awayId: string;
  /** Home-minus-away Elo gap behind the pre-line forecast, home field included. */
  diff: number;
  /** Set on games whose playoff stakes should be reported. */
  id?: string;
  /** Decides the game instead of its chance: a scenario someone picked. */
  winner?: 'home' | 'away';
  /** The game's own id and start, carried along for the playoff machine; the simulation doesn't read them. */
  key?: string;
  date?: string;
};

/** Each team's playoff chance if it wins this game and if it loses it. */
export type GameStakes = { home: { ifWin: number; ifLoss: number }; away: { ifWin: number; ifLoss: number } };

export type SeasonInput = {
  format: PlayoffFormat;
  teams: SeasonTeamInput[];
  /** Regular-season games still to play. */
  games: SeasonGameInput[];
  /** Home edge in Elo for playoff games. */
  homeEdge: number;
};

export type SimOptions = {
  sims?: number;
  /** Overrides the format's rating drift. */
  drift?: number;
  seed?: number;
  /** NHL: share of games that reach overtime, where the loser still earns a point. */
  otRate?: number;
};

export type TeamOutlook = {
  id: string;
  conference: string;
  division: string;
  current: SeasonRecord;
  /** Regular-season games, scheduled or not. */
  games: number;
  /** Average final record across the simulations. */
  wins: number;
  losses: number;
  ties: number;
  otLosses: number;
  /** NHL standings points; null elsewhere. */
  points: number | null;
  /** 10th and 90th percentile of final wins. */
  winsLow: number;
  winsHigh: number;
  /** Shares of simulations: made the playoff bracket (NBA: after the play-in). */
  playoffs: number;
  /** NBA: finished 7th to 10th in the conference. */
  playIn: number | null;
  /** Won the division (NFL, MLB, NHL). */
  divisionTitle: number | null;
  /** NFL: the conference's top seed; MLB: a top-two seed. */
  bye: number | null;
  /** Reached the championship round. */
  final: number;
  title: number;
  /** The fewest final wins (NHL: points) that got this team into the playoffs in at least half the simulations ending there; null when too few ended anywhere near it. */
  cutoff: number | null;
};

/** Simulations that must end at a final total for its playoff rate to count toward the cutoff. */
const CUTOFF_MIN_RUNS = 30;

export type SeasonOutlook = {
  sims: number;
  drift: number;
  /** Team-games not on the schedule yet, simulated against a league-average opponent. */
  unscheduled: number;
  teams: TeamOutlook[];
  /** Playoff stakes of the games that asked for them (`id` on the input), by game id. */
  stakes: Record<string, GameStakes>;
};

// Series formats: 1 = the better team hosts, -1 = the other team hosts, 0 = neutral site.
export const BEST_OF_7 = [1, 1, -1, -1, 1, -1, 1];
export const BEST_OF_7_MLB = [1, 1, -1, -1, -1, 1, 1];
export const BEST_OF_5_MLB = [1, 1, -1, -1, 1];
export const BEST_OF_3_HOME = [1, 1, 1];
export const AT_HOME = [1];
export const NEUTRAL = [0];

const ELO_SCALE = Math.LN10 / 400;

/** Small, fast, seedable PRNG so a projection doesn't move when nothing changed. */
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Conference = { name: string; teams: number[]; divisions: number[][] };

function structure(format: PlayoffFormat, teams: SeasonTeamInput[]): Conference[] {
  type Group = { teams: number[]; divisions: Map<string, number[]> };
  const conferences = new Map<string, Group>();
  teams.forEach((t, i) => {
    const conf: Group = conferences.get(t.conference) ?? { teams: [], divisions: new Map() };
    conferences.set(t.conference, conf);
    conf.teams.push(i);
    conf.divisions.set(t.division, [...(conf.divisions.get(t.division) ?? []), i]);
  });
  const result = [...conferences].map(([name, c]) => ({ name, teams: c.teams, divisions: [...c.divisions.values()] }));
  const rules = FORMAT_RULES[format];
  if (result.length !== 2 || result.some((c) => c.teams.length < rules.field || (rules.divisions !== null && c.divisions.length !== rules.divisions))) {
    throw new Error(`Unexpected ${format.toUpperCase()} conference/division structure`);
  }
  return result;
}

type Tally = Record<'made' | 'playIn' | 'division' | 'bye' | 'final' | 'title', Int32Array>;

const newTally = (n: number): Tally => ({
  made: new Int32Array(n),
  playIn: new Int32Array(n),
  division: new Int32Array(n),
  bye: new Int32Array(n),
  final: new Int32Array(n),
  title: new Int32Array(n)
});

type BracketState = {
  rand: () => number;
  /** Starts a part of the bracket on its own stream of luck: series take a varying number of draws. */
  reseed: (part: number) => void;
  /** Each team's rating plus this simulation's shift. */
  strength: Float64Array;
  /** Regular-season standing, higher is better, for home field by record. */
  key: Float64Array;
  homeEdge: number;
  tally: Tally;
};

/** Each league's playoffs, played from conference seeds (best first). */
function bracket(format: PlayoffFormat, conferences: Conference[], n: number, s: BracketState) {
  const { tally } = s;
  const seedOf = new Int32Array(n);

  const series = (better: number, other: number, games: number[]) => {
    const need = (games.length + 1) / 2;
    let w = 0;
    let l = 0;
    for (let g = 0; w < need && l < need; g += 1) {
      const x = s.strength[better] - s.strength[other] + games[g] * s.homeEdge;
      if (s.rand() < 1 / (1 + Math.exp(-x * ELO_SCALE))) w += 1;
      else l += 1;
    }
    return w === need ? better : other;
  };
  const bySeed = (a: number, b: number, games: number[]) => (seedOf[a] <= seedOf[b] ? series(a, b, games) : series(b, a, games));
  const byRecord = (a: number, b: number, games: number[]) => (s.key[a] >= s.key[b] ? series(a, b, games) : series(b, a, games));
  const seed = (field: number[]) => field.forEach((t, i) => (seedOf[t] = i));

  const champions: Record<PlayoffFormat, (conf: Conference, seeds: number[]) => number> = {
    nba: (_, seeds) => {
      for (const t of seeds.slice(6, 10)) tally.playIn[t] += 1;
      const seven = series(seeds[6], seeds[7], AT_HOME);
      const eight = series(seven === seeds[6] ? seeds[7] : seeds[6], series(seeds[8], seeds[9], AT_HOME), AT_HOME);
      const field = [...seeds.slice(0, 6), seven, eight];
      seed(field);
      for (const t of field) tally.made[t] += 1;
      const top = bySeed(bySeed(field[0], field[7], BEST_OF_7), bySeed(field[3], field[4], BEST_OF_7), BEST_OF_7);
      const bottom = bySeed(bySeed(field[1], field[6], BEST_OF_7), bySeed(field[2], field[5], BEST_OF_7), BEST_OF_7);
      return bySeed(top, bottom, BEST_OF_7);
    },
    nhl: (conf, seeds) => {
      // Top three in each division, then two wild cards; seeds run in standings order.
      const tops = conf.divisions.map((d) => seeds.filter((t) => d.includes(t)).slice(0, 3));
      const [a, b] = seeds.indexOf(tops[0][0]) <= seeds.indexOf(tops[1][0]) ? tops : [tops[1], tops[0]];
      const inByDivision = new Set([...a, ...b]);
      const wild = seeds.filter((t) => !inByDivision.has(t)).slice(0, 2);
      for (const t of [...inByDivision, ...wild]) tally.made[t] += 1;
      tally.division[a[0]] += 1;
      tally.division[b[0]] += 1;
      // The better division winner draws the second wild card.
      const sideA = byRecord(byRecord(a[0], wild[1], BEST_OF_7), byRecord(a[1], a[2], BEST_OF_7), BEST_OF_7);
      const sideB = byRecord(byRecord(b[0], wild[0], BEST_OF_7), byRecord(b[1], b[2], BEST_OF_7), BEST_OF_7);
      return byRecord(sideA, sideB, BEST_OF_7);
    },
    nfl: (_, seeds) => {
      const field = seeds.slice(0, 7);
      seed(field);
      for (const t of field) tally.made[t] += 1;
      for (const t of field.slice(0, 4)) tally.division[t] += 1;
      tally.bye[field[0]] += 1;
      const left = [bySeed(field[1], field[6], AT_HOME), bySeed(field[2], field[5], AT_HOME), bySeed(field[3], field[4], AT_HOME)].sort((x, y) => seedOf[x] - seedOf[y]);
      // The top seed hosts the lowest seed left.
      return bySeed(bySeed(field[0], left[2], AT_HOME), bySeed(left[0], left[1], AT_HOME), AT_HOME);
    },
    mlb: (_, seeds) => {
      const field = seeds.slice(0, 6);
      seed(field);
      for (const t of field) tally.made[t] += 1;
      for (const t of field.slice(0, 3)) tally.division[t] += 1;
      tally.bye[field[0]] += 1;
      tally.bye[field[1]] += 1;
      const threeSix = bySeed(field[2], field[5], BEST_OF_3_HOME);
      const fourFive = bySeed(field[3], field[4], BEST_OF_3_HOME);
      return bySeed(bySeed(field[0], fourFive, BEST_OF_5_MLB), bySeed(field[1], threeSix, BEST_OF_5_MLB), BEST_OF_7_MLB);
    }
  };
  const finalFormat = format === 'nfl' ? NEUTRAL : format === 'mlb' ? BEST_OF_7_MLB : BEST_OF_7;

  /** Plays both conferences and the final from each conference's seeds. */
  return (seedLists: number[][]) => {
    const [first, second] = conferences.map((conf, i) => {
      s.reseed(i + 1);
      return champions[format](conf, seedLists[i]);
    });
    tally.final[first] += 1;
    tally.final[second] += 1;
    s.reseed(3);
    tally.title[byRecord(first, second, finalFormat)] += 1;
  };
}

const share = (counts: Int32Array, i: number, done: number) => (done ? counts[i] / done : 0);

/**
 * Builds a simulator that can run in slices (so a server can yield between
 * them) and report at any point. Each simulation shifts every team's rating
 * by a random amount, plays out the remaining schedule game by game, seeds
 * the playoffs and plays them with the same ratings.
 */
export function createSeasonSimulator(input: SeasonInput, options: SimOptions = {}) {
  const rules = FORMAT_RULES[input.format];
  const total = options.sims ?? 10_000;
  const drift = options.drift ?? rules.drift;
  const otRate = rules.points ? options.otRate ?? 0.23 : 0;
  const seed = options.seed ?? 20_261_023;
  // Each simulation, and each conference's bracket in it, has a stream of its own. With a single stream, one
  // best-of-seven running a game longer would shift the luck of everything after it, so a scenario compared with
  // the plain run would move teams its picks can't touch.
  let stream = mulberry32(seed);
  const rand = () => stream();
  const reseed = (part: number) => {
    stream = mulberry32(Math.imul(seed + done * 4 + part, 0x9e3779b1));
  };
  const { teams } = input;
  const n = teams.length;
  const conferences = structure(input.format, teams);
  const index = new Map(teams.map((t, i) => [t.id, i]));

  // The remaining schedule, plus games against an average opponent (away = -1)
  // for teams whose schedule ESPN hasn't filled in yet.
  const scheduled = teams.map((t) => t.record.wins + t.record.losses + t.record.ties + t.record.otLosses);
  const home: number[] = [];
  const away: number[] = [];
  const diff: number[] = [];
  // Games someone decided: 1 the home team won, -1 the visitor, 0 still open.
  const decided: number[] = [];
  // Games whose stakes are tracked: their position in the schedule and id.
  const tracked: { at: number; id: string }[] = [];
  for (const g of input.games) {
    const h = index.get(g.homeId);
    const a = index.get(g.awayId);
    if (h === undefined || a === undefined) continue;
    if (g.id) tracked.push({ at: home.length, id: g.id });
    home.push(h);
    away.push(a);
    diff.push(g.diff);
    decided.push(g.winner === 'home' ? 1 : g.winner === 'away' ? -1 : 0);
    scheduled[h] += 1;
    scheduled[a] += 1;
  }
  // Per tracked game: sims the home team won, and playoff berths by outcome [home if home won, away if home won, home if away won, away if away won].
  const trackedAt = new Int32Array(home.length + 1).fill(-1);
  tracked.forEach((t, k) => (trackedAt[t.at] = k));
  const homeWins = new Int32Array(tracked.length);
  const berths = new Int32Array(tracked.length * 4);
  const outcome = new Uint8Array(tracked.length);
  const madeBefore = new Int32Array(n);
  // Per team, by final total (wins, or NHL points): runs that ended there, and how many of those made the playoffs.
  const endedAt = teams.map(() => new Map<number, { runs: number; made: number }>());
  const meanRating = teams.reduce((s, t) => s + t.rating, 0) / Math.max(1, n);
  let unscheduled = 0;
  teams.forEach((t, i) => {
    for (let k = scheduled[i]; k < rules.seasonGames; k += 1) {
      home.push(i);
      away.push(-1);
      diff.push(t.rating - meanRating);
      decided.push(0);
      unscheduled += 1;
    }
    scheduled[i] = Math.max(scheduled[i], rules.seasonGames);
  });
  const gHome = Int32Array.from(home);
  const gAway = Int32Array.from(away);
  const gDiff = Float64Array.from(diff);
  const gDecided = Int8Array.from(decided);

  const shift = new Float64Array(n);
  const strength = new Float64Array(n);
  const wins = new Float64Array(n);
  const losses = new Float64Array(n);
  const otl = new Float64Array(n);
  const key = new Float64Array(n);

  const sumWins = new Float64Array(n);
  const sumLosses = new Float64Array(n);
  const sumOtl = new Float64Array(n);
  const winCounts = teams.map((_, i) => new Int32Array(scheduled[i] + 1));
  const tally = newTally(n);
  let done = 0;

  const gaussian = () => Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());
  const ranked = (ids: number[]) => ids.slice().sort((a, b) => key[b] - key[a]);
  const playoffs = bracket(input.format, conferences, n, { rand, reseed, strength, key, homeEdge: input.homeEdge, tally });
  // NFL and MLB seed division winners first; the NBA and NHL seed in standings order.
  const seedsFor = (conf: Conference) => {
    if (input.format !== 'nfl' && input.format !== 'mlb') return ranked(conf.teams);
    const winners = ranked(conf.divisions.map((d) => ranked(d)[0]));
    return [...winners, ...ranked(conf.teams.filter((t) => !winners.includes(t)))];
  };

  function simulateOnce() {
    reseed(0);
    for (let i = 0; i < n; i += 1) {
      shift[i] = drift * gaussian();
      strength[i] = teams[i].rating + shift[i];
      wins[i] = teams[i].record.wins;
      losses[i] = teams[i].record.losses;
      otl[i] = teams[i].record.otLosses;
    }
    for (let g = 0; g < gHome.length; g += 1) {
      const h = gHome[g];
      const a = gAway[g];
      // A game whose stakes are tracked is played at its forecast, without this run's rating shifts: otherwise the
      // runs where a team won it would also be the runs where it was drawn stronger, and its stakes would be overstated.
      const x = trackedAt[g] >= 0 ? gDiff[g] : gDiff[g] + shift[h] - (a >= 0 ? shift[a] : 0);
      // A decided game still takes its draw, so a scenario and the plain run see the same luck everywhere else,
      // and a team its picks don't touch stays where it was instead of jittering from one run to the next.
      const roll = rand();
      const homeWon = gDecided[g] ? gDecided[g] === 1 : roll < 1 / (1 + Math.exp(-x * ELO_SCALE));
      if (trackedAt[g] >= 0) outcome[trackedAt[g]] = homeWon ? 1 : 0;
      const winner = homeWon ? h : a;
      const loser = homeWon ? a : h;
      if (winner >= 0) wins[winner] += 1;
      if (loser >= 0) {
        if (otRate && rand() < otRate) otl[loser] += 1;
        else losses[loser] += 1;
      }
    }
    // Standings: points (NHL) or win percentage, with a random tiebreak.
    for (let i = 0; i < n; i += 1) {
      const ties = teams[i].record.ties;
      const played = wins[i] + losses[i] + otl[i] + ties;
      key[i] = (rules.points ? 2 * wins[i] + otl[i] : played ? (wins[i] + ties / 2) / played : 0.5) + rand() * 1e-7;
      sumWins[i] += wins[i];
      sumLosses[i] += losses[i];
      sumOtl[i] += otl[i];
      winCounts[i][Math.min(wins[i], winCounts[i].length - 1)] += 1;
    }
    madeBefore.set(tally.made);
    playoffs(conferences.map(seedsFor));
    for (let i = 0; i < n; i += 1) {
      const total = rules.points ? 2 * wins[i] + otl[i] : wins[i];
      const at = endedAt[i].get(total) ?? { runs: 0, made: 0 };
      at.runs += 1;
      at.made += tally.made[i] - madeBefore[i];
      endedAt[i].set(total, at);
    }
    // Who made the playoffs this time, split by how each tracked game went.
    for (let k = 0; k < tracked.length; k += 1) {
      const at = tracked[k].at;
      const h = gHome[at];
      const a = gAway[at];
      const homeMade = tally.made[h] - madeBefore[h];
      const awayMade = tally.made[a] - madeBefore[a];
      const base = k * 4 + (outcome[k] ? 0 : 2);
      if (outcome[k]) homeWins[k] += 1;
      berths[base] += homeMade;
      berths[base + 1] += awayMade;
    }
    done += 1;
  }

  function percentile(counts: Int32Array, q: number) {
    let seen = 0;
    for (let w = 0; w < counts.length; w += 1) {
      seen += counts[w];
      if (seen >= q * done) return w;
    }
    return counts.length - 1;
  }

  return {
    total,
    get done() {
      return done;
    },
    run(count: number) {
      for (let k = 0; k < count && done < total; k += 1) simulateOnce();
    },
    result(): SeasonOutlook {
      return {
        sims: done,
        drift,
        unscheduled,
        teams: teams.map((t, i) => {
          const avgOtl = done ? sumOtl[i] / done : 0;
          const avgWins = done ? sumWins[i] / done : 0;
          return {
            id: t.id,
            conference: t.conference,
            division: t.division,
            current: t.record,
            games: scheduled[i],
            wins: avgWins,
            losses: done ? sumLosses[i] / done : 0,
            ties: t.record.ties,
            otLosses: avgOtl,
            points: rules.points ? 2 * avgWins + avgOtl : null,
            winsLow: percentile(winCounts[i], 0.1),
            winsHigh: percentile(winCounts[i], 0.9),
            playoffs: share(tally.made, i, done),
            playIn: input.format === 'nba' ? share(tally.playIn, i, done) : null,
            divisionTitle: input.format === 'nba' ? null : share(tally.division, i, done),
            bye: input.format === 'nfl' || input.format === 'mlb' ? share(tally.bye, i, done) : null,
            final: share(tally.final, i, done),
            title: share(tally.title, i, done),
            cutoff:
              [...endedAt[i]]
                .filter(([, at]) => at.runs >= CUTOFF_MIN_RUNS && at.made / at.runs >= 0.5)
                .map(([total]) => total)
                .sort((a, b) => a - b)[0] ?? null
          };
        }),
        stakes: Object.fromEntries(
          tracked.flatMap((t, k) => {
            const won = homeWins[k];
            const lost = done - won;
            if (!won || !lost) return [];
            const stakes: GameStakes = {
              home: { ifWin: berths[k * 4] / won, ifLoss: berths[k * 4 + 2] / lost },
              away: { ifWin: berths[k * 4 + 3] / lost, ifLoss: berths[k * 4 + 1] / won }
            };
            return [[t.id, stakes]];
          })
        )
      };
    }
  };
}

export type Simulator<T> = { total: number; readonly done: number; run(count: number): void; result(): T };

export function runAll<T>(simulator: Simulator<T>) {
  simulator.run(simulator.total);
  return simulator.result();
}

/** Runs in slices, yielding to the event loop between them so requests aren't held up. */
export async function runInBackground<T>(simulator: Simulator<T>, slice = 250) {
  while (simulator.done < simulator.total) {
    simulator.run(slice);
    await new Promise((resolve) => setImmediate(resolve));
  }
  return simulator.result();
}

export const simulateSeason = (input: SeasonInput, options: SimOptions = {}) => runAll(createSeasonSimulator(input, options));
export const simulateSeasonInBackground = (input: SeasonInput, options: SimOptions = {}) => runInBackground(createSeasonSimulator(input, options));
