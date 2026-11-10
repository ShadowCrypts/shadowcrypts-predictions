import { BoxScore, getBoxScores, getNflSkillBoxes, getQbDepthChart, getTeamRoster, NflSkillBox, RosterEntry } from '../boxscores';
import { cached } from '../cache';
import {
  Game,
  getClosingOdds,
  getInjuries,
  getLeagueGames,
  getTeams,
  getTeamSeasonLeaders,
  InjuryEntry,
  MarketOdds,
  SeasonLeader,
  TeamInfo
} from '../espn';
import { EloParams, LEAGUES, LeagueConfig, LeagueId, seasonLabel } from '../leagues';
import { etDateKey } from '../time';
import { InjuryImpact, injuryImpacts } from './adjustments';
import { MEAN_RATING, PregameContext, RatingPoint, replay, winProbability } from './elo';
import { Ledger, LedgerEntry, readLedger, writeLedger } from './ledger';
import { recordMovement } from './movement';
import { describeLineup, GameLineups, lineupPass } from './lineups';
import { blendProbability, MarketView, marketView } from './market';
import { marketRatings } from './marketRatings';
import { Band, bandFor, BandRecord, byBand, calibration, CalibrationBucket, Metrics, Outcome, summarize } from './metrics';
import { espnHeadToHead, EspnLedger, EspnRecord, recordEspnForecasts } from './espnLedger';
import { recordFantasyBoard } from './fantasyLedger';
import { noteHistory } from './history';
import { describeQb, GameQbs, qbChange, qbInjuryImpacts, qbPass } from './quarterbacks';
import { getPropHistory, getUpcomingProps } from '../propFeed';
import { hasPropModel, isPriced, mainLines, PropLine, PropMarket } from '../props';
import { PropInputs, propEngine } from './propEngines';
import { PropBoard, propBoard, PropCell } from './propBoard';
import { gradeClv, gradePropLedger, LivePropRecord, PropLedger, propLedgerKey, readPropLedger, withFirst, writePropLedger } from './propLedger';
import { Actuals, GameProjection, gradedLines, gradeProps, PropRecord } from './propModel';
import { ProjectedScore, projectScore, scoringPass } from './scoring';
import { combineAdjustments, EastwardTrip, eastwardTrips, travelAdjustments } from './travel';

export type Factor = LedgerEntry['factors'][number];

export type Prediction = {
  game: Game;
  /** The forecast: market-anchored when a line is posted, otherwise the pre-line forecast. */
  homeProb: number;
  pick: 'home' | 'away';
  pickProb: number;
  band: Band;
  /** The rating model on its own (ratings, home field, rest, starters, injuries). */
  modelHomeProb: number;
  /** Market-implied ratings with the same game context. */
  marketRatingHomeProb: number;
  /** What the forecast is before a line is posted: Elo and market-implied ratings blended. */
  preLineHomeProb: number;
  basis: 'market' | 'model';
  /** Home-minus-away Elo after every rating-model factor. */
  netElo: number;
  factors: Factor[];
  /** Rating model's line from the home side (negative = home favored); football and basketball only. */
  modelSpread: number | null;
  market: MarketView | null;
  /** Rating model minus market, home side, in probability. Positive: the model likes the home team more. */
  disagreement: number | null;
  injuries: { home: InjuryImpact[]; away: InjuryImpact[] } | null;
  /** Who's playing (NBA): the box score for finished games, the injury report for upcoming ones. */
  lineups: GameLineups | null;
  /** Projected final score, consistent with the forecast. */
  projected: ProjectedScore | null;
  /** 'live' includes injury adjustments; 'logged' is the locked pregame forecast. */
  source: 'core' | 'live' | 'logged';
  /** For a logged game, the forecast the backtest grades it on (the same as every other game's); elsewhere that's `homeProb` itself. */
  gradedHomeProb?: number;
  /** null until final (and for ties). */
  correct: boolean | null;
};

export type TeamRating = {
  team: TeamInfo;
  rank: number;
  rating: number;
  /** Strength as recent closing lines priced it, on the same Elo scale. */
  marketRating: number;
  marketRank: number;
  record: string | null;
  /** Season the record is from; differs from the current one before opening night. */
  recordSeason: string | null;
  seasonChange: number;
  trend: number[];
  /** Points (goals, runs) a game scored and allowed against the league average; allowed above zero is a weak defense. */
  offense: number;
  defense: number;
};

/** How far projected scores landed from the real ones, every graded game. */
export type ScoreRecord = {
  games: number;
  /** Average miss on each team's score, as projected (posted spread and total where there were some). */
  teamMiss: number;
  /** Average miss on the game's total, on games with a posted over/under: the scoring model, the over/under, the league average. */
  totals: { games: number; model: number; market: number; average: number };
};

export type SeasonRecord = { seasonYear: number; label: string; metrics: Metrics };

export type TrackRecord = {
  /** The forecast as shown: closing line where one exists, rating model otherwise. */
  overall: Metrics;
  seasons: SeasonRecord[];
  bands: BandRecord[];
  calibration: CalibrationBucket[];
  /** The same games graded with the rating model alone, and with the market alone (games with a line). */
  modelOnly: Metrics;
  marketOnly: Metrics;
  /** Every game graded as if no line had been posted yet: the pre-line forecast. */
  preLine: Metrics;
  /** Share of graded games with a closing line on file. */
  marketCoverage: number;
  /** Forward-tested record of forecasts the app logged before the game started. */
  live: { metrics: Metrics; bands: BandRecord[] };
  scores: ScoreRecord;
  /** Player projections against sportsbook props; null where there's no player model. */
  props: PropRecord | null;
  /** The model's prop disagreements logged before their games, graded since: the forward test. */
  propsLive: LivePropRecord | null;
  /** Our locked forecasts against ESPN's, both read before the start; null until logging has begun. */
  espn: EspnRecord | null;
};

