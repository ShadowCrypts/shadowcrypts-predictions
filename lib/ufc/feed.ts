// UFC fight cards, results and betting lines from ESPN's public feeds. ESPN payloads are untyped JSON
// (`any`); everything is narrowed in the parse* functions. Parsing is pure and tested on its own.
import { cached, limiter, readStore, writeStore } from '../cache';
import { fetchJson } from '../espn';

const BASE = 'https://site.api.espn.com/apis/site/v2/sports/mma/ufc';
const CORE = 'https://sports.core.api.espn.com/v2/sports/mma/leagues/ufc';
// Bump when the parsed shapes change so stored years are read again.
const VERSION = 'v2';
/** The first year read: the start of the modern era, with the unified rules and weight classes in place. */
export const FIRST_YEAR = 2001;
const oddsLane = limiter(6);

export type UfcState = 'pre' | 'in' | 'post';

export type UfcFighter = {
  id: string;
  name: string;
  shortName: string;
  country: string | null;
  flag: string | null;
  /** The pro record ESPN lists for the fighter now (all promotions), like "24-8-0". */
  listedRecord: string | null;
  /** Null until the fight is over (and for both in a draw or no contest). */
  winner: boolean | null;
};

export type UfcBout = {
  id: string;
  eventId: string;
  date: string;
  /** Place on the card: 1 opens the night, the highest is the main event. */
  order: number;
  weightClass: string | null;
  /** Scheduled rounds: 3, or 5 for main events and title fights. */
  rounds: number;
  state: UfcState;
  completed: boolean;
  /** The round it ended in (or is in), and the time into that round. */
  round: number | null;
  clock: string | null;
  /** ESPN lists the fighters in an order; the first is the "home" side of the betting line. */
  a: UfcFighter;
  b: UfcFighter;
};

export type UfcEvent = { id: string; name: string; shortName: string; date: string; venue: string | null; city: string | null; bouts: UfcBout[] };

export type UfcOdds = {
  provider: string;
  aMoneyline: number;
  bMoneyline: number;
};

const str = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : null);
const num = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value)) ? Number(value) : null);

function parseFighter(raw: any, completed: boolean): UfcFighter | null {
  const id = str(String(raw?.id ?? raw?.athlete?.id ?? ''));
  const name = str(raw?.athlete?.displayName) ?? str(raw?.athlete?.fullName);
  if (!id || !/^\d+$/.test(id) || !name) return null;
  return {
    id,
    name,
    shortName: str(raw?.athlete?.shortName) ?? name,
    country: str(raw?.athlete?.flag?.alt),
    flag: str(raw?.athlete?.flag?.href),
    listedRecord: str((raw?.records ?? []).find((r: any) => r?.type === 'total' || r?.name === 'overall')?.summary),
    winner: completed && typeof raw?.winner === 'boolean' ? raw.winner : null
  };
}

export function parseBout(eventId: string, raw: any, index: number): UfcBout | null {
  const id = str(String(raw?.id ?? ''));
  if (!id || !/^\d+$/.test(id)) return null;
  const type = raw?.status?.type ?? {};
  const completed = type.completed === true;
  const state: UfcState = type.state === 'in' ? 'in' : type.state === 'post' || completed ? 'post' : 'pre';
  const list: any[] = raw?.competitors ?? [];
  const first = list.find((c) => c?.order === 1) ?? list[0];
  const second = list.find((c) => c?.order === 2) ?? list.find((c) => c !== first);
  const a = parseFighter(first, completed);
  const b = parseFighter(second, completed);
  if (!a || !b || a.id === b.id) return null;
  // Both marked winners, or one marked with the fight not over, is a feed error: no result.
  if (a.winner && b.winner) a.winner = b.winner = null;
  const rounds = num(raw?.format?.regulation?.periods);
  const period = num(raw?.status?.period);
  return {
    id,
    eventId,
    date: str(raw?.date) ?? str(raw?.startDate) ?? '',
    order: index + 1,
    weightClass: str(raw?.type?.abbreviation),
    rounds: rounds === 5 ? 5 : 3,
    state,
    completed,
    round: state === 'pre' || !period ? null : period,
    clock: state === 'pre' ? null : str(raw?.status?.displayClock),
    a,
    b
  };
}

export function parseEvent(raw: any): UfcEvent | null {
  const id = str(String(raw?.id ?? ''));
  const name = str(raw?.name);
  if (!id || !/^\d+$/.test(id) || !name) return null;
  const competitions: any[] = Array.isArray(raw?.competitions) ? raw.competitions : [];
  const bouts = competitions.map((c, i) => parseBout(id, c, i)).filter((b): b is UfcBout => b !== null);
  const venue = competitions[competitions.length - 1]?.venue ?? raw?.venues?.[0];
  const address = venue?.address ?? {};
  return {
    id,
    name,
    shortName: str(raw?.shortName) ?? name,
    date: str(raw?.date) ?? bouts[bouts.length - 1]?.date ?? '',
    venue: str(venue?.fullName),
    city: [str(address.city), str(address.state) ?? str(address.country)].filter(Boolean).join(', ') || null,
    bouts
  };
}

