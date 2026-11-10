/**
 * Playoff odds from the current bracket. ESPN's official seeds fix the
 * bracket, results already in stand, and every series still going is played
 * on from its current score. A game on the schedule uses the app's forecast at
 * its real home team (the line when one is posted, otherwise the pre-line
 * forecast); a game not scheduled yet uses ratings and the format's home-field
 * pattern. Games are independent at those odds, so each series' chance is
 * worked out exactly and a simulation only draws who wins each series.
 */
import { winProbability } from './elo';
import { AT_HOME, BEST_OF_3_HOME, BEST_OF_5_MLB, BEST_OF_7, BEST_OF_7_MLB, FORMAT_RULES, mulberry32, NEUTRAL, PlayoffFormat, runAll, runInBackground } from './season';

export type BracketStage = 'play-in' | 'playoffs';

type Round = { name: string; short: string; games: number[] };

/** Each league's rounds in order, with the home-field pattern of a series in that round. */
export const ROUNDS: Record<PlayoffFormat, Round[]> = {
  nfl: [
    { name: 'Wild Card round', short: 'Wild Card', games: AT_HOME },
    { name: 'Divisional round', short: 'Divisional', games: AT_HOME },
    { name: 'Conference Championship', short: 'Conference', games: AT_HOME },
    { name: 'Super Bowl', short: 'Super Bowl', games: NEUTRAL }
  ],
  nba: [
    { name: 'Play-In', short: 'Play-in', games: AT_HOME },
    { name: 'First Round', short: 'Round 1', games: BEST_OF_7 },
    { name: 'Conference Semifinals', short: 'Semis', games: BEST_OF_7 },
    { name: 'Conference Finals', short: 'Conf. Finals', games: BEST_OF_7 },
    { name: 'NBA Finals', short: 'Finals', games: BEST_OF_7 }
  ],
  mlb: [
    { name: 'Wild Card Series', short: 'Wild Card', games: BEST_OF_3_HOME },
    { name: 'Division Series', short: 'DS', games: BEST_OF_5_MLB },
    { name: 'League Championship Series', short: 'LCS', games: BEST_OF_7_MLB },
    { name: 'World Series', short: 'World Series', games: BEST_OF_7_MLB }
  ],
  nhl: [
    { name: 'First Round', short: 'Round 1', games: BEST_OF_7 },
    { name: 'Second Round', short: 'Round 2', games: BEST_OF_7 },
    { name: 'Conference Final', short: 'Conf. Final', games: BEST_OF_7 },
    { name: 'Stanley Cup Final', short: 'Cup Final', games: BEST_OF_7 }
  ]
};

export type BracketTeam = {
  id: string;
  conference: string;
  division: string;
  /** Official conference seed (NBA: 7-10 are the play-in teams). */
  seed: number;
  /** Regular-season standing, higher is better (win share; points in the NHL), for home field in the final. */
  standing: number;
  /** Pre-line rating (Elo scale), for games not on the schedule yet. */
  rating: number;
};

export type BracketGame = {
  homeId: string;
  awayId: string;
  /** Play-in games are kept apart: the same two teams could meet again in the playoffs. */
  stage: BracketStage;
  /** Winner of a finished game; null while it's still to play. */
  winnerId: string | null;
  /** The forecast's home win probability for a game still to play; null to use ratings and home field. */
  homeProb: number | null;
  /** Under way, so `homeProb` is the live win probability. */
  live?: boolean;
  neutral: boolean;
};

export type BracketInput = {
  format: PlayoffFormat;
  /** The playoff field: every seeded team (NBA: 1-10). */
  teams: BracketTeam[];
  /** Postseason games played and scheduled, oldest first. */
  games: BracketGame[];
  /** Home edge in Elo for games not on the schedule. */
  homeEdge: number;
};

export type BracketTeamOutlook = {
  id: string;
  conference: string;
  seed: number;
  /** The deepest round results have already put the team in (a bye counts); the round count once it's champion. */
  reached: number;
  /** Round the team was knocked out in; null while it's alive. */
  out: number | null;
  /** Share of simulations the team was still alive at the start of each round. */
  reach: number[];
  title: number;
};