export type LeagueModel = {
  league: LeagueId;
  generatedAt: string;
  season: { year: number; label: string; phase: string };
  rankings: TeamRating[];
  slate: Prediction[];
  recent: Prediction[];
  record: TrackRecord;
  predictions: Record<string, Prediction>;
  teamGames: Record<string, string[]>;
  history: Record<string, RatingPoint[]>;
  teams: Record<string, TeamInfo>;
  injuries: Record<string, InjuryEntry[]>;
  /** Player ratings behind the lineup (NBA) or quarterback (NFL) model; null elsewhere. */
  players: PlayerBoard | null;
  /** The scoring model's latest state, for projecting any pairing (the matchup machine). */
  scoring: { average: number; homeEdge: number; teams: Record<string, { offense: number; defense: number; venue: number }> };
  /** Player stat projections for games on the board; empty where there's no player model. */
  playerProjections: Record<string, GameProjection>;
  /** Projections next to the books' current lines, for games starting soon that have props posted. */
  propBoards: Record<string, PropBoard>;
};

export type PlayerRow = {
  id: string;
  name: string;
  teamId: string;
  /** NBA: Game Score per 48 minutes. NFL: adjusted net yards per play above league average. */
  rating: number;
  /** Rating minus league average, on the same scale. */
  vsAverage: number;
  /** NBA: usual minutes per game. NFL: recent plays, decayed. */
  volume: number;
};

export type PlayerBoard = { kind: 'nba-players' | 'nfl-quarterbacks'; rows: PlayerRow[] };

export type ModelInputs = {
  games: Game[];
  teams: TeamInfo[];
  injuries?: Record<string, InjuryEntry[]>;
  ledger?: Ledger;
  /** Season stat leaders by team id (NFL), used to value injured players. */
  seasonLeaders?: Record<string, SeasonLeader[]>;
  /** Closing lines for finished games, keyed by game id. */
  closingOdds?: Record<string, MarketOdds | null>;
  /** ESPN's forecasts, read before each game. */
  espnLedger?: EspnLedger;
  /** Player box scores for finished games (leagues with a lineup model). */
  boxScores?: Record<string, BoxScore | null>;
  /** Current rosters by team id, for projecting upcoming lineups. */
  rosters?: Record<string, RosterEntry[]>;
  /** Quarterbacks in depth-chart order by team id (NFL), for who starts upcoming games. */
  qbDepth?: Record<string, RosterEntry[]>;
  /** Sportsbook player props for finished games, which the player projections are graded against. */
  propHistory?: Record<string, PropLine[] | null>;
  /** NFL rushing and receiving box scores, for the player projections. */
  skillBoxes?: Record<string, NflSkillBox | null>;
  /** Current prop lines for games starting soon, by game id. */
  upcomingProps?: Record<string, PropLine[] | null>;
  /** Prop lines the model disagreed with, logged before their games. */
  propLedger?: PropLedger;
};

const LOG_WINDOW_MS = 48 * 3_600_000;
/** Prop disagreements are logged once a game is within a day of its start (lines are mostly up by then). */
const PROP_LOG_WINDOW_MS = 24 * 3_600_000;
/** How far ahead to load prop lines: football posts them days early, the others the day before. */
const propLookahead = (league: LeagueConfig) => (league.id === 'nfl' ? 5 : 1.5) * 86_400_000;

function usableGames(games: Game[], teamIds: Set<string>) {
  return games.filter(
    (g) =>
      (g.seasonType === 2 || g.seasonType === 3) &&
      teamIds.has(g.home.teamId) &&
      teamIds.has(g.away.teamId) &&
      // Drops postponed/cancelled games and finals missing a score.
      !(g.state === 'post' && !g.completed) &&
      !(g.completed && (g.home.score === null || g.away.score === null))
  );
}

/** If ESPN's team list is unavailable, real teams are the ones with a full schedule. */
function frequentTeams(games: Game[]) {
  const counts = new Map<string, number>();
  for (const g of games) for (const id of [g.home.teamId, g.away.teamId]) counts.set(id, (counts.get(id) ?? 0) + 1);
  return new Set([...counts].filter(([, n]) => n >= 10).map(([id]) => id));
}

type ModelView = { homeProb: number; marketRatingHomeProb: number; netElo: number; factors: Factor[] };

function preLineProb(league: LeagueConfig, modelHomeProb: number, marketRatingHomeProb: number) {
  return blendProbability(modelHomeProb, marketRatingHomeProb, league.preLine.ratingsShare);
}

function forecast(league: LeagueConfig, model: Pick<ModelView, 'homeProb' | 'marketRatingHomeProb'>, market: MarketView | null) {
  return market
    ? blendProbability(model.homeProb, market.homeProb, league.modelShare)
    : preLineProb(league, model.homeProb, model.marketRatingHomeProb);
}

function finalize(
  league: LeagueConfig,
  game: Game,
  model: ModelView,
  market: MarketView | null,
  injuries: Prediction['injuries'],
  source: Prediction['source'],
  lockedHomeProb?: number
): Prediction {
  const homeProb = lockedHomeProb ?? forecast(league, model, market);
  const pick = homeProb >= 0.5 ? 'home' : 'away';
  const pickProb = pick === 'home' ? homeProb : 1 - homeProb;
  let correct: boolean | null = null;
  if (game.completed && game.home.score !== null && game.away.score !== null && game.home.score !== game.away.score) {
    correct = game.home.score > game.away.score === (pick === 'home');
  }
  return {
    game,
    homeProb,
    pick,
    pickProb,
    band: bandFor(pickProb),
    modelHomeProb: model.homeProb,
    marketRatingHomeProb: model.marketRatingHomeProb,
    preLineHomeProb: preLineProb(league, model.homeProb, model.marketRatingHomeProb),
    basis: market ? 'market' : 'model',
    netElo: model.netElo,
    factors: model.factors,
    modelSpread: league.elo.eloPerPoint ? Math.round((-model.netElo / league.elo.eloPerPoint) * 2) / 2 : null,
    market,
    disagreement: market ? model.homeProb - market.homeProb : null,
    injuries,
    lineups: null,
    projected: null,
    source,
    correct
  };
}

