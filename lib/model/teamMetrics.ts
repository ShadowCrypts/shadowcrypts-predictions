import type { BoxScore, NflSkillBox } from '../boxscores';
import type { Game } from '../espn';
import type { LeagueId } from '../leagues';

/** A team number from the box scores: how it reads, and whether fewer is better. `tape` puts it on the tale of the tape too, under that name. */
export type Metric = { key: string; label: string; hint: string; digits: number; percent?: boolean; signed?: boolean; lowFirst?: boolean; tape?: string };

/** Everything beyond points: pace-free efficiency in basketball, shot share and goaltending in hockey, yards per play in football. Baseball's box scores aren't stored. */
export const METRICS: Partial<Record<LeagueId, { name: string; note: string; list: Metric[] }>> = {
  nba: {
    name: 'Efficiency',
    note: 'Offense and defense are points per 100 possessions, which sets aside how fast a team plays.',
    list: [
      { key: 'net', label: 'Net', hint: 'Points per 100 possessions scored minus allowed', digits: 1, signed: true },
      { key: 'off', label: 'Off', hint: 'Points scored per 100 possessions', digits: 1, tape: 'Offense rating' },
      { key: 'def', label: 'Def', hint: 'Points allowed per 100 possessions', digits: 1, lowFirst: true, tape: 'Defense rating' },
      { key: 'pace', label: 'Pace', hint: 'Possessions per 48 minutes', digits: 1, tape: 'Pace' },
      { key: 'ts', label: 'TS%', hint: 'True shooting: points per shot, with threes and free throws counted fairly', digits: 1, percent: true },
      { key: 'tov', label: 'TOV%', hint: 'Possessions ending in a turnover', digits: 1, percent: true, lowFirst: true },
      { key: 'oreb', label: 'OREB%', hint: 'Own misses rebounded', digits: 1, percent: true }
    ]
  },
  nhl: {
    name: 'Shots',
    note: "Shot share is a team's share of the shots on goal in its games. PDO adds shooting and save percentages: far from 100 tends to even out.",
    list: [
      { key: 'share', label: 'Shot share', hint: 'Share of the shots on goal in their games', digits: 1, percent: true, tape: 'Shot share' },
      { key: 'sf', label: 'SF', hint: 'Shots on goal a game', digits: 1 },
      { key: 'sa', label: 'SA', hint: 'Shots on goal allowed a game', digits: 1, lowFirst: true },
      { key: 'sh', label: 'SH%', hint: 'Goals per shot on goal', digits: 1, percent: true },
      { key: 'sv', label: 'SV%', hint: 'Shots saved', digits: 1, percent: true, tape: 'Save percentage' },
      { key: 'pdo', label: 'PDO', hint: 'Shooting plus save percentage', digits: 1 }
    ]
  },
  nfl: {
    name: 'Yards',
    note: 'Yards per play counts passes, sacks and runs, with sack yardage taken off.',
    list: [
      { key: 'net', label: 'Net Y/P', hint: 'Yards per play gained minus allowed', digits: 2, signed: true },
      { key: 'off', label: 'Off Y/P', hint: 'Yards gained per play', digits: 2, tape: 'Yards per play' },
      { key: 'def', label: 'Def Y/P', hint: 'Yards allowed per play', digits: 2, lowFirst: true, tape: 'Yards allowed per play' },
      { key: 'pass', label: 'Pass Y/A', hint: 'Net yards per dropback, sacks counted', digits: 2 },
      { key: 'rush', label: 'Rush Y/A', hint: 'Yards per carry', digits: 2 },
      { key: 'passD', label: 'Opp pass', hint: 'Net yards allowed per dropback', digits: 2, lowFirst: true },
      { key: 'rushD', label: 'Opp rush', hint: 'Yards allowed per carry', digits: 2, lowFirst: true }
    ]
  }
};

export type TeamMetricValues = Record<string, Record<string, number>>;

/** A metric's value as shown. */
export function metricText(m: Pick<Metric, 'digits' | 'percent' | 'signed'>, value: number | null | undefined) {
  if (value === null || value === undefined) return '—';
  const scaled = m.percent ? value * 100 : value;
  const rounded = Number(scaled.toFixed(m.digits));
  const sign = m.signed ? (rounded > 0 ? '+' : rounded < 0 ? '−' : '') : '';
  return `${sign}${Math.abs(rounded).toFixed(m.digits)}${m.percent ? '%' : ''}`;
}

const add = (totals: Map<string, Record<string, number>>, teamId: string, values: Record<string, number>) => {
  const t = totals.get(teamId) ?? totals.set(teamId, {}).get(teamId)!;
  for (const [k, v] of Object.entries(values)) t[k] = (t[k] ?? 0) + v;
};
const ratio = (a: number | undefined, b: number | undefined) => (b ? (a ?? 0) / b : 0);

/** Possessions by the usual estimate: shots, free-throw trips, turnovers, less the shots an offensive rebound won back. */
const possessions = (t: { fga: number; fta: number; oreb: number; tov: number }) => t.fga + 0.44 * t.fta - t.oreb + t.tov;

