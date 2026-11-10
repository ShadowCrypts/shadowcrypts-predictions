import type { Game } from '../espn';
import { signed } from '../format';
import type { LeagueId } from '../leagues';
import type { RatingPoint } from './elo';
import { Metric, metricText, METRICS, TeamMetricValues } from './teamMetrics';

/** Wins, losses and ties. */
export type Split = { w: number; l: number; t: number };

/** A team's season so far: per-game averages, records, and the average Elo of the teams it has played. */
export type SeasonSheet = {
  games: number;
  scored: number;
  allowed: number;
  /** The last `RECENT` games, once it has played that many. */
  recent: Split | null;
  home: Split | null;
  road: Split | null;
  schedule: number | null;
};

export type TeamSheet = {
  season: SeasonSheet | null;
  /** Elo going in. */
  elo: number | null;
  /** The scoring model's ratings a game above average (defense above zero is weak); left out where they don't belong. */
  offense?: number;
  defense?: number;
  /** Box-score metrics, by key: see `lib/model/teamMetrics`. */
  metrics?: Record<string, number>;
};

/** Every team's numbers in one league, small enough to hand to the browser. `metrics` names the box-score ones the tape shows. */
export type LeagueSheet = { seasonYear: number | null; teams: Record<string, TeamSheet>; metrics?: Metric[] };

/** One side of a row: the value as shown, and its rank among `of` teams (1 is best; for the schedule, toughest). */
export type TapeSide = { value: string; rank: number; of: number };

export type TapeRow = {
  id: string;
  label: string;
  left: TapeSide;
  right: TapeSide;
  /** The side the row favors; null for a tie, or a row that favors nobody (the schedule). */
  edge: 'left' | 'right' | null;
};

/** The score's name for row labels: "Points", "Goals", "Runs". */
export const scoreWord = (unit: string) => ({ pts: 'Points', goals: 'Goals', runs: 'Runs' })[unit] ?? 'Points';

/** Games each team needs in this season before it stands in for last season. */
export const TAPE_MIN_GAMES = 3;
/** Recent stretch compared once both teams have played more than this. */
export const RECENT = 10;

type Result = { scored: number; allowed: number; where: 'home' | 'road' | 'neutral'; opponent: string };

/** Every team's finished regular-season games in a season before `before`, oldest first. Playoff games stay out: teams play different numbers of them, and every standings table leaves them out too. */
function results(games: Game[], seasonYear: number, before: string) {
  const byTeam = new Map<string, Result[]>();
  const add = (id: string, r: Result) => {
    const list = byTeam.get(id);
    if (list) list.push(r);
    else byTeam.set(id, [r]);
  };
  for (const g of [...games].sort((a, b) => a.date.localeCompare(b.date))) {
    if (g.seasonYear !== seasonYear || g.seasonType !== 2 || !g.completed || g.date >= before) continue;
    if (g.home.score === null || g.away.score === null) continue;
    add(g.home.teamId, { scored: g.home.score, allowed: g.away.score, where: g.neutral ? 'neutral' : 'home', opponent: g.away.teamId });
    add(g.away.teamId, { scored: g.away.score, allowed: g.home.score, where: g.neutral ? 'neutral' : 'road', opponent: g.home.teamId });
  }
  return byTeam;
}

/** The season the per-game rows use: this one once the teams have a few games each, else last season if they all played in it. */
export function tapeSeason(games: Game[], teamIds: string[], seasonYear: number, before: string) {
  const count = (byTeam: Map<string, Result[]>, id: string) => byTeam.get(id)?.length ?? 0;
  const now = results(games, seasonYear, before);
  if (teamIds.every((id) => count(now, id) >= TAPE_MIN_GAMES)) return seasonYear;
  const last = results(games, seasonYear - 1, before);
  if (teamIds.every((id) => count(last, id) > 0)) return seasonYear - 1;
  return teamIds.every((id) => count(now, id) > 0) ? seasonYear : null;
}

/** Elo going into `date`: the last reading before it. */
export function ratingAt(points: RatingPoint[] | undefined, date: string) {
  let found: number | null = null;
  for (const p of points ?? []) {
    if (p.date < date) found = p.rating;
    else break;
  }
  return found;
}

function split(list: Result[]): Split {
  const w = list.filter((r) => r.scored > r.allowed).length;
  const l = list.filter((r) => r.scored < r.allowed).length;
  return { w, l, t: list.length - w - l };
}
const mean = (values: number[]) => values.reduce((s, v) => s + v, 0) / values.length;