function coreFactors(
  league: LeagueConfig,
  params: EloParams,
  game: Game,
  ctx: PregameContext,
  lineups?: GameLineups,
  trip?: EastwardTrip,
  qbs?: GameQbs
): Factor[] {
  const factors: Factor[] = [
    { label: 'Team rating', detail: 'Elo entering the game; 1500 is league average', home: ctx.homeRating, away: ctx.awayRating, kind: 'rating' },
    {
      label: 'Home field',
      detail: game.neutral ? 'Neutral site, no advantage' : `Worth ${params.hfa} Elo in ${league.id === 'mlb' ? 'MLB' : `the ${league.name}`}`,
      home: ctx.hfa,
      away: 0,
      kind: 'adjustment'
    }
  ];
  if (params.backToBack > 0 && (ctx.homeBackToBack || ctx.awayBackToBack)) {
    const who = [ctx.homeBackToBack && game.home.abbr, ctx.awayBackToBack && game.away.abbr].filter(Boolean).join(' and ');
    factors.push({ label: 'Rest', detail: `${who} on the second night of a back-to-back`, home: ctx.homeRest, away: ctx.awayRest, kind: 'adjustment' });
  }
  if (params.starter) {
    factors.push({
      label: league.id === 'nhl' ? 'Starting goalies' : 'Starting pitchers',
      detail: `${game.away.abbr}: ${ctx.awayStarterDetail} · ${game.home.abbr}: ${ctx.homeStarterDetail}`,
      home: ctx.homeStarter,
      away: ctx.awayStarter,
      kind: 'adjustment'
    });
  }
  if (lineups && (Math.abs(lineups.home.elo) >= 0.5 || Math.abs(lineups.away.elo) >= 0.5)) {
    factors.push({
      label: 'Lineups',
      detail: `${game.away.abbr}: ${describeLineup(lineups.away)} · ${game.home.abbr}: ${describeLineup(lineups.home)} (from the ${lineups.source})`,
      home: lineups.home.elo,
      away: lineups.away.elo,
      kind: 'adjustment'
    });
  }
  if (qbs) {
    factors.push({
      label: 'Quarterbacks',
      detail: `${game.away.abbr}: ${describeQb(qbs.away)} · ${game.home.abbr}: ${describeQb(qbs.home)} (against each team's recent starters, from the ${
        qbs.source === 'box score' ? 'box score' : 'depth chart and injury report'
      })`,
      home: qbs.home.elo,
      away: qbs.away.elo,
      kind: 'adjustment',
      change: { home: qbChange(qbs.home), away: qbChange(qbs.away) }
    });
  }
  if (params.eastZones && trip && (trip.home || trip.away)) {
    const crossed = (abbr: string, zones: number) => zones && `${abbr} crossed ${zones} time zone${zones === 1 ? '' : 's'}`;
    const who = [crossed(game.away.abbr, trip.away), crossed(game.home.abbr, trip.home)].filter(Boolean).join(' and ');
    factors.push({
      label: 'Travel',
      detail: `${who} heading east to this game: ${params.eastZones} Elo per zone for body-clock lag`,
      home: -params.eastZones * trip.home,
      away: -params.eastZones * trip.away,
      kind: 'adjustment'
    });
  }
  return factors;
}

/** The injury list on game pages, valued by the lineup model instead of the leader heuristic. */
function lineupInjuryImpacts(report: InjuryEntry[], team: GameLineups['home']): InjuryImpact[] {
  const byId = new Map((team.players ?? []).map((p) => [p.id, p]));
  const costs = new Map(team.absences.map((a) => [a.id, a]));
  return report
    .map((entry): InjuryImpact => {
      const player = byId.get(entry.athleteId);
      const absence = costs.get(entry.athleteId);
      const sit = player ? 1 - player.available : 0;
      return {
        ...entry,
        missChance: sit,
        value: absence && sit > 0 ? absence.cost / sit : 0,
        elo: absence ? -absence.cost : 0,
        reason: player
          ? `${Math.round(player.share * 240)} min a game when healthy · ${player.rating.toFixed(1)} Game Score per 48`
          : 'Not in the projected rotation'
      };
    })
    .sort((a, b) => a.elo - b.elo);
}

