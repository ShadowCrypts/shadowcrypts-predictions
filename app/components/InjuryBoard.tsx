'use client';

import { Search } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { signed } from '../../lib/format';
import type { LeagueId } from '../../lib/leagues';
import { missChance } from '../../lib/model/adjustments';
import { eloToPoints, InjuryReportRow, InjuryReportTeam } from '../../lib/model/injuryReport';
import { searchable } from '../../lib/search';
import { statusTone } from './InjuryList';
import { LocalTime } from './LocalTime';
import { TeamLogo } from './TeamLogo';

const VIEWS = [
  { id: 'all', label: 'Everyone' },
  { id: 'out', label: 'Out' },
  { id: 'maybe', label: 'Might play' }
] as const;
type View = (typeof VIEWS)[number]['id'];

const inView = (row: InjuryReportRow, view: View) => {
  const chance = missChance(row.status);
  return view === 'all' ? true : view === 'out' ? chance >= 1 : chance < 1;
};

/** A league's injury report, team by team, each player next to what he costs in the team's next forecast. */
export function InjuryBoard({ league, teams, playerPages }: { league: LeagueId; teams: InjuryReportTeam[]; playerPages: boolean }) {
  const [view, setView] = useState<View>('all');
  const [query, setQuery] = useState('');
  const wanted = searchable(query);
  const shown = teams
    .map((team) => {
      const teamMatches = !wanted || searchable(`${team.name} ${team.abbr}`).includes(wanted);
      return { ...team, rows: team.rows.filter((r) => inView(r, view) && (teamMatches || searchable(r.name).includes(wanted))) };
    })
    .filter((team) => team.rows.length);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1.5" role="group" aria-label="Who to show">
          {VIEWS.map((v) => (
            <button key={v.id} type="button" aria-pressed={view === v.id} onClick={() => setView(v.id)} className={`chip ${view === v.id ? 'chip-active' : 'chip-idle'}`}>
              {v.label}
            </button>
          ))}
        </div>
        <label className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-lg bg-surface px-3 ring-1 ring-line focus-within:ring-accent sm:max-w-xs">
          <Search className="h-4 w-4 shrink-0 text-ink-3" aria-hidden />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a player or team" className="w-full bg-transparent text-sm text-ink placeholder:text-ink-3 focus:outline-none" aria-label="Find a player or team" />
        </label>
      </div>
      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
        {shown.map((team) => (
          <section key={team.id} aria-label={team.name} className="card p-4">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <TeamLogo src={team.logo} abbr={team.abbr} size={24} />
              <h3 className="font-semibold text-ink">
                <Link href={`/${league}/team/${team.id}`} className="hover:underline">
                  {team.name}
                </Link>
              </h3>
              {team.next && (
                <Link href={`/${league}/game/${team.next.gameId}`} className="ml-auto text-xs text-ink-3 hover:underline">
                  {team.next.home ? 'vs' : '@'} {team.next.opponent} · <LocalTime iso={team.next.date} show="day" />
                </Link>
              )}
            </div>
            <ul className="mt-2 divide-y divide-line">
              {team.rows.map((row) => (
                <li key={row.id} className="py-2.5">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="min-w-0 text-sm text-ink">
                      {playerPages ? (
                        <Link href={`/${league}/player/${row.id}`} className="hover:underline">
                          {row.name}
                        </Link>
                      ) : (
                        row.name
                      )}{' '}
                      <span className="text-xs text-ink-3">{row.position}</span>
                    </p>
                    <span className="flex shrink-0 items-center gap-2 text-xs">
                      {row.elo !== null && row.elo <= -0.5 && (
                        <span className="font-semibold text-ink tabular" title={`In an even game, about ${Math.abs(eloToPoints(row.elo)).toFixed(1)} points of win chance`}>
                          {signed(row.elo)} Elo
                        </span>
                      )}
                      <span className={`rounded-md px-1.5 py-0.5 font-medium ${statusTone(row.status)}`}>{row.status}</span>
                    </span>
                  </div>
                  {row.comment && <p className="mt-0.5 line-clamp-2 text-xs text-ink-3">{row.comment}</p>}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      {!shown.length && <p className="mt-4 text-sm text-ink-3">No one matches. Clear the search or show everyone.</p>}
    </div>
  );
}
