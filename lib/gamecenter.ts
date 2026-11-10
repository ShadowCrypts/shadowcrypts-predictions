// Top performers and plays for one game, from ESPN's game summary. Fetched only
// when a game page is opened: live games refresh every 30 seconds, finished
// games are cached for good.
import { cached } from './cache';
import type { LeagueConfig } from './leagues';

const BASE = 'https://site.api.espn.com/apis/site/v2/sports';

/** `id` is ESPN's athlete id (missing from game centers stored before it was kept). */
export type Performer = { category: string; name: string; value: string; id?: string | null };
export type TeamPerformers = { teamId: string; performers: Performer[] };
export type Play = { period: string; clock: string; text: string; awayScore: number | null; homeScore: number | null; teamId: string | null; scoring: boolean };
export type GameCenter = { leaders: TeamPerformers[]; scoring: Play[]; recent: Play[] };

const CATEGORY_LABELS: Record<string, string> = {
  points: 'Points',
  rebounds: 'Rebounds',
  assists: 'Assists',
  passingYards: 'Passing',
  rushingYards: 'Rushing',
  receivingYards: 'Receiving',
  goals: 'Goals',
  assistsLeader: 'Assists',
  pointsLeader: 'Points',
  goalieSaves: 'Saves',
  battingAverage: 'Batting',
  homeRuns: 'Home runs',
  RBIs: 'RBIs',
  pitching: 'Pitching'
};

/** "Q3", "P2", "OT", "2OT"; a regular-season NHL game's fifth period is its shootout ("SO"). */
const periodLabel = (league: LeagueConfig, n: number | undefined, regularSeason: boolean) => {
  if (!n) return '';
  if (league.id === 'mlb') return `${n}`;
  const regular = league.id === 'nhl' ? 3 : 4;
  if (league.id === 'nhl' && regularSeason && n === regular + 2) return 'SO';
  if (n > regular) return n - regular === 1 ? 'OT' : `${n - regular}OT`;
  return league.id === 'nhl' ? `P${n}` : `Q${n}`;
};

function parsePlay(league: LeagueConfig, raw: any, regularSeason: boolean): Play | null {
  const text = typeof raw?.text === 'string' ? raw.text.trim() : '';
  if (!text) return null;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  return {
    period: periodLabel(league, raw?.period?.number, regularSeason),
    clock: league.id === 'mlb' ? '' : raw?.clock?.displayValue ?? '',
    text,
    awayScore: num(raw?.awayScore),
    homeScore: num(raw?.homeScore),
    teamId: raw?.team?.id ? String(raw.team.id) : null,
    scoring: Boolean(raw?.scoringPlay)
  };
}

const athleteId = (a: any) => (/^\d{1,15}$/.test(String(a?.id ?? '')) ? String(a.id) : null);

/**
 * Baseball's summary names no leaders, so they come from the box score: each
 * team's best day at the plate (hits, with extra credit for home runs and runs
 * driven in) and whoever pitched the most innings.
 */
function baseballLeaders(data: any): TeamPerformers[] {
  return (data?.boxscore?.players ?? []).map((team: any) => {
    const group = (type: string) => (team?.statistics ?? []).find((s: any) => s?.type === type);
    const read = (g: any, a: any, key: string) => a?.stats?.[(g?.keys ?? []).indexOf(key)];
    const count = (g: any, a: any, key: string) => Number(read(g, a, key)) || 0;
    const performers: Performer[] = [];
    const batting = group('batting');
    const hitter = [...(batting?.athletes ?? [])]
      .filter((a: any) => a?.athlete?.displayName && a?.stats?.length)
      .sort((x: any, y: any) => {
        const score = (a: any) => count(batting, a, 'hits') + 3 * count(batting, a, 'homeRuns') + count(batting, a, 'RBIs');
        return score(y) - score(x);
      })[0];
    if (hitter) {
      const extras = [
        count(batting, hitter, 'homeRuns') ? `${count(batting, hitter, 'homeRuns')} HR` : '',
        count(batting, hitter, 'RBIs') ? `${count(batting, hitter, 'RBIs')} RBI` : ''
      ].filter(Boolean);
      performers.push({ category: 'Batting', name: hitter.athlete.displayName, value: [read(batting, hitter, 'hits-atBats'), ...extras].join(', '), id: athleteId(hitter.athlete) });
    }
    const pitching = group('pitching');
    const pitcher = [...(pitching?.athletes ?? [])]
      .filter((a: any) => a?.athlete?.displayName && a?.stats?.length)
      .sort((x: any, y: any) => count(pitching, y, 'fullInnings.partInnings') - count(pitching, x, 'fullInnings.partInnings'))[0];
    if (pitcher) {
      performers.push({
        category: 'Pitching',
        name: pitcher.athlete.displayName,
        value: `${read(pitching, pitcher, 'fullInnings.partInnings')} IP, ${count(pitching, pitcher, 'earnedRuns')} ER, ${count(pitching, pitcher, 'strikeouts')} K`,
        id: athleteId(pitcher.athlete)
      });
    }
    return { teamId: String(team?.team?.id ?? ''), performers };
  });
}