export function computeLeagueModel(
  league: LeagueConfig,
  inputs: ModelInputs,
  now = new Date(),
  params: EloParams = league.elo
): { model: LeagueModel; ledger: Ledger; propLedger: PropLedger } {
  const {
    games: rawGames,
    teams: teamList,
    injuries = {},
    ledger = {},
    seasonLeaders = {},
    closingOdds = {},
    espnLedger = {},
    boxScores = {},
    rosters = {},
    qbDepth = {},
    propHistory = {},
    skillBoxes = {},
    upcomingProps = {},
    propLedger = {}
  } = inputs;
  const teamIds = teamList.length ? new Set(teamList.map((t) => t.id)) : frequentTeams(rawGames);
  const games = usableGames(rawGames, teamIds);
  // Who's playing feeds both rating replays, so a loss without the star doesn't cost the team rating.
  const lineupData = league.lineups ? lineupPass(games, boxScores, league.lineups, { rosters, injuries }) : null;
  // So does who starts at quarterback (NFL): a backup's loss doesn't cost the team rating.
  const qbData = league.quarterbacks ? qbPass(games, boxScores, league.quarterbacks, { depth: qbDepth, injuries }) : null;
  // Eastward travel (NBA) is known from the schedule alone, so it adjusts both replays the same way.
  const trips = params.eastZones ? eastwardTrips(games) : null;
  const extra = combineAdjustments(lineupData?.extra, qbData?.extra, trips && travelAdjustments(trips, params.eastZones!));
  const result = replay(games, params, league.scoreUnit === 'goals' ? 'goals' : 'runs', extra);
  const scoring = scoringPass(games, league.scoring);
  const firstSeason = result.firstSeason ?? 0;
  const lastSeason = result.lastSeason ?? now.getUTCFullYear();

  const teams: Record<string, TeamInfo> = Object.fromEntries(teamList.map((t) => [t.id, t]));
  const teamGames: Record<string, string[]> = {};
  for (const g of games) {
    for (const side of [g.home, g.away]) {
      // Games stored before team colors were kept get them from the team list.
      if (side.color === undefined && teams[side.teamId]) {
        side.color = teams[side.teamId].color;
        side.altColor = teams[side.teamId].altColor ?? null;
      }
      (teamGames[side.teamId] ??= []).push(g.id);
      teams[side.teamId] ??= { id: side.teamId, abbr: side.abbr, name: side.name, shortName: side.shortName, logo: side.logo, color: null };
    }
  }
  const gameById = new Map(games.map((g) => [g.id, g]));
  const completedBefore = (teamId: string, date: string) =>
    (teamGames[teamId] ?? []).map((id) => gameById.get(id)!).filter((g) => g.completed && g.date < date);

  const todayKey = etDateKey(now);
  const windowEnd = now.getTime() + league.upcomingDays * 86_400_000;
  const inSlate = (g: Game) => g.state === 'in' || (etDateKey(g.date) >= todayKey && Date.parse(g.date) <= windowEnd);

  // Finished games use the closing line; upcoming games use the current one. In-game
  // lines are live odds, so a game in progress without a logged forecast uses neither.
  const marketFor = (g: Game) => marketView(g.completed ? closingOdds[g.id] ?? null : g.state === 'pre' ? g.odds : null, league);

  // Market-implied ratings learn only from finished games' closing lines.
  const lineProbs = new Map<string, number>();
  for (const g of games) {
    const line = g.completed ? marketFor(g) : null;
    if (line) lineProbs.set(g.id, line.homeProb);
  }
  const marketBased = marketRatings(games, lineProbs, result.contexts, params.hfa, league.preLine);
  const marketRatingProb = (g: Game, injuryGap = 0) => winProbability(marketBased.diffs.get(g.id)! + injuryGap);

  const nextLedger: Ledger = { ...ledger };
  const predictions: Record<string, Prediction> = {};

  for (const game of games) {
    const ctx = result.contexts.get(game.id)!;
    const market = marketFor(game);
    const logged = ledger[game.id];
    const lineups = lineupData?.lineups.get(game.id) ?? null;
    const qbs = qbData?.starters.get(game.id);
    const core = {
      homeProb: ctx.homeProb,
      marketRatingHomeProb: marketRatingProb(game),
      netElo: ctx.diff,
      factors: coreFactors(league, params, game, ctx, lineups ?? undefined, trips?.get(game.id), qbs)
    };

    if (game.state !== 'pre' && logged) {
      const modelHomeProb = logged.modelHomeProb ?? logged.homeProb;
      const model = { homeProb: modelHomeProb, marketRatingHomeProb: logged.marketRatingHomeProb ?? modelHomeProb, netElo: logged.netElo, factors: logged.factors };
      predictions[game.id] = { ...finalize(league, game, model, logged.market, null, 'logged', logged.homeProb), lineups, gradedHomeProb: forecast(league, core, market) };
      continue;
    }

    if (game.completed || !inSlate(game)) {
      predictions[game.id] = { ...finalize(league, game, core, market, null, 'core'), lineups };
      continue;
    }

    // With a lineup model the injury report is already in the ratings' diff;
    // otherwise injuries are a separate, smaller adjustment. NFL quarterbacks are
    // in the diff through the quarterback model, so only the other players add one.
    const impactsFor = (side: Game['home']) => {
      const report = injuries[side.teamId] ?? [];
      if (lineups) {
        const impacts = lineupInjuryImpacts(report, side === game.home ? lineups.home : lineups.away);
        return { impacts, counted: [], total: 0 };
      }
      const team = qbs && (side === game.home ? qbs.home : qbs.away);
      const isQb = (entry: InjuryEntry) => !!team && (entry.position === 'QB' || team.options.some((o) => o.id === entry.athleteId));
      const others = injuryImpacts(league.id, side, report.filter((e) => !isQb(e)), completedBefore(side.teamId, game.date), seasonLeaders[side.teamId] ?? []);
      const impacts = team ? [...others.impacts, ...qbInjuryImpacts(report.filter(isQb), team)].sort((a, b) => a.elo - b.elo) : others.impacts;
      return { impacts, counted: others.impacts, total: others.total };
    };
    const home = impactsFor(game.home);
    const away = impactsFor(game.away);
    const net = ctx.diff + home.total - away.total;
    const factors = [...core.factors];
    if (home.total !== 0 || away.total !== 0) {
      const names = [...home.counted, ...away.counted]
        .filter((i) => i.elo < -0.5)
        .sort((a, b) => a.elo - b.elo)
        .slice(0, 3)
        .map((i) => i.name);
      factors.push({ label: 'Injuries', detail: names.length ? `Key absences: ${names.join(', ')}` : 'Minor', home: home.total, away: away.total, kind: 'adjustment' });
    }

    const injuryGap = home.total - away.total;
    const prediction = {
      ...finalize(
        league,
        game,
        { homeProb: winProbability(net), marketRatingHomeProb: marketRatingProb(game, injuryGap), netElo: net, factors },
        market,
        { home: home.impacts, away: away.impacts },
        'live'
      ),
      lineups
    };
    predictions[game.id] = prediction;
    if (game.state === 'pre' && Date.parse(game.date) - now.getTime() <= LOG_WINDOW_MS) {
      nextLedger[game.id] = {
        takenAt: now.toISOString(),
        homeProb: prediction.homeProb,
        modelHomeProb: prediction.modelHomeProb,
        marketRatingHomeProb: prediction.marketRatingHomeProb,
        netElo: net,
        factors,
        market
      };
    }
  }

  // Projected scores follow whatever forecast is shown, logged or current, and its line.
  const useSpread = !!league.elo.eloPerPoint;
  for (const p of Object.values(predictions)) {
    p.projected = projectScore(p.homeProb, scoring.expected.get(p.game.id)!, p.market, league.scoring, useSpread);
  }

  // Player projections: games on the board, plus every graded game with sportsbook props to grade them on.
  const playerProjections: Record<string, GameProjection> = {};
  const propBoards: Record<string, PropBoard> = {};
  const nextPropLedger: PropLedger = { ...propLedger };
  let props: PropRecord | null = null;
  let propsLive: LivePropRecord | null = null;
  const engine = propEngine(league);
  if (engine) {
    const teamPoints = new Map<string, { home: number; away: number }>();
    for (const p of Object.values(predictions)) if (p.projected) teamPoints.set(p.game.id, { home: p.projected.home, away: p.projected.away });
    const starters = new Map<string, { home: RosterEntry | null; away: RosterEntry | null }>();
    const likeliest = (team: GameQbs['home']) => [...team.options].sort((a, b) => b.chance - a.chance)[0] ?? null;
    for (const [id, qbs] of qbData?.starters ?? []) {
      if (qbs.source !== 'depth chart') continue;
      const home = likeliest(qbs.home);
      const away = likeliest(qbs.away);
      starters.set(id, { home: home && { id: home.id, name: home.name }, away: away && { id: away.id, name: away.name } });
    }
    const propInputs: PropInputs = {
      games,
      box: boxScores,
      skill: skillBoxes,
      context: { teamPoints, leaguePoints: scoring.averageBefore },
      live: { rosters, injuries, starters }
    };
    const withProps = (g: Game) => g.completed && g.seasonYear > firstSeason && !!propHistory[g.id];
    const projected = engine.project(engine.params, propInputs, (g) => inSlate(g) || withProps(g) || !!upcomingProps[g.id]);
    for (const g of games) if (inSlate(g) && projected.has(g.id)) playerProjections[g.id] = projected.get(g.id)!;
    props = gradeProps(engine.params, gradedLines(engine.params, games.filter(withProps), projected, propHistory, (id) => engine.actuals(id, propInputs)));

    // Boards for games with lines posted, and the model's disagreements logged within a day of the start.
    for (const g of games) {
      const lines = upcomingProps[g.id];
      const projection = projected.get(g.id);
      if (!lines?.length || !projection || g.state !== 'pre') continue;
      const board = propBoard(engine.params, engine.markets, projection, lines, null);
      propBoards[g.id] = board;
      if (Date.parse(g.date) - now.getTime() > PROP_LOG_WINDOW_MS || Date.parse(g.date) <= now.getTime()) continue;
      for (const row of board.rows) {
        for (const [market, cell] of Object.entries(row.cells) as [PropMarket, PropCell][]) {
          const line = cell.line;
          if (!line?.edge || line.over === null || line.under === null) continue;
          const key = propLedgerKey(g.id, row.id, market);
          nextPropLedger[key] = withFirst({
            takenAt: now.toISOString(),
            start: g.date,
            gameId: g.id,
            athleteId: row.id,
            name: row.name,
            teamId: row.teamId,
            market,
            line: line.line,
            over: line.over,
            under: line.under,
            book: line.book,
            projected: cell.projection,
            model: line.modelOver,
            side: line.edge.side,
            edge: line.edge.edge
          }, propLedger[key]);
        }
      }
    }
    // Grade logged lines once their games are final; a player who didn't play voids the bet.
    const actualsByGame = new Map<string, Actuals | null>();
    const actualsFor = (gameId: string) => {
      if (!actualsByGame.has(gameId)) actualsByGame.set(gameId, engine.actuals(gameId, propInputs));
      return actualsByGame.get(gameId)!;
    };
    const gameById = new Map(games.map((g) => [g.id, g]));
    propsLive = gradePropLedger(nextPropLedger, (entry) => {
      const game = gameById.get(entry.gameId);
      if (!game?.completed) return undefined;
      const actuals = actualsFor(entry.gameId);
      if (!actuals) return undefined;
      return actuals.get(entry.athleteId)?.[entry.market] ?? null;
    });
    // Closing line value: each pick's first tag against the book's closing main line for that player and stat.
    const closings = new Map<string, Map<string, PropLine>>();
    const closingFor = (gameId: string) => {
      if (!closings.has(gameId)) closings.set(gameId, new Map(mainLines((propHistory[gameId] ?? []).filter(isPriced)).map((l) => [`${l.athleteId}|${l.market}`, l])));
      return closings.get(gameId)!;
    };
    propsLive.clv = gradeClv(nextPropLedger, (entry) => {
      if (!gameById.get(entry.gameId)?.completed) return null;
      const close = closingFor(entry.gameId).get(`${entry.athleteId}|${entry.market}`);
      return close && close.over !== null && close.under !== null ? { line: close.line, over: close.over, under: close.under } : null;
    });
  }

  // Backtest: seasons after the burn-in season. Every forecast uses only what was
  // known before the game: ratings to that point and the closing line.
  const evaluated = games.filter((g) => g.completed && g.seasonYear > firstSeason && g.home.score !== g.away.score);
  const outcome = (g: Game, homeProb: number): Outcome => ({ homeProb, homeWon: g.home.score! > g.away.score! });
  const coreView = (g: Game) => ({ homeProb: result.contexts.get(g.id)!.homeProb, marketRatingHomeProb: marketRatingProb(g) });
  const graded = (set: Game[]) => set.map((g) => outcome(g, forecast(league, coreView(g), marketFor(g))));
  const outcomes = graded(evaluated);
  const withMarket = evaluated.filter((g) => marketFor(g));
  const seasons = [...new Set(evaluated.map((g) => g.seasonYear))].map((seasonYear) => ({
    seasonYear,
    label: seasonLabel(league, seasonYear),
    metrics: summarize(graded(evaluated.filter((g) => g.seasonYear === seasonYear)))
  }));
  const liveOutcomes = games
    .filter((g) => g.completed && ledger[g.id] && g.home.score !== g.away.score)
    .map((g) => outcome(g, ledger[g.id].homeProb));

  const meanMiss = (misses: number[]) => (misses.length ? misses.reduce((s, x) => s + Math.abs(x), 0) / misses.length : 0);
  const actualTotal = (g: Game) => g.home.score! + g.away.score!;
  const modelTotal = (g: Game) => scoring.expected.get(g.id)!.home + scoring.expected.get(g.id)!.away;
  const withTotal = evaluated.filter((g) => marketFor(g)?.overUnder != null);
  const scores: ScoreRecord = {
    games: evaluated.length,
    teamMiss: meanMiss(
      evaluated.flatMap((g) => {
        const s = projectScore(forecast(league, coreView(g), marketFor(g)), scoring.expected.get(g.id)!, marketFor(g), league.scoring, useSpread);
        return [s.home - g.home.score!, s.away - g.away.score!];
      })
    ),
    totals: {
      games: withTotal.length,
      model: meanMiss(withTotal.map((g) => modelTotal(g) - actualTotal(g))),
      market: meanMiss(withTotal.map((g) => marketFor(g)!.overUnder! - actualTotal(g))),
      average: meanMiss(withTotal.map((g) => 2 * scoring.averageBefore.get(g.id)! - actualTotal(g)))
    }
  };

  // Latest W-L per team; falls back to last season's final record before opening night.
  const latestRecord = new Map<string, { record: string; seasonYear: number }>();
  for (const g of games) {
    if (g.seasonYear < lastSeason - 1 || !g.completed) continue;
    for (const side of [g.home, g.away]) if (side.record) latestRecord.set(side.teamId, { record: side.record, seasonYear: g.seasonYear });
  }

  const activeTeams = new Set(games.filter((g) => g.seasonYear >= lastSeason - 1).flatMap((g) => [g.home.teamId, g.away.teamId]));
  const seasonStart = games.find((g) => g.seasonYear === lastSeason)?.date ?? now.toISOString();
  const marketOrder = [...activeTeams].sort((a, b) => (marketBased.ratings.get(b) ?? MEAN_RATING) - (marketBased.ratings.get(a) ?? MEAN_RATING));
  const rankings = [...activeTeams]
    .map((id) => {
      const rating = result.ratings.get(id) ?? MEAN_RATING;
      const points = (result.history.get(id) ?? []).filter((p) => p.date >= seasonStart);
      return {
        team: teams[id],
        rank: 0,
        rating,
        marketRating: marketBased.ratings.get(id) ?? MEAN_RATING,
        marketRank: marketOrder.indexOf(id) + 1,
        record: latestRecord.get(id)?.record ?? null,
        recordSeason: latestRecord.get(id) ? seasonLabel(league, latestRecord.get(id)!.seasonYear) : null,
        seasonChange: rating - (result.seasonStartRatings.get(id) ?? MEAN_RATING),
        trend: points.slice(-30).map((p) => p.rating),
        offense: scoring.state.offense.get(id) ?? 0,
        defense: scoring.state.defense.get(id) ?? 0
      };
    })
    .sort((a, b) => b.rating - a.rating)
    .map((r, i) => ({ ...r, rank: i + 1 }));

  const previousSeasonStart = games.find((g) => g.seasonYear === lastSeason - 1)?.date ?? seasonStart;
  const history: Record<string, RatingPoint[]> = {};
  for (const [id, points] of result.history) history[id] = points.filter((p) => p.date >= previousSeasonStart);

  const slate = games.filter(inSlate).map((g) => predictions[g.id]);
  const upcomingTypes = new Set(games.filter((g) => !g.completed && Date.parse(g.date) <= windowEnd + 7 * 86_400_000).map((g) => g.seasonType));
  const lastCompleted = [...games].reverse().find((g) => g.completed);
  const phase = upcomingTypes.has(3)
    ? 'Postseason'
    : upcomingTypes.has(2)
      ? lastCompleted?.seasonYear === lastSeason
        ? 'Regular season'
        : 'Season opens soon'
      : lastCompleted && now.getTime() - Date.parse(lastCompleted.date) < 10 * 86_400_000
        ? lastCompleted.seasonType === 3
          ? 'Postseason'
          : 'Regular season'
        : 'Offseason';

  const model: LeagueModel = {
    league: league.id,
    generatedAt: now.toISOString(),
    season: { year: lastSeason, label: seasonLabel(league, lastSeason), phase },
    rankings,
    slate,
    recent: evaluated.slice(-30).reverse().map((g) => predictions[g.id]),
    record: {
      overall: summarize(outcomes),
      seasons,
      bands: byBand(outcomes),
      calibration: calibration(outcomes),
      modelOnly: summarize(evaluated.map((g) => outcome(g, result.contexts.get(g.id)!.homeProb))),
      marketOnly: summarize(withMarket.map((g) => outcome(g, marketFor(g)!.homeProb))),
      preLine: summarize(evaluated.map((g) => outcome(g, forecast(league, coreView(g), null)))),
      marketCoverage: evaluated.length ? withMarket.length / evaluated.length : 0,
      live: { metrics: summarize(liveOutcomes), bands: byBand(liveOutcomes) },
      scores,
      props,
      propsLive,
      espn: espnHeadToHead(games, espnLedger, ledger)
    },
    predictions,
    teamGames,
    history,
    teams,
    injuries,
    players: playerBoard(lineupData?.model, qbData?.model, games, activeTeams),
    scoring: {
      average: scoring.state.average,
      homeEdge: scoring.state.homeEdge,
      teams: Object.fromEntries(
        [...activeTeams].map((id) => [
          id,
          { offense: scoring.state.offense.get(id) ?? 0, defense: scoring.state.defense.get(id) ?? 0, venue: scoring.state.venue.get(id) ?? 0 }
        ])
      )
    },
    playerProjections,
    propBoards
  };
  return { model, ledger: nextLedger, propLedger: nextPropLedger };
}

