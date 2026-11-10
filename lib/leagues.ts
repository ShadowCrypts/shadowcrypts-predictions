import type { LineupParams } from './model/lineups';
import type { MarketRatingParams } from './model/marketRatings';
import type { NbaPlayerParams } from './model/nbaPlayers';
import type { NflPlayerParams } from './model/nflPlayers';
import type { NhlPlayerParams } from './model/nhlPlayers';
import type { PropModelParams } from './model/propModel';
import type { QbParams } from './model/quarterbacks';
import type { ScoringParams } from './model/scoring';
import type { StarterParams } from './model/starters';

export type LeagueId = 'nfl' | 'nba' | 'mlb' | 'nhl';

export type MovModel = 'nfl' | 'nba' | 'nhl' | 'mlb';

export type EloParams = {
  /** Base update size per game. */
  k: number;
  /** Home-field advantage in Elo points (zeroed at neutral sites). */
  hfa: number;
  /** Fraction of each team's distance from 1500 removed between seasons. */
  regress: number;
  /** Margin-of-victory multiplier family. */
  mov: MovModel;
  /** Elo penalty for playing the second game of a back-to-back. */
  backToBack: number;
  /** Elo points per point of spread, for converting ratings into a line. */
  eloPerPoint: number | null;
  /** Starting pitcher (MLB) / goalie (NHL) ratings; null where starters aren't published. */
  starter: StarterParams | null;
  /**
   * Elo penalty per time zone a team crossed heading east to reach the game
   * (body-clock lag). Only the NBA held up on later seasons; other leagues,
   * and rest days, 3-in-4 nights, road-trip length and travel distance, didn't.
   */
  eastZones?: number;
};

export type LeagueConfig = {
  id: LeagueId;
  name: string;
  fullName: string;
  espnPath: string;
  /** Calendar months (1-12) that can contain regular or postseason games. */
  activeMonths: number[];
  /** Month the season starts; used to work out which season is current. */
  seasonStartMonth: number;
  /** ESPN labels NBA/NHL seasons by the year they end (2026-27 => 2027). */
  seasonYearIsEndYear: boolean;
  /** Full seasons replayed before the current one. The oldest is burn-in only. */
  historySeasons: number;
  /** How far ahead the slate looks. */
  upcomingDays: number;
  scoreUnit: string;
  elo: EloParams;
  /**
   * The rating model's weight when blended with the betting market (in logit
   * space). Fitted on the first graded season by log loss: the market already
   * carries everything the rating model knows in the NBA, MLB and NHL, so the
   * best weight there is 0 and the forecast follows the market whenever a line
   * is posted. Games without a line use the pre-line forecast below.
   */
  modelShare: number;
  /**
   * Market-implied ratings: team strength as past closing lines priced it,
   * blended with the Elo ratings for games whose line isn't posted yet.
   */
  preLine: MarketRatingParams;
  /**
   * Who's playing, from box scores and the injury report (NBA only). Each
   * game is adjusted by how its available lineup compares with the team's
   * recent ones, in both rating replays.
   */
  lineups?: LineupParams;
  /**
   * Starting quarterbacks (NFL only), rated from box scores. Each game is
   * adjusted by how its starter compares with the team's recent starters, in
   * both rating replays; upcoming games read the depth chart and injury report.
   */
  quarterbacks?: QbParams;
  /**
   * Player stat projections, graded against sportsbook props
   * (`npm run backtest -- --props`). NBA: minutes from the lineup model and
   * production per minute from box scores.
   */
  players?: NbaPlayerParams;
  /** NHL skaters' points, goals, assists and shots, and goalies' saves. */
  nhlPlayers?: NhlPlayerParams;
  /** NFL passing, rushing and receiving from each player's share of his team's plays. */
  nflPlayers?: NflPlayerParams;
  /**
   * Projected scores: team offense and defense ratings for the total when no
   * over/under is posted, and the margin from the forecast when no spread is.
   * Tuned on the first graded season by total error (`npm run backtest -- --scores`).
   */
  scoring: ScoringParams;
};

