// ESPN's own game forecasts, read before each game and locked, so ours can be graded
// against them on the same games. It has to be done going forward: ESPN re-saves its
// past values after games (an October 2024 game was last modified in June 2025), so
// looking them up later could compare us with numbers written after the fact.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { cached } from '../cache';
import type { Game } from '../espn';
import type { LeagueConfig, LeagueId } from '../leagues';
import { Metrics, Outcome, summarize } from './metrics';

export type EspnEntry = { homeProb: number; takenAt: string; start: string };
export type EspnLedger = Record<string, EspnEntry>;

/** The head-to-head so far: both forecasts, on games where both were on file before the start. */
export type EspnRecord = { games: number; ours: Metrics; espn: Metrics; since: string | null };

const DIR = path.join(process.cwd(), '.cache', 'espn-ledger');
const fileFor = (league: LeagueId) => path.join(DIR, `${league}.json`);
/** ESPN publishes these for the NBA, NFL and MLB; its feed refuses NHL games. */
const COVERED: LeagueId[] = ['nba', 'nfl', 'mlb'];
/** Read this long before a game, and again until it starts: what counts is the last reading before the start. */
const WINDOW_MS = 24 * 3_600_000;
const MOST_READS = 40;

export const hasEspnForecasts = (league: Pick<LeagueConfig, 'id'>) => COVERED.includes(league.id);

/** The home team's chance from ESPN's predictor, ties set aside; null when it isn't there or doesn't make sense. */
export function parseEspnForecast(data: any): number | null {
  const projection = (side: any) => {
    const stat = (side?.statistics ?? []).find((s: any) => s?.name === 'gameProjection');
    const value = Number(stat?.value ?? stat?.displayValue);
    return Number.isFinite(value) && value >= 0 && value <= 100 ? value : null;
  };
  const home = projection(data?.homeTeam);
  const away = projection(data?.awayTeam);
  // One side is sometimes left empty; the other's figure says the same thing.
  const homeShare = home !== null && away !== null ? (home + away > 0 ? home / (home + away) : null) : home !== null ? home / 100 : away !== null ? 1 - away / 100 : null;
  return homeShare !== null && homeShare > 0 && homeShare < 1 ? homeShare : null;
}

function fetchEspnForecast(league: LeagueConfig, gameId: string) {
  const [sport, slug] = league.espnPath.split('/');
  return cached(`espn-${league.id}-forecast-${gameId}`, { ttlMs: 20 * 60_000 }, async () => {
    const res = await fetch(`https://sports.core.api.espn.com/v2/sports/${sport}/leagues/${slug}/events/${gameId}/competitions/${gameId}/predictor?lang=en&region=us`, {
      cache: 'no-store',
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(15_000)
    });
    return res.ok ? parseEspnForecast(await res.json()) : null;
  });
}

export async function readEspnLedger(league: LeagueId): Promise<EspnLedger> {
  try {
    return JSON.parse(await fs.readFile(fileFor(league), 'utf8')) as EspnLedger;
  } catch {
    return {};
  }
}

async function writeEspnLedger(league: LeagueId, ledger: EspnLedger) {
  try {
    await fs.mkdir(DIR, { recursive: true });
    const tmp = `${fileFor(league)}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(ledger));
    await fs.rename(tmp, fileFor(league));
  } catch {
    // Without a writable disk the site still works; the head-to-head just doesn't grow.
  }
}

/** The games to read now: ones that haven't started and start within the window, soonest first. */
export function gamesToRead<G extends Pick<Game, 'date' | 'state'>>(games: G[], now: Date) {
  return games
    .filter((g) => {
      const until = Date.parse(g.date) - now.getTime();
      return g.state === 'pre' && until > 0 && until <= WINDOW_MS;
    })
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, MOST_READS);
}

/** Takes in new readings. A reading after a game's start never counts, and a game that has started keeps what it had. */
export function withReadings(ledger: EspnLedger, readings: { game: Pick<Game, 'id' | 'date'>; homeProb: number | null }[], now: Date): EspnLedger {
  const next = { ...ledger };
  for (const { game, homeProb } of readings) {
    if (homeProb === null || now.getTime() >= Date.parse(game.date)) continue;
    next[game.id] = { homeProb, takenAt: now.toISOString(), start: game.date };
  }
  return next;
}

/** Reads ESPN's number for the games coming up and adds it to the ledger. Quietly does nothing if the feed is down. */
export async function recordEspnForecasts(league: LeagueConfig, games: Game[], now: Date): Promise<EspnLedger> {
  const ledger = await readEspnLedger(league.id);
  if (!hasEspnForecasts(league)) return ledger;
  const coming = gamesToRead(games, now);
  if (!coming.length) return ledger;
  const readings = await Promise.all(coming.map(async (game) => ({ game, homeProb: await fetchEspnForecast(league, game.id).catch(() => null) })));
  const next = withReadings(ledger, readings, now);
  if (readings.some((r) => r.homeProb !== null)) await writeEspnLedger(league.id, next);
  return next;
}

/** Both forecasts graded on the games where both were locked before the start. Ties grade nothing. */
export function espnHeadToHead(games: Game[], espn: EspnLedger, ours: Record<string, { homeProb: number }>): EspnRecord | null {
  const mine: Outcome[] = [];
  const theirs: Outcome[] = [];
  for (const g of games) {
    const e = espn[g.id];
    const o = ours[g.id];
    if (!e || !o || !g.completed || g.home.score === null || g.away.score === null || g.home.score === g.away.score) continue;
    const homeWon = g.home.score > g.away.score;
    mine.push({ homeProb: o.homeProb, homeWon });
    theirs.push({ homeProb: e.homeProb, homeWon });
  }
  const logged = Object.values(espn).map((e) => e.takenAt).sort();
  if (!logged.length) return null;
  return { games: mine.length, ours: summarize(mine), espn: summarize(theirs), since: logged[0] };
}