/** Players who've played in roughly the last season, on teams still in the league. */
function playerBoard(
  lineups: ReturnType<typeof lineupPass>['model'] | undefined,
  qbs: ReturnType<typeof qbPass>['model'] | undefined,
  games: Game[],
  activeTeams: Set<string>
): PlayerBoard | null {
  const lastPlayed = [...games].reverse().find((g) => g.completed)?.date;
  if (!lastPlayed) return null;
  const since = new Date(Date.parse(lastPlayed) - 300 * 86_400_000).toISOString();
  if (lineups) {
    const rows = lineups
      .leaderboard(since)
      .filter((p) => activeTeams.has(p.teamId))
      .map((p) => ({ id: p.id, name: p.name, teamId: p.teamId, rating: p.rating, vsAverage: p.vsAverage, volume: p.minutes }));
    return { kind: 'nba-players', rows };
  }
  if (qbs) {
    const board = qbs.leaderboard(since).filter((p) => activeTeams.has(p.teamId));
    // Ratings are pulled toward a below-average prior, so "average" means the average starter:
    // the 32 passers with the most recent plays.
    const starters = [...board].sort((a, b) => b.plays - a.plays).slice(0, 32);
    const starterAverage = starters.reduce((s, p) => s + p.perPlay, 0) / Math.max(1, starters.length);
    const rows = board.map((p) => ({ id: p.id, name: p.name, teamId: p.teamId, rating: p.perPlay, vsAverage: p.perPlay - starterAverage, volume: p.plays }));
    return { kind: 'nfl-quarterbacks', rows };
  }
  return null;
}