// Margin-of-victory formulas follow FiveThirtyEight's published Elo models.
// K, home field, rest, travel, regression, starter and pre-line settings were tuned on
// the first graded season only and checked on the later ones (`npm run backtest -- --grid`).
export const LEAGUES: Record<LeagueId, LeagueConfig> = {
  nfl: {
    id: 'nfl',
    name: 'NFL',
    fullName: 'National Football League',
    espnPath: 'football/nfl',
    activeMonths: [9, 10, 11, 12, 1, 2],
    seasonStartMonth: 9,
    seasonYearIsEndYear: false,
    historySeasons: 3,
    upcomingDays: 8,
    scoreUnit: 'pts',
    elo: { k: 25, hfa: 36, regress: 1 / 3, mov: 'nfl', backToBack: 0, eloPerPoint: 25, starter: null },
    modelShare: 0.075,
    preLine: { lineStep: 0.3, resultK: 12.5, regress: 0.25, hfaStep: 0.01, starters: 'model', starterStep: 0, ratingsShare: 0.75 },
    // Fitted on 2024 by how closely the pre-line forecast matched that season's closing lines, which
    // already price who starts and are far less noisy than 285 results. Ratings keep about two seasons
    // of memory, and the prior is capped there: past it the fit improves by under 0.0003 as the
    // prior and the Elo scale grow together.
    quarterbacks: { decay: 0.98, priorPlays: 1200, priorRating: -2.5, rushWeight: 1, baselineAlpha: 0.05, eloPerYard: 120 },
    // Tuned on 2024 by average miss; graded against ESPN BET's 2024-25 lines (DraftKings keeps no
    // prices on finished NFL props). Next to the book the model earned a 10% weight.
    nflPlayers: {
      decay: 0.85,
      priorTargets: 10,
      priorCarries: 10,
      priorAttempts: 300,
      teamShare: 0.5,
      volumeAlpha: 0.06,
      // Fantasy: barely matters (15 to 60 moved the average miss by 0.003 on 2025).
      priorTouches: 30,
      modelShare: 0.1,
      dispersion: {
        pass_yds: [48.314, 0],
        pass_cmp: [3.1, 0],
        pass_att: [3.12, 0],
        pass_td: [1, 0.3148],
        pass_int: [1.967, 0],
        pass_rush_yds: [44.508, 0],
        rush_yds: [18.498, 0.0117],
        rush_att: [2.704, 0],
        rec_yds: [21.835, 0],
        rec: [1.334, 0],
        rush_rec_yds: [22.693, 0]
      },
      // Chances at other lines read off the main line: the book's line pins the mean better than the
      // model does, so outcomes spread less around it (fitted on 17k graded lines, `--alt-lines`).
      lineSpread: {
        pass_yds: 0.4,
        rush_yds: 0.9,
        rec_yds: 1,
        rush_att: 0.6,
        rec: 0.9,
        pass_cmp: 0.5,
        pass_td: 0.2,
        pass_att: 0.6,
        pass_rush_yds: 0.5,
        rush_rec_yds: 0.9,
        pass_int: 0.2
      },
      // Live chances, fitted on 16.7k graded lines rebuilt quarter by quarter from play-by-play
      // (`--live-props`). Game script carries it: per touchdown behind (up to two), what's left leans
      // 6% toward throwing and catching after Q1, 10% at halftime and 20% after Q3, and away from
      // running; leading does the opposite. A lead past 17 cuts what's left once starters sit.
      live: {
        checkpoints: [0.25, 0.5, 0.75],
        pace: [1, 1, 1.1],
        carry: [0, 0.05, 0],
        spread: [1, 1, 1],
        blowout: [0, 0.2, 0.2],
        blowoutFrom: 17,
        blowoutPer: 7,
        script: [0.06, 0.1, 0.2]
      }
    },
    // Margin per logit from 2024 posted spreads: fitted on results it was 9.5, which did worse on later seasons.
    scoring: { k: 0.03, regress: 0.25, leagueStep: 0.003, venueK: 0, marginPerLogit: 7.1 }
  },
  nba: {
    id: 'nba',
    name: 'NBA',
    fullName: 'National Basketball Association',
    espnPath: 'basketball/nba',
    activeMonths: [10, 11, 12, 1, 2, 3, 4, 5, 6],
    seasonStartMonth: 10,
    seasonYearIsEndYear: true,
    historySeasons: 3,
    upcomingDays: 4,
    scoreUnit: 'pts',
    elo: { k: 20, hfa: 36, regress: 0.4, mov: 'nba', backToBack: 40, eloPerPoint: 28, starter: null, eastZones: 12 },
    modelShare: 0,
    preLine: { lineStep: 0.2, resultK: 10, regress: 0.25, hfaStep: 0, starters: 'model', starterStep: 0, ratingsShare: 0.1 },
    lineups: { decay: 0.99, priorMinutes: 700, pmWeight: 0.45, shareAlpha: 0.25, baselineAlpha: 0.04, eloPerPoint: 45 },
    scoring: { k: 0.04, regress: 0.6, leagueStep: 0.001, venueK: 0, marginPerLogit: 7.6 },
    // Tuned on 2024-25 by average miss. A 5-minute prior scored best by a hair; 15 keeps a player's
    // first few games from swinging his projection. Next to the sportsbook's line the model earned a
    // 10% weight on 2024-25 and added nothing on later seasons, so prop forecasts follow the book.
    players: {
      decay: 0.96,
      priorMinutes: 15,
      teamShare: 0.75,
      paceShare: 0.5,
      modelShare: 0.1,
      dispersion: {
        pts: [3.972, 0],
        reb: [1.525, 0.0012],
        ast: [1.239, 0.0118],
        pra: [4.347, 0],
        pr: [4.214, 0],
        pa: [3.948, 0],
        ar: [1.727, 0],
        stl: [1.347, 0],
        blk: [1.125, 0.0196],
        tov: [1.231, 0]
      },
      // Spread around the book's line for chances at other lines (fitted on 108k graded lines, `--alt-lines`).
      lineSpread: { pts: 0.8, ast: 0.9, reb: 0.8, stl: 0.9, blk: 0.9, tov: 0.2, pa: 0.7, pr: 0.7, ar: 0.8, pra: 0.7 },
      // Live chances, fitted on 101k graded lines rebuilt quarter by quarter from play-by-play
      // (`--live-props`). The rest of the game runs near the pregame pace, a hot start carries a
      // little, and a lead past 12 cuts what's left late, when starters sit.
      live: {
        checkpoints: [0.25, 0.5, 0.75],
        pace: [0.95, 1, 0.95],
        carry: [0, 0.1, 0.1],
        spread: [1, 1, 1.2],
        blowout: [0.05, 0.1, 0.3],
        blowoutFrom: 12,
        blowoutPer: 10
      }
    }
  },
  mlb: {
    id: 'mlb',
    name: 'MLB',
    fullName: 'Major League Baseball',
    espnPath: 'baseball/mlb',
    activeMonths: [3, 4, 5, 6, 7, 8, 9, 10, 11],
    seasonStartMonth: 3,
    seasonYearIsEndYear: false,
    historySeasons: 3,
    upcomingDays: 4,
    scoreUnit: 'runs',
    elo: { k: 3, hfa: 18, regress: 0.25, mov: 'mlb', backToBack: 0, eloPerPoint: null, starter: { eloPerUnit: 20, shrink: 6, decay: 0.9 } },
    modelShare: 0,
    preLine: { lineStep: 0.1, resultK: 1.5, regress: 0.25, hfaStep: 0, starters: 'market', starterStep: 0.2, ratingsShare: 0.15 },
    // Ballparks matter here; starting pitchers aren't in the totals model, which is why it trails the posted total.
    scoring: { k: 0.01, regress: 0.8, leagueStep: 0.01, venueK: 0.02, marginPerLogit: 2.2 }
  },
  nhl: {
    id: 'nhl',
    name: 'NHL',
    fullName: 'National Hockey League',
    espnPath: 'hockey/nhl',
    // The 2026-27 season (84 games) opened on Sept 29.
    activeMonths: [9, 10, 11, 12, 1, 2, 3, 4, 5, 6],
    seasonStartMonth: 9,
    seasonYearIsEndYear: true,
    historySeasons: 3,
    upcomingDays: 4,
    scoreUnit: 'goals',
    elo: { k: 6, hfa: 35, regress: 0.25, mov: 'nhl', backToBack: 30, eloPerPoint: null, starter: { eloPerUnit: 40, shrink: 6, decay: 0.98 } },
    modelShare: 0,
    preLine: { lineStep: 0.1, resultK: 0, regress: 0.25, hfaStep: 0, starters: 'market', starterStep: 0.2, ratingsShare: 0.2 },
    // Team scoring ratings didn't beat the league average on goals (best k was 0), so totals are the average.
    scoring: { k: 0, regress: 0.25, leagueStep: 0.003, venueK: 0.002, marginPerLogit: 1.4 },
    // Tuned on 2024-25 by average miss. A goalie's own save percentage didn't help (the best prior
    // pulls everyone to league average), so saves follow the shots he's expected to face. Next to the
    // sportsbook the model earned a 40% weight on 2024-25 and kept a small gain on later seasons.
    nhlPlayers: {
      decay: 0.99,
      priorToi: 60,
      toiAlpha: 0.35,
      teamShare: 1,
      shotShare: 1,
      priorShots: 20000,
      modelShare: 0.4,
      dispersion: { pts: [1.134, 0], goals: [1.172, 0], ast: [1.094, 0], sog: [1.109, 0], blk: [1.13, 0], saves: [1, 0.0831] },
      // Spread around the book's line for chances at other lines (fitted on 153k graded lines, `--alt-lines`);
      // anything under 1 on these near-Poisson counts just means Poisson.
      lineSpread: { pts: 0.9, ast: 0.2, goals: 0.2, saves: 0.5, blk: 0.9, sog: 1 },
      // Live chances, fitted on 153k graded lines rebuilt period by period (`--live-props`): little
      // beyond scaling by the time left.
      live: {
        checkpoints: [1 / 3, 2 / 3],
        pace: [1, 1.05],
        carry: [0, 0],
        spread: [1, 1],
        blowout: [0.05, 0.05],
        blowoutFrom: 2,
        blowoutPer: 1
      }
    }
  }
};

