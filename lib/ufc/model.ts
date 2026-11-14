// The UFC side of the site, built from the feed: fighter ratings, a forecast for every fight (the ratings,
// leaning on the betting market where there's a line), division rankings, and the record, both backtested
// and forward (forecasts locked before each fight). Rebuilt every 10 minutes, every minute on fight nights.
import { blendProbability, impliedProbability } from '../model/market';
import { summarize, type Metrics, type Outcome } from '../model/metrics';
import { rateFights, UFC_ELO, winChance } from './elo';
import { getUfcEvents, getUfcOdds, type UfcBout, type UfcEvent, type UfcFighter, type UfcOdds } from './feed';
import { logUfcForecasts, readUfcLedger, type UfcLedger } from './ledger';

/**
 * How much of the published forecast comes from the ratings when there's a betting line (the rest is the
 * market's no-margin chance). Fit on 2019–2022 fights and tested on 2023 on (scripts/ufc-backtest.ts): any
 * share of the ratings made forecasts worse, so with a line the forecast is the market's. (Stretching the
 * market for favorites beating their price helped by 0.0005 in log loss, and not every year: not used.)
 */
export const RATINGS_SHARE = 0;
/** Lines read for past fights per build, so history fills in over a few builds without holding one up. */
const HISTORY_ODDS_PER_BUILD = 300;
/** The backtest's graded stretch: the years the ratings' settings never saw. */
export const UFC_TEST_FROM = '2019-01-01';
/** Fought within this long to count as active (and be ranked). */
const ACTIVE_MS = 548 * 86_400_000;
const RANKED_MIN_FIGHTS = 3;

export type UfcForecast = {
  /** The chance shown for fighter A. */
  chanceA: number;
  ratingsA: number;
  /** The market's chance for A with the bookmaker's margin taken out; null with no line. */
  marketA: number | null;
  odds: UfcOdds | null;
  ratingA: number;
  ratingB: number;
};

export type UfcFighterView = {
  profile: UfcFighter;
  rating: number;
  peak: number;
  fights: number;
  wins: number;
  losses: number;
  draws: number;
  noContests: number;
  division: string | null;
  active: boolean;
  /** Place in their division among active fighters with 3+ UFC fights; null otherwise. */
  rank: number | null;
  lastFight: string | null;
  /** How their UFC fights ended. */
  endings: { stoppageWins: number; decisionWins: number; stoppageLosses: number; decisionLosses: number };
};

/** How market favorites did, by their chance: the history behind "favorites like this". */
export type FavoriteBand = { lo: number; hi: number; fights: number; said: number; won: number };

export type UfcRecord = {
  /** 2019 on, every decided fight: the ratings alone. */
  ratings: Metrics;
  /** The fights that had a betting line: the ratings, the market, and the published blend of the two. */
  withLines: { ratings: Metrics; market: Metrics; published: Metrics };
  /** Forecasts locked before each fight since the UFC section started, graded. */
  live: Metrics;
  /** The latest graded locked forecasts, newest first. */
  liveRecent: { boutId: string; chanceA: number; aWon: boolean }[];
};

export type UfcModel = {
  generatedAt: string;
  events: UfcEvent[];
  eventsById: Map<string, UfcEvent>;
  boutsById: Map<string, UfcBout>;
  fighters: Map<string, UfcFighterView>;
  /** Each fighter's UFC fights, newest first (upcoming ones included). */
  boutsByFighter: Map<string, UfcBout[]>;
  forecasts: Map<string, UfcForecast>;
  upcoming: UfcEvent[];
  recent: UfcEvent[];
  divisions: { name: string; fighters: UfcFighterView[] }[];
  record: UfcRecord;
  favorites: FavoriteBand[];
  ledger: UfcLedger;
};

const BAND_EDGES = [0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 1.0001];

/** The band a favorite's chance falls in, if it has enough fights behind it to say anything. */
export function favoriteBand(bands: FavoriteBand[], chance: number, minFights = 40) {
  const fav = Math.max(chance, 1 - chance);
  const band = bands.find((b) => fav >= b.lo && fav < b.hi);
  return band && band.fights >= minFights ? band : null;
}

/** Whether a finished fight was stopped (anything short of the full distance with a winner). */
export const wasStopped = (b: UfcBout) => b.completed && !(b.round === b.rounds && b.clock === '5:00');