const filling = new Set<LeagueId>();

/** Finished games that get graded: everything after the burn-in season. */
function gradedGames(games: Game[]) {
  const regular = games.filter((g) => g.seasonType === 2 || g.seasonType === 3);
  const first = Math.min(...regular.map((g) => g.seasonYear));
  return regular.filter((g) => g.completed && g.seasonYear > first);
}

/**
 * Closing lines are one request per game, so a cold cache could mean thousands.
 * Each build fetches a small batch inline (newest first) and leaves the rest to
 * a background fill; `npm run warm` fetches everything up front.
 */
async function closingOddsFor(league: LeagueConfig, games: Game[]) {
  const graded = gradedGames(games);
  const inlineBudget = filling.has(league.id) ? 0 : 60;
  const odds = await getClosingOdds(league, graded, inlineBudget);
  noteHistory(league.id, 'lines', Object.keys(odds).length, graded.length);
  if (Object.keys(odds).length < graded.length && !filling.has(league.id)) {
    filling.add(league.id);
    getClosingOdds(league, graded)
      .catch(() => undefined)
      .finally(() => filling.delete(league.id));
  }
  return odds;
}

const fillingProps = new Set<LeagueId>();

/** Sportsbook props for graded games (leagues with a player model), filled the same way as closing lines. */
async function propHistoryFor(league: LeagueConfig, games: Game[]) {
  if (!hasPropModel(league)) return {};
  const graded = gradedGames(games);
  const history = await getPropHistory(league, graded, fillingProps.has(league.id) ? 0 : 30);
  noteHistory(league.id, 'props', Object.keys(history).length, graded.length);
  if (Object.keys(history).length < graded.length && !fillingProps.has(league.id)) {
    fillingProps.add(league.id);
    getPropHistory(league, graded)
      .catch(() => undefined)
      .finally(() => fillingProps.delete(league.id));
  }
  return history;
}

