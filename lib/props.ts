// Sportsbook player-prop lines: their shape and the math on them. Fetching lives
// in propFeed.ts, so this file is safe to use in the browser too.
import type { LeagueConfig } from './leagues';

/**
 * Prop markets across leagues. `pts` and `ast` mean points and assists in
 * whichever sport the line is from (a hockey point is a goal or an assist).
 */
export type PropMarket =
  | 'pts'
  | 'reb'
  | 'ast'
  | 'pra'
  | 'pr'
  | 'pa'
  | 'ar'
  | 'stl'
  | 'blk'
  | 'tov'
  | 'goals'
  | 'sog'
  | 'saves'
  | 'pass_yds'
  | 'pass_cmp'
  | 'pass_att'
  | 'pass_td'
  | 'pass_int'
  | 'pass_rush_yds'
  | 'rush_yds'
  | 'rush_att'
  | 'rec_yds'
  | 'rec'
  | 'rush_rec_yds';

type Label = { short: string; long: string };

const LABELS: Record<PropMarket, Label> = {
  pts: { short: 'Points', long: 'points' },
  reb: { short: 'Rebounds', long: 'rebounds' },
  ast: { short: 'Assists', long: 'assists' },
  pra: { short: 'Pts+Reb+Ast', long: 'points + rebounds + assists' },
  pr: { short: 'Pts+Reb', long: 'points + rebounds' },
  pa: { short: 'Pts+Ast', long: 'points + assists' },
  ar: { short: 'Reb+Ast', long: 'rebounds + assists' },
  stl: { short: 'Steals', long: 'steals' },
  blk: { short: 'Blocks', long: 'blocks' },
  tov: { short: 'Turnovers', long: 'turnovers' },
  goals: { short: 'Goals', long: 'goals' },
  sog: { short: 'Shots on goal', long: 'shots on goal' },
  saves: { short: 'Saves', long: 'saves' },
  pass_yds: { short: 'Pass yds', long: 'passing yards' },
  pass_cmp: { short: 'Completions', long: 'completions' },
  pass_att: { short: 'Pass att', long: 'pass attempts' },
  pass_td: { short: 'Pass TDs', long: 'passing touchdowns' },
  pass_int: { short: 'Interceptions', long: 'interceptions thrown' },
  pass_rush_yds: { short: 'Pass+Rush yds', long: 'passing + rushing yards' },
  rush_yds: { short: 'Rush yds', long: 'rushing yards' },
  rush_att: { short: 'Carries', long: 'carries' },
  rec_yds: { short: 'Rec yds', long: 'receiving yards' },
  rec: { short: 'Receptions', long: 'receptions' },
  rush_rec_yds: { short: 'Rush+Rec yds', long: 'rushing + receiving yards' }
};

export const isPropMarket = (m: string): m is PropMarket => Object.prototype.hasOwnProperty.call(LABELS, m);

/** A market's name in the league's own terms. */
export function marketLabel(market: PropMarket): Label {
  return LABELS[market];
}

/**
 * One over/under offer: the line and both prices in American odds, latest and
 * as first posted (the opening numbers are null when the book didn't keep them).
 * Prices are null when the feed carries the line without them (DraftKings'
 * football props): the line is then read as the book's 50/50 point, and it's
 * never graded.
 */
export type PropLine = {
  athleteId: string;
  market: PropMarket;
  line: number;
  over: number | null;
  under: number | null;
  book: string;
  open: { line: number; over: number; under: number } | null;
};

/** A line with both prices, which is the only kind that can be graded or bet on as priced. */
export type PricedLine = PropLine & { over: number; under: number };
export const isPriced = (line: PropLine): line is PricedLine => line.over !== null && line.under !== null;

/** ESPN's market names per league. NFL names carry "(incl. overtime)", which is stripped before lookup. */
const MARKETS: Record<'nba' | 'nhl' | 'nfl', Record<string, PropMarket>> = {
  nba: {
    'Total Points': 'pts',
    'Total Rebounds': 'reb',
    'Total Assists': 'ast',
    'Total Points, Rebounds, and Assists': 'pra',
    'Total Points and Rebounds': 'pr',
    'Total Points and Assists': 'pa',
    'Total Assists and Rebounds': 'ar',
    'Total Steals': 'stl',
    'Total Blocks': 'blk',
    'Total Turnovers': 'tov'
  },
  nhl: {
    'Total Points': 'pts',
    'Total Assists': 'ast',
    'Total Goals': 'goals',
    'Total Shots on Goal': 'sog',
    'Total Blocked Shots': 'blk',
    'Total Saves': 'saves'
  },
  nfl: {
    'Total Passing Yards': 'pass_yds',
    'Total Pass Completions': 'pass_cmp',
    'Total Passing Attempts': 'pass_att',
    'Total Passing Touchdowns': 'pass_td',
    'Total Passing Interceptions': 'pass_int',
    'Total Passing Plus Rushing Yards': 'pass_rush_yds',
    'Total Rushing Yards': 'rush_yds',
    'Total Carries': 'rush_att',
    'Total Rushing Attempts': 'rush_att',
    'Total Receiving Yards': 'rec_yds',
    'Total Receptions': 'rec',
    'Total Rushing Plus Receiving Yards': 'rush_rec_yds'
  }
};