/** Each league team's sheet, from games before `before` in `seasonYear` (null leaves the season out). */
export function leagueSheet({
  teamIds,
  games,
  history,
  seasonYear,
  before,
  adjusted,
  metrics,
  league
}: {
  /** The league's teams: the ones ranked (exhibition opponents stay out). */
  teamIds: string[];
  games: Game[];
  history: Record<string, RatingPoint[]>;
  seasonYear: number | null;
  before: string;
  adjusted?: Record<string, { offense: number; defense: number }>;
  /** Box-score metrics over the same games, with the league they're from. */
  metrics?: TeamMetricValues;
  league?: LeagueId;
}): LeagueSheet {
  const elo = new Map(
    Object.entries(history).flatMap(([id, points]) => {
      const r = ratingAt(points, before);
      return r === null ? [] : [[id, r] as const];
    })
  );
  const byTeam = seasonYear === null ? new Map<string, Result[]>() : results(games, seasonYear, before);
  const teams: Record<string, TeamSheet> = {};
  for (const id of teamIds) {
    const list = byTeam.get(id);
    const rated = (list ?? []).flatMap((r) => (elo.has(r.opponent) ? [elo.get(r.opponent)!] : []));
    // A neutral-site game counts toward the averages but neither record.
    const home = list?.filter((r) => r.where === 'home') ?? [];
    const road = list?.filter((r) => r.where === 'road') ?? [];
    teams[id] = {
      season: list?.length
        ? {
            games: list.length,
            scored: mean(list.map((r) => r.scored)),
            allowed: mean(list.map((r) => r.allowed)),
            recent: list.length >= RECENT ? split(list.slice(-RECENT)) : null,
            home: home.length ? split(home) : null,
            road: road.length ? split(road) : null,
            schedule: rated.length ? mean(rated) : null
          }
        : null,
      elo: elo.get(id) ?? null,
      ...(adjusted?.[id] ? { offense: adjusted[id].offense, defense: adjusted[id].defense } : {}),
      ...(metrics?.[id] ? { metrics: metrics[id] } : {})
    };
  }
  return { seasonYear, teams, ...(metrics && league ? { metrics: METRICS[league]?.list.filter((m) => m.tape) } : {}) };
}

export const splitText = (s: Split) => `${s.w}–${s.l}${s.t ? `–${s.t}` : ''}`;
/** A record as a share of its games, a tie counting half. */
export const splitShare = (s: Split) => (s.w + s.t / 2) / (s.w + s.l + s.t);
const played = (s: Split | null) => (s ? s.w + s.l + s.t : 0);
/** Games a season's home and road records leave out: the ones at a neutral site. */
export const neutralGames = (season: SeasonSheet) => season.games - played(season.home) - played(season.road);

/**
 * One team's numbers on their own, for its page: the same rows, read from one
 * side, with its home and road records split back apart.
 */
export function teamNumbers(sheet: LeagueSheet, teamId: string, unit: string): { id: string; label: string; side: TapeSide }[] {
  return tapeRows(sheet, teamId, teamId, { host: 'left', unit }).flatMap((row) => {
    if (row.id === 'venue') {
      return [
        { id: 'home', label: 'At home', side: row.left },
        { id: 'road', label: 'On the road', side: row.right }
      ];
    }
    return row.id === 'elo' || row.id === 'offense' || row.id === 'defense' ? [] : [{ id: row.id, label: row.label, side: row.left }];
  });
}

/** Hockey's standings keep overtime losses apart; these records are plain wins and losses, so they say so. */
export const overtimeNote = (league: string) => (league === 'nhl' ? 'Overtime and shootout losses count as losses in these records.' : '');

/** What the rows mean, for under the section title. `when` names the season ("This season coming into the game"). */
export function tapeNote(rows: TapeRow[], when: string, league: string) {
  const has = (id: string) => rows.some((r) => r.id === id);
  return [
    `${when}, regular season, each number with its league rank (the longer the bar, the higher).`,
    has('venue') && "Home and road: the host's record at home against the visitor's on the road.",
    (has('venue') || has('recent')) && overtimeNote(league),
    has('schedule') && 'Opponent Elo: how strong the teams each has played are, 1st the toughest.',
    has('offense') && 'Adjusted: the scoring model’s ratings a game, which account for who they played.',
    rows.some((r) => r.id.startsWith('metric-')) && METRICS[league as LeagueId]?.note
  ]
    .filter(Boolean)
    .join(' ');
}