const fillingBoxes = new Set<LeagueId>();

/** Box scores for the lineup, quarterback and player models, filled the same way as closing lines. */
async function boxScoresFor(league: LeagueConfig, games: Game[]) {
  if (!league.lineups && !league.quarterbacks && !league.nhlPlayers) return {};
  const finished = games.filter((g) => g.completed && (g.seasonType === 2 || g.seasonType === 3));
  const box = await getBoxScores(league, finished, fillingBoxes.has(league.id) ? 0 : 60);
  noteHistory(league.id, 'boxes', Object.keys(box).length, finished.length);
  if (Object.keys(box).length < finished.length && !fillingBoxes.has(league.id)) {
    fillingBoxes.add(league.id);
    getBoxScores(league, finished)
      .catch(() => undefined)
      .finally(() => fillingBoxes.delete(league.id));
  }
  return box;
}

const fillingSkill = new Set<LeagueId>();

/** NFL rushing and receiving box scores for the player model, filled the same way. */
async function skillBoxesFor(league: LeagueConfig, games: Game[]) {
  if (!league.nflPlayers) return {};
  const finished = games.filter((g) => g.completed && (g.seasonType === 2 || g.seasonType === 3));
  const skill = await getNflSkillBoxes(league, finished, fillingSkill.has(league.id) ? 0 : 40);
  noteHistory(league.id, 'skill', Object.keys(skill).length, finished.length);
  if (Object.keys(skill).length < finished.length && !fillingSkill.has(league.id)) {
    fillingSkill.add(league.id);
    getNflSkillBoxes(league, finished)
      .catch(() => undefined)
      .finally(() => fillingSkill.delete(league.id));
  }
  return skill;
}