const DIVISION_ORDER = [
  'Heavyweight',
  'Light Heavyweight',
  'Middleweight',
  'Welterweight',
  'Lightweight',
  'Featherweight',
  'Bantamweight',
  'Flyweight',
  "Women's Featherweight",
  "Women's Bantamweight",
  "Women's Flyweight",
  "Women's Strawweight"
];
/** ESPN's weight class as people say it: "W Flyweight" is "Women's Flyweight". */
export const weightName = (weightClass: string | null) => (weightClass ? weightClass.replace(/^W(omen'?s)?\.?\s+/i, "Women's ") : null);
/** A division, or null for a one-off weight (catchweight, openweight) that ranks no one. */
export const divisionOf = (weightClass: string | null) => (weightClass && !/catch|open/i.test(weightClass) ? weightName(weightClass) : null);

export const noMargin = (odds: UfcOdds) => {
  const a = impliedProbability(odds.aMoneyline);
  const b = impliedProbability(odds.bMoneyline);
  return a / (a + b);
};

/** The forecast for A: the ratings, leaning on the market where there's a line. */
export function publishedChance(ratingsA: number, marketA: number | null) {
  return marketA === null ? ratingsA : blendProbability(ratingsA, marketA, RATINGS_SHARE);
}

const decided = (b: UfcBout) => b.a.winner === true || b.b.winner === true;

/** Whether a card is on now or about to be: the window when everything is read every minute. */
export function fightNight(events: UfcEvent[], now: number) {
  return events.some((e) => {
    const start = Date.parse(e.date);
    return now > start - 3_600_000 && now < start + 9 * 3_600_000;
  });
}

export async function buildUfcModel(now = new Date()): Promise<UfcModel> {
  const generatedAt = now.toISOString();
  const t = now.getTime();
  const events = await getUfcEvents(now, state.live ? 60_000 : 5 * 60_000);
  state.live = fightNight(events, t);
  const bouts = events.flatMap((e) => e.bouts);
  const eventsById = new Map(events.map((e) => [e.id, e]));
  const boutsById = new Map(bouts.map((b) => [b.id, b]));

  // Lines: every fight still to come (read again every 10 minutes near the fight, hourly before), and a share
  // of past fights' closing lines each build until history is filled in.
  // (A few old cards were never marked finished in ESPN's feed: only recent ones count as coming up.)
  const upcoming = events.filter((e) => e.bouts.some((b) => b.state !== 'post') && Date.parse(e.date) > t - 2 * 86_400_000);
  const odds = new Map<string, UfcOdds>();
  const add = (lines: Record<string, UfcOdds | null>) => {
    for (const [id, o] of Object.entries(lines)) if (o) odds.set(id, o);
  };
  for (const e of upcoming) {
    const soon = Date.parse(e.date) - t < 2 * 86_400_000;
    add(await getUfcOdds(e, { left: Infinity }, soon ? 10 * 60_000 : 60 * 60_000, t).catch(() => ({})));
  }
  const budget = { left: HISTORY_ODDS_PER_BUILD };
  for (const e of [...events].reverse()) {
    if (e.date < UFC_TEST_FROM || upcoming.includes(e)) continue;
    add(await getUfcOdds(e, budget, Infinity, t).catch(() => ({})));
  }

  // Ratings through every finished fight.
  const { fighters: ratings, rated } = rateFights(bouts, UFC_ELO);

  // Profiles (the latest listing of each fighter), divisions and fight lists.
  const profiles = new Map<string, UfcFighter>();
  const divisions = new Map<string, string>();
  const boutsByFighter = new Map<string, UfcBout[]>();
  for (const b of [...bouts].sort((x, y) => x.date.localeCompare(y.date))) {
    for (const f of [b.a, b.b]) {
      profiles.set(f.id, f);
      const division = divisionOf(b.weightClass);
      if (division) divisions.set(f.id, division);
      boutsByFighter.set(f.id, [b, ...(boutsByFighter.get(f.id) ?? [])]);
    }
  }
  const fighters = new Map<string, UfcFighterView>();
  for (const [id, profile] of profiles) {
    const r = ratings.get(id);
    const lastFight = r?.last ?? null;
    const endings = { stoppageWins: 0, decisionWins: 0, stoppageLosses: 0, decisionLosses: 0 };
    for (const b of boutsByFighter.get(id) ?? []) {
      if (!b.completed || !decided(b)) continue;
      const won = (b.a.id === id ? b.a : b.b).winner === true;
      const stopped = wasStopped(b);
      if (won) endings[stopped ? 'stoppageWins' : 'decisionWins'] += 1;
      else endings[stopped ? 'stoppageLosses' : 'decisionLosses'] += 1;
    }
    fighters.set(id, {
      endings,
      profile,
      rating: r?.rating ?? UFC_ELO.debut,
      peak: r?.peak ?? UFC_ELO.debut,
      fights: r?.fights ?? 0,
      wins: r?.wins ?? 0,
      losses: r?.losses ?? 0,
      draws: r?.draws ?? 0,
      noContests: r?.noContests ?? 0,
      division: divisions.get(id) ?? null,
      active: !!lastFight && t - Date.parse(lastFight) < ACTIVE_MS,
      rank: null,
      lastFight
    });
  }
  const byDivision = new Map<string, UfcFighterView[]>();
  for (const f of fighters.values()) {
    if (!f.active || !f.division || f.fights < RANKED_MIN_FIGHTS) continue;
    byDivision.set(f.division, [...(byDivision.get(f.division) ?? []), f]);
  }
  const divisionList = [...byDivision]
    .map(([name, list]) => {
      list.sort((x, y) => y.rating - x.rating);
      list.forEach((f, i) => (f.rank = i + 1));
      return { name, fighters: list };
    })
    .sort((x, y) => {
      const ix = DIVISION_ORDER.indexOf(x.name);
      const iy = DIVISION_ORDER.indexOf(y.name);
      return (ix < 0 ? 99 : ix) - (iy < 0 ? 99 : iy) || x.name.localeCompare(y.name);
    });

  // A forecast for every fight: before it for finished ones, as of now for the rest.
  const forecasts = new Map<string, UfcForecast>();
  const toLog: UfcLedger = {};
  for (const b of bouts) {
    const before = rated.get(b.id);
    const ratingA = before?.ratingA ?? fighters.get(b.a.id)?.rating ?? UFC_ELO.debut;
    const ratingB = before?.ratingB ?? fighters.get(b.b.id)?.rating ?? UFC_ELO.debut;
    const ratingsA = before?.chanceA ?? winChance(ratingA, ratingB);
    const line = odds.get(b.id) ?? null;
    const marketA = line ? noMargin(line) : null;
    const chanceA = publishedChance(ratingsA, marketA);
    forecasts.set(b.id, { chanceA, ratingsA, marketA, odds: line, ratingA, ratingB });
    if (b.state === 'pre' && Date.parse(b.date) > t) {
      toLog[b.id] = { takenAt: generatedAt, eventId: b.eventId, date: b.date, aId: b.a.id, bId: b.b.id, chanceA, ratingsA, marketA };
    }
  }
  await logUfcForecasts(toLog);
  const ledger = await readUfcLedger();

  // The record: the backtest years, then the forward one.
  const graded = bouts.filter((b) => b.completed && decided(b) && b.date >= UFC_TEST_FROM);
  const outcome = (b: UfcBout, p: number): Outcome => ({ homeProb: p, homeWon: b.a.winner === true });
  const lined = graded.filter((b) => forecasts.get(b.id)?.marketA !== null);
  const liveGraded = Object.entries(ledger)
    .map(([id, entry]) => ({ id, entry, bout: boutsById.get(id) }))
    .filter((x): x is { id: string; entry: (typeof ledger)[string]; bout: UfcBout } => !!x.bout && x.bout.completed && decided(x.bout))
    .sort((x, y) => y.bout.date.localeCompare(x.bout.date));
  const record: UfcRecord = {
    ratings: summarize(graded.map((b) => outcome(b, forecasts.get(b.id)!.ratingsA))),
    withLines: {
      ratings: summarize(lined.map((b) => outcome(b, forecasts.get(b.id)!.ratingsA))),
      market: summarize(lined.map((b) => outcome(b, forecasts.get(b.id)!.marketA!))),
      published: summarize(lined.map((b) => outcome(b, forecasts.get(b.id)!.chanceA)))
    },
    live: summarize(liveGraded.map((x) => outcome(x.bout, x.entry.chanceA))),
    liveRecent: liveGraded.slice(0, 20).map((x) => ({ boutId: x.id, chanceA: x.entry.chanceA, aWon: x.bout.a.winner === true }))
  };
  const favorites: FavoriteBand[] = BAND_EDGES.slice(0, -1).map((lo, i) => {
    const hi = BAND_EDGES[i + 1];
    const inBand = lined
      .map((b) => {
        const m = forecasts.get(b.id)!.marketA!;
        return { fav: Math.max(m, 1 - m), won: m >= 0.5 ? b.a.winner === true : b.b.winner === true };
      })
      .filter((x) => x.fav >= lo && x.fav < hi);
    const n = inBand.length;
    return { lo, hi: Math.min(1, hi), fights: n, said: n ? inBand.reduce((s, x) => s + x.fav, 0) / n : 0, won: n ? inBand.filter((x) => x.won).length / n : 0 };
  });

  return {
    generatedAt,
    events,
    eventsById,
    boutsById,
    fighters,
    boutsByFighter,
    forecasts,
    upcoming: upcoming.sort((x, y) => x.date.localeCompare(y.date)),
    recent: events.filter((e) => !upcoming.includes(e) && e.bouts.some((b) => b.completed)).slice(-6).reverse(),
    divisions: divisionList,
    record,
    favorites,
    ledger
  };
}

type State = { model: UfcModel | null; builtAt: number; building: Promise<UfcModel> | null; live: boolean };
const shared = globalThis as typeof globalThis & { __scUfc?: State };
const state: State = (shared.__scUfc ??= { model: null, builtAt: 0, building: null, live: false });

/**
 * The current model: rebuilt in the background once it's 10 minutes old (1 minute on fight nights), so a page
 * never waits on a rebuild after the first. `fresh` waits for a new one (the refresher's way to lock forecasts).
 * A failed rebuild keeps serving the last good model.
 */
export async function getUfcModel({ fresh = false }: { fresh?: boolean } = {}): Promise<UfcModel> {
  const rebuild = () =>
    (state.building ??= buildUfcModel()
      .then((model) => {
        state.model = model;
        state.builtAt = Date.now();
        return model;
      })
      .catch((error) => {
        if (state.model) return state.model;
        throw error;
      })
      .finally(() => {
        state.building = null;
      }));
  if (fresh || !state.model) return rebuild();
  const maxAge = state.live ? 60_000 : 10 * 60_000;
  if (Date.now() - state.builtAt > maxAge) rebuild().catch(() => undefined);
  return state.model;
}

/** The model if one is built (starting a build if not, or if it's stale), without waiting: for pages where UFC is a side note. */
export function peekUfcModel(): UfcModel | null {
  getUfcModel().catch(() => undefined);
  return state.model;
}

/**
 * The chance to show for fighter A: the forecast locked before the fight when there is one (what the site
 * said), else the current forecast (for a finished fight, the closing line's).
 */
export function shownChance(model: UfcModel, boutId: string) {
  const locked = model.ledger[boutId];
  const forecast = model.forecasts.get(boutId);
  return { chanceA: locked?.chanceA ?? forecast?.chanceA ?? 0.5, locked: !!locked, fromMarket: locked ? locked.marketA !== null : forecast?.marketA != null };
}

/** Whether the forecast called a finished fight right: null before it's over, in a draw, or at exactly even. */
export function calledIt(bout: UfcBout, chanceA: number) {
  if (!bout.completed || (bout.a.winner !== true && bout.b.winner !== true) || chanceA === 0.5) return null;
  return chanceA > 0.5 === (bout.a.winner === true);
}

/** "Main event", "Co-main event", or null, by place on the card. */
export function cardSpot(bout: UfcBout, event: UfcEvent) {
  const last = Math.max(...event.bouts.map((b) => b.order));
  if (bout.order === last) return 'Main event';
  if (bout.order === last - 1 && event.bouts.length > 2) return 'Co-main event';
  return null;
}

/** Fighters with a page worth listing: anyone active, or with 3+ UFC fights. */
export const listedFighters = (model: UfcModel) => [...model.fighters.entries()].filter(([, f]) => f.active || f.fights >= RANKED_MIN_FIGHTS);