/**
 * Every play, oldest first. Football has no list of its own: its plays sit in
 * each drive, under the drive's team, with the game's clock markers among them.
 */
function allPlays(data: any): any[] {
  if (Array.isArray(data?.plays)) return data.plays;
  const drives = [...(data?.drives?.previous ?? []), ...(data?.drives?.current ? [data.drives.current] : [])];
  const seen = new Set<unknown>();
  return drives.flatMap((d: any) =>
    (d?.plays ?? []).flatMap((p: any) => {
      if (/^end\b/i.test(p?.type?.text ?? '') || seen.has(p?.id)) return [];
      seen.add(p?.id);
      return [{ ...p, team: p?.team ?? d?.team }];
    })
  );
}

export function parseGameCenter(league: LeagueConfig, data: any): GameCenter {
  const named: TeamPerformers[] = (data?.leaders ?? []).map((team: any) => ({
    teamId: String(team?.team?.id ?? ''),
    performers: (team?.leaders ?? [])
      .filter((c: any) => c?.leaders?.[0]?.athlete?.displayName && !/tackles|sacks/i.test(c?.name ?? ''))
      .slice(0, 3)
      .map((c: any) => ({
        category: CATEGORY_LABELS[c.name] ?? c.displayName ?? c.name,
        name: c.leaders[0].athlete.displayName,
        value: c.leaders[0].displayValue ?? '',
        id: athleteId(c.leaders[0].athlete)
      }))
  }));
  const leaders = named.length || league.id !== 'mlb' ? named : baseballLeaders(data);
  const regularSeason = data?.header?.season?.type === 2;
  const plays: Play[] = allPlays(data).map((p: any) => parsePlay(league, p, regularSeason)).filter((p: Play | null): p is Play => p !== null);
  // Football publishes scoring plays separately; elsewhere they're flagged in the play-by-play.
  const scoringRaw = data?.scoringPlays ?? null;
  const scoring = scoringRaw
    ? scoringRaw.map((p: any) => parsePlay(league, { ...p, scoringPlay: true }, regularSeason)).filter((p: Play | null): p is Play => p !== null)
    : plays.filter((p) => p.scoring);
  return { leaders, scoring, recent: plays.slice(-10).reverse() };
}

export function getGameCenter(league: LeagueConfig, gameId: string, final: boolean) {
  return cached(
    // v4: football's plays and baseball's leaders (v3 labeled an NHL shootout "SO", v2 added athlete ids); older stored copies are read again once.
    `espn-${league.id}-center4-${gameId}${final ? '-final' : ''}`,
    { ttlMs: final ? 365 * 86_400_000 : 30_000, persist: final, isFinal: () => final },
    async () => {
      const res = await fetch(`${BASE}/${league.espnPath}/summary?event=${gameId}`, { cache: 'no-store', signal: AbortSignal.timeout(15_000) });
      if (!res.ok) throw new Error(`ESPN responded ${res.status}`);
      return parseGameCenter(league, await res.json());
    }
  );
}