/** Current prop lines for games starting soon (leagues with a player model); a feed hiccup just leaves a game out. */
async function upcomingPropsFor(league: LeagueConfig, games: Game[], now: Date) {
  const props: Record<string, PropLine[] | null> = {};
  if (!hasPropModel(league)) return props;
  const horizon = now.getTime() + propLookahead(league);
  const soon = games.filter((g) => g.state === 'pre' && Date.parse(g.date) > now.getTime() && Date.parse(g.date) <= horizon);
  await Promise.all(
    soon.map(async (g) => {
      props[g.id] = await getUpcomingProps(league, g.id).catch(() => null);
    })
  );
  return props;
}

function teamsPlayingSoon(league: LeagueConfig, games: Game[], now: Date) {
  const horizon = now.getTime() + (league.upcomingDays + 1) * 86_400_000;
  return new Set(games.filter((g) => !g.completed && Date.parse(g.date) <= horizon).flatMap((g) => [g.home.teamId, g.away.teamId]));
}

/** Current rosters for teams playing soon, so lineups and player projections reflect trades and signings. */
async function rostersFor(league: LeagueConfig, games: Game[], now: Date) {
  const rosters: Record<string, RosterEntry[]> = {};
  if (!league.lineups && !propEngine(league)) return rosters;
  await Promise.all(
    [...teamsPlayingSoon(league, games, now)].map(async (teamId) => {
      const roster = await getTeamRoster(league, teamId).catch(() => null);
      if (roster?.length) rosters[teamId] = roster;
    })
  );
  return rosters;
}

/** Quarterback depth charts for teams playing soon (NFL), for who starts. */
async function qbDepthFor(league: LeagueConfig, games: Game[], now: Date) {
  const depth: Record<string, RosterEntry[]> = {};
  if (!league.quarterbacks) return depth;
  await Promise.all(
    [...teamsPlayingSoon(league, games, now)].map(async (teamId) => {
      const chart = await getQbDepthChart(league, teamId).catch(() => null);
      if (chart?.length) depth[teamId] = chart;
    })
  );
  return depth;
}

async function buildLeagueModel(id: LeagueId): Promise<LeagueModel> {
  const league = LEAGUES[id];
  const now = new Date();
  const [games, teams, injuries, ledger] = await Promise.all([
    getLeagueGames(league, now),
    getTeams(league).catch(() => [] as TeamInfo[]),
    getInjuries(league).catch(() => ({}) as Record<string, InjuryEntry[]>),
    readLedger(id)
  ]);

  // NFL injuries are valued off season stat leaders, fetched only for teams with a game coming up.
  const seasonLeaders: Record<string, SeasonLeader[]> = {};
  const leadersLoad =
    id !== 'nfl'
      ? Promise.resolve()
      : (async () => {
          const horizon = now.getTime() + league.upcomingDays * 86_400_000;
          const upcoming = new Map<string, number>();
          for (const g of games) {
            if (g.completed || Date.parse(g.date) > horizon || Date.parse(g.date) < now.getTime() - 86_400_000) continue;
            upcoming.set(g.home.teamId, g.seasonYear);
            upcoming.set(g.away.teamId, g.seasonYear);
          }
          await Promise.all(
            [...upcoming].map(async ([teamId, season]) => {
              seasonLeaders[teamId] = await getTeamSeasonLeaders(league, season, teamId).catch(() => []);
            })
          );
        })();
  const [espnLedger, closingOdds, boxScores, rosters, qbDepth, propHistory, skillBoxes, upcomingProps, propLedger] = await Promise.all([
    recordEspnForecasts(league, games, now).catch(() => ({})),
    closingOddsFor(league, games).catch(() => ({})),
    boxScoresFor(league, games).catch(() => ({})),
    rostersFor(league, games, now),
    qbDepthFor(league, games, now),
    propHistoryFor(league, games).catch(() => ({})),
    skillBoxesFor(league, games).catch(() => ({})),
    upcomingPropsFor(league, games, now),
    hasPropModel(league) ? readPropLedger(id) : Promise.resolve({} as PropLedger),
    leadersLoad
  ]);

  const {
    model,
    ledger: next,
    propLedger: nextProps
  } = computeLeagueModel(
    league,
    { games, teams, injuries, ledger, seasonLeaders, closingOdds, espnLedger, boxScores, rosters, qbDepth, propHistory, skillBoxes, upcomingProps, propLedger },
    now
  );
  if (Object.keys(next).length !== Object.keys(ledger).length || model.slate.some((p) => p.game.state === 'pre')) {
    await writeLedger(id, next);
  }
  if (Object.keys(nextProps).length !== Object.keys(propLedger).length || Object.keys(model.propBoards).length) {
    await writePropLedger(id, nextProps, now);
  }
  await recordMovement(id, model.slate, now);
  if (id === 'nfl') await recordFantasyBoard(league, model, now).catch(() => undefined);
  return model;
}

/**
 * A league's model, rebuilt at most every 90 seconds. Pages get the last build
 * instantly while a newer one is made in the background; `fresh` waits for a
 * rebuild instead (the refresher needs the forecast it logs to be current).
 */
export function getLeagueModel(id: LeagueId, { fresh = false }: { fresh?: boolean } = {}) {
  return cached(`model-${id}`, { ttlMs: 90_000, staleWhileRevalidate: !fresh }, () => buildLeagueModel(id));
}
