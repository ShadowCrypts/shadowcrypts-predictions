'use client';

import Link from 'next/link';
import { useState } from 'react';
import { signed } from '../../lib/format';
import type { LeagueId } from '../../lib/leagues';
import { gamesBehind, LeagueStandings, NHL_WILD_CARDS, PLAYOFF_LINES, StandingRow, wildCardTables } from '../../lib/standings';
import { TeamLogo } from './TeamLogo';

/** A column: its heading, what the heading means, and the cell. `leader` is whoever tops this table. */
type Column = { key: string; label: string; hint: string; show: (r: StandingRow, leader: StandingRow) => string };

const games = (r: StandingRow) => r.wins + r.losses + r.ties + r.otLosses;
const dash = (v: string | number | null) => (v === null || v === '' ? '—' : String(v));
const margin = (r: StandingRow) => (r.pointsFor === null || r.pointsAgainst === null ? null : r.pointsFor - r.pointsAgainst);

const W: Column = { key: 'w', label: 'W', hint: 'Wins', show: (r) => String(r.wins) };
const L: Column = { key: 'l', label: 'L', hint: 'Losses', show: (r) => String(r.losses) };
const PCT: Column = { key: 'pct', label: 'PCT', hint: 'Winning percentage', show: (r) => (r.pct === null ? '—' : r.pct.toFixed(3).replace(/^0/, '')) };
const GB: Column = {
  key: 'gb',
  label: 'GB',
  hint: 'Games behind whoever tops this table',
  show: (r, leader) => {
    const behind = gamesBehind(leader, r);
    return behind <= 0 ? '—' : behind.toFixed(1);
  }
};
const HOME: Column = { key: 'home', label: 'Home', hint: 'Record at home', show: (r) => dash(r.home) };
const ROAD: Column = { key: 'road', label: 'Road', hint: 'Record on the road', show: (r) => dash(r.road) };
const L10: Column = { key: 'l10', label: 'L10', hint: 'Record in the last ten games', show: (r) => dash(r.lastTen) };
const STREAK: Column = { key: 'streak', label: 'Strk', hint: 'Current streak', show: (r) => dash(r.streak) };
const FOR = (label: string, hint: string): Column => ({ key: 'for', label, hint, show: (r) => dash(r.pointsFor) });
const AGAINST = (label: string, hint: string): Column => ({ key: 'against', label, hint, show: (r) => dash(r.pointsAgainst) });
const DIFF: Column = {
  key: 'diff',
  label: 'Diff',
  hint: 'Scored minus allowed',
  show: (r) => {
    const m = margin(r);
    return m === null ? '—' : signed(m);
  }
};

const COLUMNS: Record<LeagueId, (rows: StandingRow[]) => Column[]> = {
  nba: () => [W, L, PCT, GB, HOME, ROAD, L10, STREAK, { ...DIFF, hint: 'Points scored minus allowed, a game', show: (r) => { const m = margin(r); return m === null || !games(r) ? '—' : signed(m / games(r), 1); } }],
  // Ties are rare, so the column only shows once a team has one.
  nfl: (rows) => [W, L, ...(rows.some((r) => r.ties) ? [{ key: 't', label: 'T', hint: 'Ties', show: (r: StandingRow) => String(r.ties) }] : []), PCT, FOR('PF', 'Points for'), AGAINST('PA', 'Points against'), DIFF, HOME, ROAD, STREAK],
  nhl: () => [W, L, { key: 'otl', label: 'OTL', hint: 'Overtime and shootout losses', show: (r) => String(r.otLosses) }, { key: 'pts', label: 'PTS', hint: 'Standings points: two for a win, one for an overtime or shootout loss', show: (r) => dash(r.points) }, FOR('GF', 'Goals for'), AGAINST('GA', 'Goals against'), DIFF, HOME, ROAD, L10, STREAK],
  mlb: () => [W, L, PCT, GB, FOR('RS', 'Runs scored'), AGAINST('RA', 'Runs allowed'), DIFF, HOME, ROAD, L10, STREAK]
};

