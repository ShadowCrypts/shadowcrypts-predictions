// Pure, so the browser can use it too; the fetch is in standingsFeed.ts.
import type { LeagueId } from './leagues';

export type StandingRow = {
  teamId: string;
  abbr: string;
  name: string;
  logo: string | null;
  wins: number;
  losses: number;
  ties: number;
  otLosses: number;
  /** NHL standings points; null elsewhere (the feed's "points" means something else in the other leagues). */
  points: number | null;
  pct: number | null;
  /** The official conference seed, with the league's real tiebreakers; null when it isn't set. */
  seed: number | null;
  streak: string | null;
  pointsFor: number | null;
  pointsAgainst: number | null;
  /** "7-1", or "7-1-0" in the NHL. */
  home: string | null;
  road: string | null;
  lastTen: string | null;
};
export type StandingDivision = { name: string; rows: StandingRow[] };
export type StandingConference = { name: string; abbr: string; divisions: StandingDivision[]; rows: StandingRow[] };
export type LeagueStandings = { season: string; conferences: StandingConference[] };

const number = (value: unknown) => {
  const n = typeof value === 'number' ? value : Number(String(value ?? '').replace(/^\+/, ''));
  return Number.isFinite(n) && value !== '' && value !== null && value !== undefined ? n : null;
};

/** One team's line. Totals sit under `value`; records like "7-1" only in `displayValue` or `summary`. */
export function parseStandingRow(league: LeagueId, entry: any): StandingRow | null {
  const team = entry?.team;
  if (!team?.id) return null;
  const stats: any[] = entry?.stats ?? [];
  const stat = (name: string) => stats.find((s) => s?.name === name);
  const value = (name: string) => number(stat(name)?.value ?? stat(name)?.displayValue);
  const record = (...names: string[]) => {
    for (const name of names) {
      const found = stat(name);
      const text = found?.displayValue ?? found?.summary;
      // ("7-2-1, 0 PTS" in the NHL: the record is the part before the comma.)
      if (text) return String(text).split(',')[0].trim();
    }
    return null;
  };
  const seed = value('playoffSeed');
  return {
    teamId: String(team.id),
    abbr: team.abbreviation ?? '',
    name: team.shortDisplayName ?? team.name ?? team.displayName ?? '',
    logo: team.logos?.[0]?.href ?? null,
    wins: value('wins') ?? 0,
    losses: value('losses') ?? 0,
    ties: value('ties') ?? 0,
    otLosses: league === 'nhl' ? (value('otLosses') ?? 0) : 0,
    points: league === 'nhl' ? value('points') : null,
    pct: value('winPercent'),
    seed: seed !== null && seed > 0 ? seed : null,
    streak: stat('streak')?.displayValue || null,
    pointsFor: value('pointsFor'),
    pointsAgainst: value('pointsAgainst'),
    home: record('Home'),
    road: record('Road'),
    lastTen: record('Last Ten Games')
  };
}

/** Best first in a division: the feed's own order isn't the standings order (it can list a team 4.5 games back first). Level teams go by official seed. */
export function byRecord(league: LeagueId) {
  return (a: StandingRow, b: StandingRow) => {
    const first = league === 'nhl' ? (b.points ?? 0) - (a.points ?? 0) : (b.pct ?? 0) - (a.pct ?? 0);
    return first || (a.seed ?? 99) - (b.seed ?? 99) || a.name.localeCompare(b.name);
  };
}

/** A conference table runs by official seed, and anyone without one falls in behind by record. */
export function bySeed(league: LeagueId) {
  const record = byRecord(league);
  return (a: StandingRow, b: StandingRow) => (a.seed ?? 99) - (b.seed ?? 99) || record(a, b);
}

/** The feed at `level=3`: conferences, each with its divisions. */
export function parseStandings(league: LeagueId, data: any): LeagueStandings {
  const conferences = (data?.children ?? []).map((conference: any): StandingConference => {
    const divisions = (conference?.children ?? []).map((division: any): StandingDivision => {
      const rows = (division?.standings?.entries ?? []).map((e: any) => parseStandingRow(league, e)).filter((r: StandingRow | null): r is StandingRow => r !== null);
      return { name: division?.name ?? '', rows: rows.sort(byRecord(league)) };
    });
    return { name: conference?.name ?? '', abbr: conference?.abbreviation ?? conference?.name ?? '', divisions, rows: divisions.flatMap((d: StandingDivision) => d.rows).sort(bySeed(league)) };
  });
  const first = data?.children?.[0]?.children?.[0]?.standings;
  return { season: first?.seasonDisplayName ?? String(first?.season ?? ''), conferences };
}

/** Games behind a leader; zero or better reads as level. Null for leagues that don't count that way. */
export function gamesBehind(leader: Pick<StandingRow, 'wins' | 'losses'>, team: Pick<StandingRow, 'wins' | 'losses'>) {
  return (leader.wins - team.wins + (team.losses - leader.losses)) / 2;
}

/** Which seeds make it, for the line drawn across a conference table: the second number is the NBA's play-in. The NHL's field isn't a run of seeds, so it has its own table. */
export const PLAYOFF_LINES: Record<Exclude<LeagueId, 'nhl'>, number[]> = { nba: [6, 10], nfl: [7], mlb: [6] };

/** How many of the wild-card table get in. */
export const NHL_WILD_CARDS = 2;
const NHL_DIVISION_PLACES = 3;

/**
 * The NHL's real playoff picture: the top three in each division, then everyone else
 * in one table, of whom the top two get in. A conference's top eight by points isn't
 * the field: a strong division's sixth-best team can outscore another's third and miss.
 */
export function wildCardTables(conference: Pick<StandingConference, 'divisions'>): StandingDivision[] {
  const rest = conference.divisions.flatMap((d) => d.rows.slice(NHL_DIVISION_PLACES)).sort(byRecord('nhl'));
  return [...conference.divisions.map((d) => ({ name: d.name, rows: d.rows.slice(0, NHL_DIVISION_PLACES) })), { name: 'Wild card', rows: rest }];
}