/** ESPN's UFC schedule also carries Dana White's Contender Series, tryouts for a contract: not UFC fights. */
export const isUfcCard = (name: string) => !/contender series/i.test(name);

export function parseSeason(data: any): UfcEvent[] {
  return (Array.isArray(data?.events) ? data.events : [])
    .map(parseEvent)
    .filter((e: UfcEvent | null): e is UfcEvent => e !== null && e.bouts.length > 0 && isUfcCard(e.name));
}

/**
 * How a finished fight ended, from the round and clock it stopped at: the scheduled distance means the
 * judges decided it. (ESPN's scoreboard doesn't say knockout or submission.)
 */
export function boutEnding(bout: Pick<UfcBout, 'completed' | 'round' | 'clock' | 'rounds' | 'a' | 'b'>) {
  if (!bout.completed) return null;
  // (In a draw ESPN marks both as not the winner: someone has to have won.)
  const decided = bout.a.winner === true || bout.b.winner === true;
  if (bout.round === bout.rounds && bout.clock === '5:00') return decided ? 'Decision' : 'Draw';
  if (!decided) return 'Draw or no contest';
  return bout.round && bout.clock ? `Stoppage, round ${bout.round} (${bout.clock})` : 'Stoppage';
}

/** A year of UFC events. Past years are final once read; this year's and next are read again after `ttlMs`. */
export function getUfcYear(year: number, now = new Date(), ttlMs = 5 * 60_000) {
  const current = year >= now.getUTCFullYear();
  return cached(
    `espn-ufc-${VERSION}-${year}`,
    {
      ttlMs: current ? ttlMs : 24 * 3_600_000,
      persist: true,
      // A past year is over once every fight on it is: nothing more to read.
      isFinal: (events: UfcEvent[]) => !current && events.every((e) => e.bouts.every((b) => b.state === 'post')),
      staleWhileRevalidate: current
    },
    async () => parseSeason(await fetchJson(`${BASE}/scoreboard?dates=${year}&limit=200`))
  );
}

/** Every UFC event from FIRST_YEAR through next year's announced cards, oldest first. `ttlMs` is how fresh this year's must be. */
export async function getUfcEvents(now = new Date(), ttlMs?: number) {
  const years: number[] = [];
  for (let y = FIRST_YEAR; y <= now.getUTCFullYear() + 1; y += 1) years.push(y);
  const seasons = await Promise.all(years.map((y) => getUfcYear(y, now, ttlMs).catch(() => [] as UfcEvent[])));
  const byId = new Map<string, UfcEvent>();
  for (const event of seasons.flat()) byId.set(event.id, event);
  return [...byId.values()].sort((x, y) => x.date.localeCompare(y.date));
}

export function parseUfcOdds(data: any): UfcOdds | null {
  const items: any[] = (data?.items ?? []).filter((item: any) => !/live/i.test(item?.provider?.name ?? '')).sort((x: any, y: any) => (x?.provider?.priority ?? 99) - (y?.provider?.priority ?? 99));
  for (const item of items) {
    // The closing price once a fight is over; the current one before.
    const a = num(item?.homeAthleteOdds?.close?.moneyLine?.american) ?? num(item?.homeAthleteOdds?.moneyLine);
    const b = num(item?.awayAthleteOdds?.close?.moneyLine?.american) ?? num(item?.awayAthleteOdds?.moneyLine);
    if (a !== null && b !== null && Math.abs(a) >= 100 && Math.abs(b) >= 100) return { provider: str(item?.provider?.name) ?? 'Sportsbook', aMoneyline: a, bMoneyline: b };
  }
  return null;
}

type OddsEntry = { odds: UfcOdds | null; at: number; final: boolean };

/**
 * Betting lines for an event's fights, one stored file per event. A finished fight's closing line is read once
 * and kept; an upcoming fight's is read again after `ttlMs`. `budget` caps how many are fetched in this call
 * (history fills in over several builds); `budget.left` goes down as it's spent.
 */
export async function getUfcOdds(event: UfcEvent, budget: { left: number }, ttlMs = 30 * 60_000, now = Date.now()) {
  const key = `espn-ufc-odds-${event.id}`;
  const store = (await readStore<Record<string, OddsEntry>>(key)) ?? {};
  const due = event.bouts.filter((b) => {
    const entry = store[b.id];
    if (!entry) return true;
    if (entry.final) return false;
    // Lines stop moving once a fight starts: read once more after it's over, then never again.
    return b.state === 'post' || now - entry.at > ttlMs;
  });
  const fetching = due.slice(0, Math.max(0, budget.left));
  budget.left -= fetching.length;
  if (fetching.length) {
    await Promise.all(
      fetching.map(async (b) => {
        try {
          const odds = parseUfcOdds(await fetchJson(`${CORE}/events/${event.id}/competitions/${b.id}/odds`, oddsLane));
          store[b.id] = { odds, at: now, final: b.state === 'post' };
        } catch {
          // Left for the next build.
        }
      })
    );
    await writeStore(key, store);
  }
  const out: Record<string, UfcOdds | null> = {};
  for (const b of event.bouts) if (b.id in store) out[b.id] = store[b.id].odds;
  return out;
}