function Table({ league, title, rows, seeded, lines = [], colors, odds }: { league: LeagueId; title: string; rows: StandingRow[]; seeded: boolean; lines?: number[]; colors: Record<string, string>; odds: Record<string, number> | null }) {
  const columns = COLUMNS[league](rows);
  return (
    <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <table className="w-full min-w-[560px] text-sm">
        <caption className="sr-only">{title} standings</caption>
        <thead>
          <tr className="text-left text-xs text-ink-3">
            {seeded && (
              <th scope="col" className="w-6 pb-2 font-medium" title="Official playoff seed">
                #
              </th>
            )}
            {/* Pinned on phones only: wider screens fit the whole table, and the card's sheen would show the patch behind it. */}
            <th scope="col" className="sticky left-0 z-10 bg-surface pb-2 font-medium sm:static sm:bg-transparent">
              {title}
            </th>
            {columns.map((c) => (
              <th key={c.key} scope="col" title={c.hint} className="whitespace-nowrap pb-2 pl-3 text-right font-medium">
                {c.label}
              </th>
            ))}
            {odds && (
              <th scope="col" title="Chance of making the playoffs, from the season simulation" className="whitespace-nowrap pb-2 pl-3 text-right font-medium">
                Playoffs
              </th>
            )}
          </tr>
        </thead>
        <tbody className="tabular">
          {rows.map((r, i) => {
            const chance = odds?.[r.teamId];
            return (
              <tr key={r.teamId} className={`border-t transition hover:bg-raised/60 ${lines.includes(i) ? 'border-accent' : 'border-line'}`}>
                {seeded && <td className="py-2 text-ink-3">{r.seed ?? '—'}</td>}
                <td className="sticky left-0 z-10 bg-surface py-2 pr-2 sm:static sm:bg-transparent">
                  <Link href={`/${league}/team/${r.teamId}`} className="flex items-center gap-2 hover:underline">
                    <span className="h-6 w-1 shrink-0 rounded-full" style={{ background: colors[r.teamId] }} aria-hidden />
                    <TeamLogo src={r.logo} abbr={r.abbr} size={22} />
                    <span className="font-medium text-ink sm:hidden">{r.abbr}</span>
                    <span className="hidden font-medium text-ink sm:inline">{r.name}</span>
                  </Link>
                </td>
                {columns.map((c) => (
                  <td key={c.key} className={`whitespace-nowrap py-2 pl-3 text-right ${c.key === 'w' || c.key === 'pts' ? 'font-semibold text-ink' : 'text-ink-2'}`}>
                    {c.show(r, rows[0])}
                  </td>
                ))}
                {odds && <td className="py-2 pl-3 text-right text-ink-2">{chance === undefined ? '—' : chance < 0.005 ? '<1%' : chance >= 0.995 ? '>99%' : `${Math.round(chance * 100)}%`}</td>}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const CUT_NOTE: Record<LeagueId, string> = {
  nba: 'The lines mark the top six, straight into the playoffs, and the play-in places, 7 to 10.',
  nfl: 'The line marks the seven playoff places.',
  mlb: 'The line marks the six playoff places.',
  nhl: "The top three in each division make the playoffs, and so do the top two in the wild-card table, above its line, whatever their points against another division's teams."
};
const SECOND_VIEW: Record<LeagueId, string> = { nba: 'By conference', nfl: 'By conference', mlb: 'By league', nhl: 'Wild card' };

/** A league's standings, by division or conference, with each team's playoff chance beside its record. */
export function StandingsView({ league, standings, colors, odds, opensBy }: { league: LeagueId; standings: LeagueStandings; colors: Record<string, string>; odds: Record<string, number> | null; opensBy: 'division' | 'conference' }) {
  const [by, setBy] = useState(opensBy);
  return (
    <div className="space-y-6">
      <div className="flex gap-2" role="group" aria-label="Group teams by">
        {(['division', 'conference'] as const).map((v) => (
          <button key={v} type="button" aria-pressed={by === v} onClick={() => setBy(v)} className={`chip ${by === v ? 'chip-active' : 'chip-idle'}`}>
            {v === 'division' ? 'By division' : SECOND_VIEW[league]}
          </button>
        ))}
      </div>
      {standings.conferences.map((conference) => (
        <section key={conference.name} aria-label={conference.name} className="card p-4 sm:p-5">
          <h2 className="mb-3 font-display text-base font-semibold text-ink">{conference.name}</h2>
          {by === 'conference' && league === 'nhl' ? (
            <div className="space-y-5">
              {wildCardTables(conference).map((table) => (
                <Table key={table.name} league={league} title={table.name} rows={table.rows} seeded={false} lines={table.name === 'Wild card' ? [NHL_WILD_CARDS] : []} colors={colors} odds={odds} />
              ))}
            </div>
          ) : by === 'conference' && league !== 'nhl' ? (
            <Table league={league} title="Team" rows={conference.rows} seeded lines={PLAYOFF_LINES[league]} colors={colors} odds={odds} />
          ) : (
            <div className="space-y-5">
              {conference.divisions.map((division) => (
                <Table key={division.name} league={league} title={division.name} rows={division.rows} seeded={false} colors={colors} odds={odds} />
              ))}
            </div>
          )}
        </section>
      ))}
      {by === 'conference' && <p className="text-xs text-ink-3">{CUT_NOTE[league]}</p>}
    </div>
  );
}