export type SeriesOutlook = {
  round: number;
  /** Null in the championship round. */
  conference: string | null;
  /** The team with home field first. */
  teams: [string, string];
  wins: [number, number];
  /** Games in the series (best of). */
  length: number;
  winner: string | null;
  /** Share of simulations the first team won the series (1 or 0 once it's settled). */
  odds: number;
  /** The next game to play: its number in the series, the host (null at a neutral site), the first team's chance, and whether it's under way. */
  next: { game: number; homeId: string | null; prob: number; live: boolean } | null;
};

export type BracketOutlook = {
  sims: number;
  rounds: { name: string; short: string }[];
  /** The earliest round with a matchup still to settle (the round count once there's a champion). */
  current: number;
  champion: string | null;
  teams: BracketTeamOutlook[];
  /** Every matchup whose two teams are known, earliest round first. */
  series: SeriesOutlook[];
};

/**
 * Chance the first team wins a series it leads `wins`-`losses`, where game g
 * (counting from the series opener) goes its way with probability `gameProb(g)`.
 */
export function seriesWinProbability(length: number, wins: number, losses: number, gameProb: (game: number) => number): number {
  const need = (length + 1) / 2;
  if (wins >= need) return 1;
  if (losses >= need) return 0;
  const p = gameProb(wins + losses);
  return p * seriesWinProbability(length, wins + 1, losses, gameProb) + (1 - p) * seriesWinProbability(length, wins, losses + 1, gameProb);
}

type Slot = number | null;
/** Plays a matchup and returns the winner; null when a team or the result isn't known (resolving what results settle). */
type Play = (a: Slot, b: Slot, round: number, eliminates?: boolean) => Slot;
type Conference = { name: string; seeds: number[]; divisions: number[][] };

/** Each conference's bracket from its seeds (best first) to its champion. */
const SHAPES: Record<PlayoffFormat, (conf: Conference, play: Play, seed: (team: number) => number) => Slot> = {
  nba: ({ seeds: s }, play) => {
    // Play-in: 7 hosts 8 (its loser gets a second chance), 9 hosts 10, then the 7/8 loser hosts the 9/10 winner.
    const seven = play(s[6], s[7], 0, false);
    const eight = play(seven === null ? null : seven === s[6] ? s[7] : s[6], play(s[8], s[9], 0), 0);
    const top = play(play(s[0], eight, 1), play(s[3], s[4], 1), 2);
    const bottom = play(play(s[1], seven, 1), play(s[2], s[5], 1), 2);
    return play(top, bottom, 3);
  },
  nhl: ({ seeds: s, divisions }, play) => {
    // Top three in each division, then two wild cards; seeds run in standings order.
    const tops = divisions.map((d) => s.filter((t) => d.includes(t)).slice(0, 3));
    const [a, b] = s.indexOf(tops[0][0]) <= s.indexOf(tops[1][0]) ? tops : [tops[1], tops[0]];
    const wild = s.filter((t) => !a.includes(t) && !b.includes(t));
    // The better division winner draws the second wild card.
    const sideA = play(play(a[0], wild[1], 0), play(a[1], a[2], 0), 1);
    const sideB = play(play(b[0], wild[0], 0), play(b[1], b[2], 0), 1);
    return play(sideA, sideB, 2);
  },
  nfl: ({ seeds: s }, play, seed) => {
    const wildCard = [play(s[1], s[6], 0), play(s[2], s[5], 0), play(s[3], s[4], 0)];
    // The top seed hosts the lowest seed left, so neither pairing is known until all three games are.
    const left = wildCard.some((t) => t === null) ? [null, null, null] : (wildCard as number[]).sort((x, y) => seed(x) - seed(y));
    return play(play(s[0], left[2], 1), play(left[0], left[1], 1), 2);
  },
  mlb: ({ seeds: s }, play) => play(play(s[0], play(s[3], s[4], 0), 1), play(s[1], play(s[2], s[5], 0), 1), 2)
};

function conferencesOf(format: PlayoffFormat, teams: BracketTeam[]): Conference[] {
  const label = format.toUpperCase();
  const names = [...new Set(teams.map((t) => t.conference))];
  if (names.length !== 2) throw new Error(`Expected two ${label} conferences in the playoff field`);
  return names.map((name) => {
    const seeds = teams
      .map((_, i) => i)
      .filter((i) => teams[i].conference === name)
      .sort((a, b) => teams[a].seed - teams[b].seed);
    if (seeds.length !== FORMAT_RULES[format].field || seeds.some((t, k) => teams[t].seed !== k + 1)) {
      throw new Error(`Incomplete ${label} playoff seeds for ${name}`);
    }
    const divisions = [...new Set(seeds.map((t) => teams[t].division))].map((d) => seeds.filter((t) => teams[t].division === d));
    if (format === 'nhl' && (divisions.length !== 2 || divisions.some((d) => d.length < 3))) throw new Error(`The ${name} field doesn't fit the NHL's divisional bracket`);
    return { name, seeds, divisions };
  });
}