function basketball(games: Game[], box: Record<string, BoxScore | null>) {
  const totals = new Map<string, Record<string, number>>();
  for (const g of games) {
    const b = box[g.id];
    if (b?.league !== 'nba') continue;
    const sum = (teamId: string) => {
      const t = { pts: 0, fga: 0, fta: 0, oreb: 0, dreb: 0, tov: 0, min: 0 };
      for (const l of b.teams[teamId] ?? []) {
        if (l.dnp) continue;
        t.pts += l.pts;
        t.fga += l.fga;
        t.fta += l.fta;
        t.oreb += l.oreb;
        t.dreb += l.dreb;
        t.tov += l.tov;
        t.min += l.min;
      }
      return t;
    };
    const home = sum(g.home.teamId);
    const away = sum(g.away.teamId);
    if (!home.fga || !away.fga) continue;
    // Both teams have the same number of possessions, near enough, so the game's is the average of the two estimates.
    const shared = (possessions(home) + possessions(away)) / 2;
    for (const [teamId, us, them] of [[g.home.teamId, home, away], [g.away.teamId, away, home]] as const) {
      add(totals, teamId, { pts: us.pts, opp: them.pts, poss: shared, own: possessions(us), min: us.min / 5, fga: us.fga, fta: us.fta, tov: us.tov, oreb: us.oreb, oppDreb: them.dreb });
    }
  }
  return new Map(
    [...totals].map(([id, t]) => {
      const off = (100 * t.pts) / t.poss;
      const def = (100 * t.opp) / t.poss;
      return [id, { net: off - def, off, def, pace: (48 * t.poss) / t.min, ts: t.pts / (2 * (t.fga + 0.44 * t.fta)), tov: t.tov / t.own, oreb: t.oreb / (t.oreb + t.oppDreb) }];
    })
  );
}

function hockey(games: Game[], box: Record<string, BoxScore | null>) {
  const totals = new Map<string, Record<string, number>>();
  for (const g of games) {
    const b = box[g.id];
    if (b?.league !== 'nhl') continue;
    const sum = (teamId: string) => {
      const team = b.teams[teamId];
      return {
        sog: (team?.skaters ?? []).reduce((s, l) => s + l.sog, 0),
        goals: (team?.skaters ?? []).reduce((s, l) => s + l.g, 0),
        faced: (team?.goalies ?? []).reduce((s, l) => s + l.sa, 0),
        ga: (team?.goalies ?? []).reduce((s, l) => s + l.ga, 0)
      };
    };
    const home = sum(g.home.teamId);
    const away = sum(g.away.teamId);
    if (!home.sog || !away.sog) continue;
    for (const [teamId, us, them] of [[g.home.teamId, home, away], [g.away.teamId, away, home]] as const) {
      add(totals, teamId, { games: 1, sf: us.sog, sa: them.sog, goals: us.goals, faced: us.faced, ga: us.ga });
    }
  }
  return new Map(
    [...totals].map(([id, t]) => {
      const sh = ratio(t.goals, t.sf);
      const sv = 1 - ratio(t.ga, t.faced);
      return [id, { share: ratio(t.sf, t.sf + t.sa), sf: t.sf / t.games, sa: t.sa / t.games, sh, sv, pdo: (sh + sv) * 100 }];
    })
  );
}

function football(games: Game[], box: Record<string, BoxScore | null>, skill: Record<string, NflSkillBox | null>) {
  const totals = new Map<string, Record<string, number>>();
  for (const g of games) {
    const b = box[g.id];
    const s = skill[g.id];
    if (b?.league !== 'nfl' || !s) continue;
    const sum = (teamId: string) => {
      const passers = b.teams[teamId]?.passers ?? [];
      const runners = s.teams[teamId] ?? [];
      return {
        dropbacks: passers.reduce((n, p) => n + p.att + p.sacks, 0),
        passYds: passers.reduce((n, p) => n + p.yds - p.sackYds, 0),
        // Rushing comes from the rushers' list alone: a quarterback's runs are in it as well as on his passing line.
        carries: runners.reduce((n, l) => n + l.rushAtt, 0),
        rushYds: runners.reduce((n, l) => n + l.rushYds, 0)
      };
    };
    const home = sum(g.home.teamId);
    const away = sum(g.away.teamId);
    if (!home.dropbacks || !away.dropbacks) continue;
    for (const [teamId, us, them] of [[g.home.teamId, home, away], [g.away.teamId, away, home]] as const) {
      add(totals, teamId, { db: us.dropbacks, py: us.passYds, car: us.carries, ry: us.rushYds, oppDb: them.dropbacks, oppPy: them.passYds, oppCar: them.carries, oppRy: them.rushYds });
    }
  }
  return new Map(
    [...totals].map(([id, t]) => {
      const off = ratio(t.py + t.ry, t.db + t.car);
      const def = ratio(t.oppPy + t.oppRy, t.oppDb + t.oppCar);
      return [id, { net: off - def, off, def, pass: ratio(t.py, t.db), rush: ratio(t.ry, t.car), passD: ratio(t.oppPy, t.oppDb), rushD: ratio(t.oppRy, t.oppCar) }];
    })
  );
}

/** Each team's metrics over these games, from their box scores. Leagues without stored box scores have none. */
export function teamMetrics(league: LeagueId, games: Game[], box: Record<string, BoxScore | null>, skill: Record<string, NflSkillBox | null>): TeamMetricValues {
  const values = league === 'nba' ? basketball(games, box) : league === 'nhl' ? hockey(games, box) : league === 'nfl' ? football(games, box, skill) : new Map();
  return Object.fromEntries(values);
}