const marketFor = (league: string, name: unknown) => {
  const table = MARKETS[league as keyof typeof MARKETS];
  return table?.[String(name ?? '').replace(/\s*\(incl\. overtime\)\s*$/i, '')];
};

/**
 * Provider ids in ESPN's feed. ESPN BET labels each side. DraftKings doesn't,
 * and lists the over first: checked on 1,497 finished pairs, the first price's
 * favorite went over 59% of the time and the second's 41%.
 */
export const BOOKS = [
  { id: '100', name: 'DraftKings', overFirst: true },
  { id: '58', name: 'ESPN BET', overFirst: false }
] as const;
export type Book = (typeof BOOKS)[number];

/** Leagues with a player-projection model to grade against these lines. */
export const PROP_LEAGUES = ['nba', 'nhl', 'nfl'] as const;
export const hasPropModel = (league: Pick<LeagueConfig, 'id'>) => (PROP_LEAGUES as readonly string[]).includes(league.id);

const price = (value: unknown) => {
  const n = Number.parseFloat(String(value ?? '').replace('+', ''));
  return Number.isFinite(n) && n !== 0 ? n : null;
};

/** Over/under pairs from one book's prop list; one-sided and unpriced offers are dropped. */
export function parseProps(items: any[], book: Book, league: string): PropLine[] {
  const groups = new Map<
    string,
    { side: 'over' | 'under' | null; price: number | null; openPrice: number | null; openLine: number; athleteId: string; market: PropMarket; line: number }[]
  >();
  for (const item of items) {
    const market = marketFor(league, item?.type?.name);
    const athleteId = String(item?.athlete?.$ref ?? '').match(/athletes\/(\d+)/)?.[1];
    const line = Number(item?.current?.target?.value ?? item?.odds?.total?.value);
    const side = item?.current?.over ? 'over' : item?.current?.under ? 'under' : null;
    // Some feeds (ESPN BET's football props) only carry the price inside the side's own label.
    const american = price(item?.odds?.american?.value) ?? (side ? price(item.current[side]?.american) : null);
    if (!market || !athleteId || !Number.isFinite(line)) continue;
    const openLine = Number(item?.open?.target?.value ?? item?.odds?.total?.open);
    const openPrice = price(item?.odds?.american?.open) ?? (side ? price(item?.open?.[side]?.american) : null);
    const key = `${athleteId}|${market}|${line}`;
    groups.set(key, [...(groups.get(key) ?? []), { side, price: american, openPrice, openLine: Number.isFinite(openLine) ? openLine : line, athleteId, market, line }]);
  }
  const lines: PropLine[] = [];
  for (const entries of groups.values()) {
    if (entries.length !== 2) continue;
    let over = entries.find((e) => e.side === 'over');
    let under = entries.find((e) => e.side === 'under');
    if ((!over || !under) && book.overFirst && entries.every((e) => e.side === null)) [over, under] = entries;
    if (!over || !under) continue;
    // Both prices or neither: a half-priced pair can't be read either way.
    if ((over.price === null) !== (under.price === null)) continue;
    const open =
      over.openPrice !== null && under.openPrice !== null && over.openLine === under.openLine
        ? { line: over.openLine, over: over.openPrice, under: under.openPrice }
        : null;
    lines.push({ athleteId: over.athleteId, market: over.market, line: over.line, over: over.price, under: under.price, book: book.name, open });
  }
  return lines;
}

/** Implied probability of an American price, bookmaker's margin included. */
export function impliedFromAmerican(american: number) {
  return american < 0 ? -american / (-american + 100) : 100 / (american + 100);
}

/** What one unit returns in profit at an American price. */
export function profitPerUnit(american: number) {
  return american > 0 ? american / 100 : 100 / -american;
}

/** The book's over probability with its margin removed; a line posted without prices counts as its 50/50 point. */
export function fairOver(line: Pick<PropLine, 'over' | 'under'>) {
  if (line.over === null || line.under === null) return 0.5;
  const o = impliedFromAmerican(line.over);
  const u = impliedFromAmerican(line.under);
  return o / (o + u);
}

/** Each player's main line per market: the offer priced closest to even. */
export function mainLines(lines: PropLine[]) {
  const best = new Map<string, PropLine>();
  for (const l of lines) {
    const key = `${l.athleteId}|${l.market}`;
    const current = best.get(key);
    if (!current || Math.abs(fairOver(l) - 0.5) < Math.abs(fairOver(current) - 0.5)) best.set(key, l);
  }
  return [...best.values()];
}