type Matchup = {
  round: number;
  /** Has home field. */
  better: number;
  other: number;
  won: number;
  lost: number;
  winner: Slot;
  /** Chance `better` wins the series. */
  odds: number;
  next: SeriesOutlook['next'];
};

/**
 * Builds a simulator that can run in slices and report at any point. Throws if
 * the seeds don't make a full field, or if games already on the schedule don't
 * fit the bracket the seeds imply.
 */
export function createBracketSimulator(input: BracketInput, options: { sims?: number; seed?: number } = {}) {
  const { format, teams, homeEdge } = input;
  const rounds = ROUNDS[format];
  const last = rounds.length - 1;
  const total = options.sims ?? 20_000;
  const rand = mulberry32(options.seed ?? 20_261_023);
  const n = teams.length;
  const index = new Map(teams.map((t, i) => [t.id, i]));
  const conferences = conferencesOf(format, teams);
  const seedOf = (t: number) => teams[t].seed;

  // A pair of teams meets at most once per stage.
  const pairKey = (stage: BracketStage, a: number, b: number) => `${stage}:${Math.min(a, b)}:${Math.max(a, b)}`;
  const stageOf = (round: number): BracketStage => (format === 'nba' && round === 0 ? 'play-in' : 'playoffs');
  const byPair = new Map<string, BracketGame[]>();
  for (const g of input.games) {
    const home = index.get(g.homeId);
    const away = index.get(g.awayId);
    if (home === undefined || away === undefined) throw new Error(`A ${format.toUpperCase()} postseason game involves a team outside the seeded field`);
    const key = pairKey(g.stage, home, away);
    byPair.set(key, [...(byPair.get(key) ?? []), g]);
  }

  // Home field goes to the higher seed, or between conferences to the better regular-season record.
  const betterOf = (a: number, b: number) => {
    const [x, y] = [teams[a], teams[b]];
    if (x.conference !== y.conference && x.standing !== y.standing) return x.standing > y.standing ? a : b;
    return x.seed !== y.seed ? (x.seed < y.seed ? a : b) : Math.min(a, b);
  };

  const matchups = new Map<string, Matchup>();
  const matchup = (a: number, b: number, round: number): Matchup => {
    const key = `${round}:${Math.min(a, b)}:${Math.max(a, b)}`;
    const memo = matchups.get(key);
    if (memo) return memo;
    const pattern = rounds[round].games;
    const games = byPair.get(pairKey(stageOf(round), a, b)) ?? [];
    // Whoever hosts the opener on ESPN's schedule has home field.
    const better = games.length ? index.get(games[0].homeId)! : betterOf(a, b);
    const other = better === a ? b : a;
    const finished = games.filter((g) => g.winnerId !== null);
    const upcoming = games.filter((g) => g.winnerId === null);
    const won = finished.filter((g) => g.winnerId === teams[better].id).length;
    const lost = finished.length - won;
    if (finished.length > pattern.length) throw new Error(`More games than a ${rounds[round].name} series allows`);
    const need = (pattern.length + 1) / 2;
    const host = (g: number) => (pattern[g] === 0 ? null : pattern[g] > 0 ? better : other);
    const gameProb = (g: number) => {
      const scheduled = upcoming[g - won - lost];
      if (scheduled) {
        const home = index.get(scheduled.homeId)!;
        const away = index.get(scheduled.awayId)!;
        const homeProb = scheduled.homeProb ?? winProbability(teams[home].rating - teams[away].rating + (scheduled.neutral ? 0 : homeEdge));
        return home === better ? homeProb : 1 - homeProb;
      }
      return winProbability(teams[better].rating - teams[other].rating + pattern[g] * homeEdge);
    };
    const winner = won >= need ? better : lost >= need ? other : null;
    const g = won + lost;
    const scheduled = upcoming[0] as BracketGame | undefined;
    const nextHost = scheduled ? (scheduled.neutral ? null : index.get(scheduled.homeId)!) : host(g);
    const result: Matchup = {
      round,
      better,
      other,
      won,
      lost,
      winner,
      odds: seriesWinProbability(pattern.length, won, lost, gameProb),
      next: winner === null ? { game: g + 1, homeId: nextHost === null ? null : teams[nextHost].id, prob: gameProb(g), live: Boolean(scheduled?.live) } : null
    };
    matchups.set(key, result);
    return result;
  };

  const playAll = (play: Play) => {
    const [first, second] = conferences.map((conf) => SHAPES[format](conf, play, seedOf));
    return play(first, second, last);
  };

  // What the results already settle: who's alive in which round, who's out, and every matchup both of whose teams are known.
  const reached = new Int32Array(n);
  const out = new Int32Array(n).fill(-1);
  const known: Matchup[] = [];
  const champion = playAll((a, b, round, eliminates = true) => {
    for (const t of [a, b]) if (t !== null) reached[t] = Math.max(reached[t], round);
    if (a === null || b === null) return null;
    const m = matchup(a, b, round);
    known.push(m);
    if (m.winner !== null && eliminates) out[m.winner === m.better ? m.other : m.better] = round;
    return m.winner;
  });
  if (champion !== null) reached[champion] = rounds.length;
  const isKnown = new Set(known);

  const deepest = new Int32Array(n);
  const reach = rounds.map(() => new Int32Array(n));
  const title = new Int32Array(n);
  const betterWins = new Map<Matchup, number>();
  const visits = new Map<string, number>();
  let done = 0;

  const simulate: Play = (a, b, round) => {
    const m = matchup(a!, b!, round);
    const key = pairKey(stageOf(round), a!, b!);
    if (byPair.has(key)) visits.set(key, (visits.get(key) ?? 0) + 1);
    deepest[a!] = Math.max(deepest[a!], round);
    deepest[b!] = Math.max(deepest[b!], round);
    const winner = m.winner ?? (rand() < m.odds ? m.better : m.other);
    if (isKnown.has(m) && winner === m.better) betterWins.set(m, (betterWins.get(m) ?? 0) + 1);
    return winner;
  };

  function simulateOnce() {
    deepest.fill(0);
    const winner = playAll(simulate)!;
    for (let i = 0; i < n; i += 1) for (let r = 0; r <= deepest[i]; r += 1) reach[r][i] += 1;
    title[winner] += 1;
    done += 1;
  }

  return {
    total,
    get done() {
      return done;
    },
    run(count: number) {
      for (let k = 0; k < count && done < total; k += 1) simulateOnce();
    },
    result(): BracketOutlook {
      // A matchup with games on the schedule is real, so it has to come up in every simulation.
      if (done && [...byPair.keys()].some((key) => visits.get(key) !== done)) {
        throw new Error(`${format.toUpperCase()} postseason games don't fit the bracket the seeds imply`);
      }
      const share = (count: number) => (done ? count / done : 0);
      const open = known.filter((m) => m.winner === null).map((m) => m.round);
      return {
        sims: done,
        rounds: rounds.map(({ name, short }) => ({ name, short })),
        current: open.length ? Math.min(...open) : champion !== null ? rounds.length : 0,
        champion: champion === null ? null : teams[champion].id,
        teams: teams.map((t, i) => ({
          id: t.id,
          conference: t.conference,
          seed: t.seed,
          reached: reached[i],
          out: out[i] >= 0 ? out[i] : null,
          reach: reach.map((counts) => share(counts[i])),
          title: share(title[i])
        })),
        series: [...known]
          .sort((x, y) => x.round - y.round)
          .map((m) => ({
            round: m.round,
            conference: m.round === last ? null : teams[m.better].conference,
            teams: [teams[m.better].id, teams[m.other].id],
            wins: [m.won, m.lost],
            length: rounds[m.round].games.length,
            winner: m.winner === null ? null : teams[m.winner].id,
            odds: m.winner !== null ? Number(m.winner === m.better) : share(betterWins.get(m) ?? 0),
            next: m.next
          }))
      };
    }
  };
}

export const simulateBracket = (input: BracketInput, options: { sims?: number; seed?: number } = {}) => runAll(createBracketSimulator(input, options));
export const simulateBracketInBackground = (input: BracketInput, options: { sims?: number; seed?: number } = {}) =>
  runInBackground(createBracketSimulator(input, options));