export const LEAGUE_IDS: LeagueId[] = ['nfl', 'nba', 'mlb', 'nhl'];

export function isLeagueId(value: string): value is LeagueId {
  return (LEAGUE_IDS as string[]).includes(value);
}

/** A league's player-prop settings (spread of outcomes, live chances), for the browser as well as the server. */
export function propParams(id: string): PropModelParams | null {
  if (!isLeagueId(id)) return null;
  const league = LEAGUES[id];
  return league.players ?? league.nhlPlayers ?? league.nflPlayers ?? null;
}

export function seasonLabel(league: LeagueConfig, seasonYear: number) {
  if (!league.seasonYearIsEndYear) return String(seasonYear);
  return `${seasonYear - 1}-${String(seasonYear).slice(-2)}`;
}

/** The calendar year/month the current season began in. */
export function currentSeasonStart(league: LeagueConfig, now: Date) {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() + 1;
  return month >= league.seasonStartMonth
    ? { year, month: league.seasonStartMonth }
    : { year: year - 1, month: league.seasonStartMonth };
}

/** Every YYYYMM month that needs loading, oldest first. */
export function monthsToLoad(league: LeagueConfig, now: Date): string[] {
  const start = currentSeasonStart(league, now);
  const end = new Date(now.getTime() + league.upcomingDays * 86_400_000);
  const months: string[] = [];
  let y = start.year - league.historySeasons;
  let m = start.month;
  while (y < end.getUTCFullYear() || (y === end.getUTCFullYear() && m <= end.getUTCMonth() + 1)) {
    if (league.activeMonths.includes(m)) months.push(`${y}${String(m).padStart(2, '0')}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return months;
}
