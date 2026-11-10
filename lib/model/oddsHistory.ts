import { promises as fs } from 'fs';
import path from 'path';
import type { LeagueId } from '../leagues';

/**
 * Each team's playoff and title chances, one reading per day (the day's
 * latest), so team pages can chart how a season's odds moved. Written after
 * every season simulation; the site and the refresher can both write it.
 */
export type OddsPoint = { date: string; playoffs: number; title: number };
/** Season label → team id → readings, oldest first. */
export type OddsHistory = Record<string, Record<string, OddsPoint[]>>;

const DIR = path.join(process.cwd(), '.cache', 'odds-history');
const fileFor = (league: LeagueId) => path.join(DIR, `${league}.json`);
/** Seasons kept: this one and the last. */
const SEASONS_KEPT = 2;

export async function readOddsHistory(league: LeagueId): Promise<OddsHistory> {
  try {
    return JSON.parse(await fs.readFile(fileFor(league), 'utf8')) as OddsHistory;
  } catch {
    return {};
  }
}

/** The history with today's readings in: one per team per day, the latest replacing an earlier one that day. */
export function withReadings(history: OddsHistory, season: string, date: string, teams: { id: string; playoffs: number; title: number }[]): OddsHistory {
  const bySeason = { ...(history[season] ?? {}) };
  for (const t of teams) {
    const points = (bySeason[t.id] ?? []).filter((p) => p.date !== date);
    points.push({ date, playoffs: Number(t.playoffs.toFixed(4)), title: Number(t.title.toFixed(4)) });
    points.sort((a, b) => a.date.localeCompare(b.date));
    bySeason[t.id] = points;
  }
  const next = { ...history, [season]: bySeason };
  // Only the latest few seasons.
  const keep = Object.keys(next).sort().slice(-SEASONS_KEPT);
  return Object.fromEntries(keep.map((s) => [s, next[s]]));
}

export async function recordOdds(league: LeagueId, season: string, date: string, teams: { id: string; playoffs: number; title: number }[]) {
  try {
    const next = withReadings(await readOddsHistory(league), season, date, teams);
    await fs.mkdir(DIR, { recursive: true });
    const tmp = `${fileFor(league)}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(next));
    await fs.rename(tmp, fileFor(league));
  } catch {
    // A nice-to-have: without a writable disk there's just no chart.
  }
}
