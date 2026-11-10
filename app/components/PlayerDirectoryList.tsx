'use client';

import { Search } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { searchable } from '../../lib/search';
import { PlayerPhoto } from './PlayerPhoto';

export type DirectoryRow = { id: string; name: string; team: string; teamName: string; color?: string };

/** How many players show at first and per "show more"; the filters narrow it down. */
const SHOWN = 60;

/** Every player with a page in a league, busiest first, with a name search and a team filter. */
export function PlayerDirectoryList({ league, rows }: { league: string; rows: DirectoryRow[] }) {
  const [query, setQuery] = useState('');
  const [team, setTeam] = useState('all');
  const [limit, setLimit] = useState(SHOWN);
  const teams = useMemo(() => [...new Map(rows.filter((r) => r.team).map((r) => [r.team, r.teamName])).entries()].sort((a, b) => a[1].localeCompare(b[1])), [rows]);
  const wanted = searchable(query);
  const shown = rows.filter((r) => (team === 'all' || r.team === team) && (!wanted || searchable(r.name).includes(wanted)));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <label className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-lg bg-surface px-3 ring-1 ring-line focus-within:ring-accent sm:max-w-xs">
          <Search className="h-4 w-4 shrink-0 text-ink-3" aria-hidden />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find a player"
            className="w-full bg-transparent text-sm text-ink placeholder:text-ink-3 focus:outline-none"
            aria-label="Find a player"
          />
        </label>
        <select value={team} onChange={(e) => setTeam(e.target.value)} className="h-9 rounded-lg bg-surface px-3 text-sm text-ink ring-1 ring-line focus:outline-none focus:ring-accent" aria-label="Team">
          <option value="all">All teams</option>
          {teams.map(([abbr, name]) => (
            <option key={abbr} value={abbr}>
              {name}
            </option>
          ))}
        </select>
      </div>
      {shown.length ? (
        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {shown.slice(0, limit).map((p) => (
            <li key={p.id}>
              <Link href={`/${league}/player/${p.id}`} className="flex items-center gap-3 rounded-xl px-2 py-1.5 ring-1 ring-line transition hover:bg-raised hover:ring-line-strong">
                <PlayerPhoto league={league} id={p.id} name={p.name} size={36} ring={p.color} />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-ink">{p.name}</span>
                  <span className="block truncate text-xs text-ink-3">{p.teamName || p.team}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-ink-3">No players match.</p>
      )}
      {shown.length > limit && (
        <button
          type="button"
          onClick={() => setLimit((n) => n + SHOWN)}
          className="w-full rounded-xl py-2 text-sm text-ink-2 ring-1 ring-line hover:text-ink hover:ring-line-strong"
        >
          Show more ({(shown.length - limit).toLocaleString()} left, busiest first)
        </button>
      )}
    </div>
  );
}
