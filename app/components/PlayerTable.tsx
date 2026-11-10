'use client';

import { Search } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { signed } from '../../lib/format';
import { searchable } from '../../lib/search';
import { PlayerPhoto } from './PlayerPhoto';
import { TeamLogo } from './TeamLogo';

export type PlayerTableRow = {
  id: string;
  name: string;
  team: { id: string; abbr: string; shortName: string; logo: string | null; color: string };
  rating: number;
  vsAverage: number;
  volume: number;
};

const PLACE = ['1st', '2nd', '3rd'];
/** Rows shown at first and per "show more": the photos below the fold would otherwise all load at once. */
const PAGE = 50;

/** The top three as cards: big photo in the team's color, the rating as the headline. */
function Podium({ league, rows, ratingLabel, decimals }: { league: string; rows: PlayerTableRow[]; ratingLabel: string; decimals: number }) {
  return (
    <ol className="grid grid-cols-3 gap-2 sm:gap-3" aria-label="Top three">
      {rows.slice(0, 3).map((r, i) => (
        <li key={r.id} className="card relative overflow-hidden px-2 py-4 sm:p-5">
          <span className="pointer-events-none absolute inset-0" style={{ background: `radial-gradient(110% 80% at 50% 0%, ${r.team.color}40, transparent 65%)` }} aria-hidden />
          <span
            className={`absolute left-2 top-2 rounded-full px-2 py-0.5 text-[11px] font-semibold sm:left-3 sm:top-3 ${i === 0 ? 'bg-accent text-on-accent' : 'bg-raised text-ink-2 ring-1 ring-line'}`}
          >
            {PLACE[i]}
          </span>
          <div className="relative flex flex-col items-center text-center">
            <PlayerPhoto league={league} id={r.id} name={r.name} size={72} ring={r.team.color} eager />
            <Link href={`/${league}/player/${r.id}`} className="mt-2 max-w-full truncate font-display text-sm font-semibold text-ink hover:underline sm:text-lg">
              {r.name}
            </Link>
            <span className="flex items-center gap-1 text-xs text-ink-3">
              <TeamLogo src={r.team.logo} abbr={r.team.abbr} size={14} />
              {r.team.shortName}
            </span>
            <p className="mt-2 font-display text-2xl font-bold text-ink tabular sm:text-4xl">{r.rating.toFixed(decimals)}</p>
            <p className="text-[11px] text-ink-3">
              <span className="hidden sm:inline">{ratingLabel} · </span>
              <span className={`tabular ${r.vsAverage >= 0 ? 'text-good' : 'text-bad'}`}>{signed(r.vsAverage, decimals)}</span> vs avg
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}

/** Sortable-by-default leaderboard with team and name filters. */
export function PlayerTable({
  league,
  rows,
  ratingLabel,
  ratingHint,
  volumeLabel,
  volumeHint,
  decimals
}: {
  league: string;
  rows: PlayerTableRow[];
  ratingLabel: string;
  ratingHint: string;
  volumeLabel: string;
  volumeHint: string;
  decimals: number;
}) {
  const [team, setTeam] = useState('all');
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(PAGE);
  const teams = useMemo(() => [...new Map(rows.map((r) => [r.team.id, r.team])).values()].sort((a, b) => a.shortName.localeCompare(b.shortName)), [rows]);
  const wanted = searchable(query);
  const shown = rows.filter((r) => (team === 'all' || r.team.id === team) && (!wanted || searchable(r.name).includes(wanted)));
  const best = rows[0]?.vsAverage ?? 1;

  return (
    <div>
      {rows.length >= 3 && <Podium league={league} rows={rows} ratingLabel={ratingLabel} decimals={decimals} />}
      <div className="mt-6 flex flex-wrap gap-2">
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
        <select
          value={team}
          onChange={(e) => setTeam(e.target.value)}
          className="h-9 rounded-lg bg-surface px-3 text-sm text-ink ring-1 ring-line focus:outline-none focus:ring-accent"
          aria-label="Team"
        >
          <option value="all">All teams</option>
          {teams.map((t) => (
            <option key={t.id} value={t.id}>
              {t.shortName}
            </option>
          ))}
        </select>
      </div>

      <div className="card mt-4 overflow-x-auto p-0">
        <table className="w-full min-w-[480px] text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs text-ink-3">
              <th className="w-12 px-4 py-3 font-medium">#</th>
              <th className="py-3 font-medium">Player</th>
              <th className="py-3 text-right font-medium" title={volumeHint}>
                {volumeLabel}
              </th>
              <th className="py-3 pl-6 font-medium" title={ratingHint}>
                {ratingLabel}
              </th>
            </tr>
          </thead>
          <tbody className="tabular">
            {shown.slice(0, limit).map((r) => {
              const rank = rows.indexOf(r) + 1;
              const width = Math.max(0, Math.min(1, r.vsAverage / best));
              return (
                <tr key={r.id} className="border-t border-line transition hover:bg-raised/60">
                  <td className="px-4 py-2.5 text-ink-3">{rank}</td>
                  <td className="py-2.5">
                    <div className="flex items-center gap-2.5">
                      <span className="relative shrink-0">
                        <PlayerPhoto league={league} id={r.id} name={r.name} size={32} ring={r.team.color} />
                        <span className="absolute -bottom-1 -right-1 rounded-full bg-surface">
                          <TeamLogo src={r.team.logo} abbr={r.team.abbr} size={14} />
                        </span>
                      </span>
                      <span className="min-w-0">
                        <Link href={`/${league}/player/${r.id}`} className="block truncate font-medium text-ink hover:underline">
                          {r.name}
                        </Link>
                        <span className="block text-xs text-ink-3">{r.team.shortName}</span>
                      </span>
                    </div>
                  </td>
                  <td className="py-2.5 text-right text-ink-2">{Math.round(r.volume)}</td>
                  <td className="py-2.5 pl-6 pr-4">
                    <div className="flex items-center gap-3">
                      <span className="w-14 font-semibold text-ink">{r.rating.toFixed(decimals)}</span>
                      <span className={`w-12 text-xs ${r.vsAverage >= 0 ? 'text-good' : 'text-bad'}`}>{signed(r.vsAverage, decimals)}</span>
                      <span className="hidden h-1.5 flex-1 overflow-hidden rounded-full bg-track sm:block" aria-hidden>
                        <span
                          className="block h-full rounded-full"
                          style={{ width: `${(width * 100).toFixed(1)}%`, backgroundImage: `linear-gradient(90deg, ${r.team.color}66, ${r.team.color})` }}
                        />
                      </span>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {shown.length === 0 && <p className="px-4 py-8 text-center text-sm text-ink-3">No players match.</p>}
      </div>
      {shown.length > limit && (
        <button
          type="button"
          onClick={() => setLimit((n) => n + PAGE)}
          className="mt-3 w-full rounded-xl py-2 text-sm text-ink-2 ring-1 ring-line hover:text-ink hover:ring-line-strong"
        >
          Show more ({(shown.length - limit).toLocaleString()} left)
        </button>
      )}
    </div>
  );
}