/** A number to rank teams on, and how to show it. */
type Measure = { value: (t: TeamSheet) => number | null | undefined; show: (v: number, t: TeamSheet) => string };

/** Competition rank (ties share a place): one plus the teams strictly better. */
function rankIn(values: number[], mine: number, higherIsBetter: boolean) {
  return values.filter((v) => (higherIsBetter ? v > mine : v < mine)).length + 1;
}

/** The side with the better standing; null when level, or when a row favors nobody. */
function edgeOf(left: TapeSide, right: TapeSide, favors = true): TapeRow['edge'] {
  const standing = (s: TapeSide) => (s.of < 2 ? 0 : (s.rank - 1) / (s.of - 1));
  if (!favors || standing(left) === standing(right)) return null;
  return standing(left) < standing(right) ? 'left' : 'right';
}

/**
 * Two teams side by side: scoring, defense and margin a game with their league
 * ranks, the last ten, the host's home record against the visitor's road
 * record, the schedule so far, Elo, and the adjusted ratings where the sheet
 * has them.
 */
export function tapeRows(sheet: LeagueSheet, leftId: string, rightId: string, { host, unit }: { host: 'left' | 'right' | null; unit: string }): TapeRow[] {
  const all = Object.values(sheet.teams);
  const L = sheet.teams[leftId];
  const R = sheet.teams[rightId];
  if (!L || !R) return [];
  const rows: TapeRow[] = [];
  /** A row ranking each side among the teams that have its number (the two sides can measure different things: home and road records). */
  const ranked = (id: string, label: string, left: Measure, right: Measure = left, { higherIsBetter = true, favors = true } = {}) => {
    const lv = left.value(L);
    const rv = right.value(R);
    if (lv === null || lv === undefined || rv === null || rv === undefined) return;
    const side = (m: Measure, v: number, t: TeamSheet): TapeSide => {
      const pool = all.flatMap((o) => {
        const x = m.value(o);
        return x === null || x === undefined ? [] : [x];
      });
      return { value: m.show(v, t), rank: rankIn(pool, v, higherIsBetter), of: pool.length };
    };
    const l = side(left, lv, L);
    const r = side(right, rv, R);
    rows.push({ id, label, left: l, right: r, edge: edgeOf(l, r, favors) });
  };
  const oneDecimal = (v: number) => v.toFixed(1);
  const record = (pick: (s: SeasonSheet) => Split | null): Measure => ({
    value: (t) => {
      const s = t.season && pick(t.season);
      return s ? splitShare(s) : null;
    },
    show: (_, t) => splitText(pick(t.season!)!)
  });

  ranked('scored', `${unit} scored`, { value: (t) => t.season?.scored, show: oneDecimal });
  ranked('allowed', `${unit} allowed`, { value: (t) => t.season?.allowed, show: oneDecimal }, undefined, { higherIsBetter: false });
  ranked('margin', 'Margin', { value: (t) => (t.season ? t.season.scored - t.season.allowed : null), show: (v) => signed(v, 1) });
  for (const m of sheet.metrics ?? []) {
    ranked(`metric-${m.key}`, m.tape ?? m.label, { value: (t) => t.metrics?.[m.key], show: (v) => metricText(m, v) }, undefined, { higherIsBetter: !m.lowFirst });
  }
  if (Math.min(L.season?.games ?? 0, R.season?.games ?? 0) > RECENT) ranked('recent', `Last ${RECENT}`, record((s) => s.recent));
  if (host) {
    // The host at home against the visitor on the road, each ranked among the league's home (or road) records.
    const home = record((s) => s.home);
    const road = record((s) => s.road);
    ranked('venue', host === 'right' ? 'Road vs home' : 'Home vs road', host === 'left' ? home : road, host === 'right' ? home : road);
  }
  // How strong the teams each has played are. Ranked toughest first; it favors nobody.
  ranked('schedule', 'Opponent Elo', { value: (t) => t.season?.schedule, show: (v) => String(Math.round(v)) }, undefined, { favors: false });
  ranked('elo', 'Elo rating', { value: (t) => t.elo, show: (v) => String(Math.round(v)) });
  ranked('offense', 'Offense, adjusted', { value: (t) => t.offense, show: (v) => signed(v, 1) });
  // As points kept off the board, so higher is better here too.
  ranked('defense', 'Defense, adjusted', { value: (t) => (t.defense === undefined ? undefined : -t.defense), show: (v) => signed(v, 1) });
  return rows;
}
