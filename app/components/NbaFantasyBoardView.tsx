'use client';

import { Search } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { nbaFantasyPoints, nbaFantasyRange, nbaStartSit, type NbaFantasyGroup } from '../../lib/model/nbaFantasy';
import type { NbaFantasyRow } from '../../lib/model/nbaFantasyBoard';
import { searchable } from '../../lib/search';
import { LocalTime } from './LocalTime';
import { PlayerPhoto } from './PlayerPhoto';
import { TeamLogo } from './TeamLogo';

const GROUPS: { id: NbaFantasyGroup | 'ALL'; label: string }[] = [
  { id: 'ALL', label: 'All' },
  { id: 'G', label: 'Guards' },
  { id: 'F', label: 'Forwards' },
  { id: 'C', label: 'Centers' }
];
const PAGE = 50;
const one = (n: number) => n.toFixed(1);

/**
 * Fantasy basketball rankings: the next night's games, or the rest of the fantasy week (each player's
 * projection times the games his team has left). Ranked by points discounted for the chance he sits;
 * tap two players to compare them.
 */
export function NbaFantasyBoardView({ rows, day, dayLabel }: { rows: NbaFantasyRow[]; day: string; dayLabel: string }) {
  const [view, setView] = useState<'night' | 'week'>('night');
  const [group, setGroup] = useState<(typeof GROUPS)[number]['id']>('ALL');
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(PAGE);
  const [chosen, setChosen] = useState<string[]>([]);

  const ranked = useMemo(() => {
    const scored = rows
      .filter((r) => (view === 'night' ? r.day === day : r.weekLeft > 0))
      .map((r) => {
        const points = nbaFantasyPoints(r.projected);
        const week = points * r.weekLeft;
        return { ...r, points, week, expected: (view === 'night' ? points : week) * r.available, last5: r.recent ? nbaFantasyPoints(r.recent) : null, average: r.season ? nbaFantasyPoints(r.season) : null };
      })
      .sort((a, b) => b.expected - a.expected || a.name.localeCompare(b.name));
    return scored.map((r, i) => ({ ...r, rank: i + 1 }));
  }, [rows, view, day]);
  const wanted = searchable(query);
  const shown = ranked.filter((r) => (group === 'ALL' || r.group === group) && (!wanted || searchable(`${r.name} ${r.team.abbr}`).includes(wanted)));
  const toggle = (id: string) => setChosen((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id].slice(-2)));
  const picked = chosen.map((id) => rows.find((r) => r.id === id)).filter((r): r is NbaFantasyRow => !!r);
  const call = picked.length === 2 ? nbaStartSit(nbaFantasyPoints(picked[0].projected), nbaFantasyPoints(picked[1].projected)) : null;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1.5" role="group" aria-label="Which games">
          <button type="button" aria-pressed={view === 'night'} onClick={() => setView('night')} className={`chip ${view === 'night' ? 'chip-active' : 'chip-idle'}`}>
            {dayLabel}
          </button>
          <button type="button" aria-pressed={view === 'week'} onClick={() => setView('week')} className={`chip ${view === 'week' ? 'chip-active' : 'chip-idle'}`}>
            Rest of the week
          </button>
        </div>
        <label className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-lg bg-surface px-3 ring-1 ring-line focus-within:ring-accent sm:max-w-xs">
          <Search className="h-4 w-4 shrink-0 text-ink-3" aria-hidden />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a player or team" className="w-full bg-transparent text-sm text-ink placeholder:text-ink-3 focus:outline-none" aria-label="Find a player or team" />
        </label>
      </div>
      <div className="scrollbar-none -mx-4 mt-3 flex gap-1.5 overflow-x-auto px-4 sm:mx-0 sm:px-0" role="group" aria-label="Position">
        {GROUPS.map((g) => (
          <button
            key={g.id}
            type="button"
            aria-pressed={group === g.id}
            onClick={() => {
              setGroup(g.id);
              setLimit(PAGE);
            }}
            className={`chip ${group === g.id ? 'chip-active' : 'chip-idle'}`}
          >
            {g.label}
          </button>
        ))}
      </div>
      {view === 'week' && <p className="mt-3 text-xs text-ink-3">Each player&apos;s next projection times the games his team has left this week (Monday to Sunday). Injuries and rest days later in the week aren&apos;t known yet.</p>}

      {picked.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl bg-accent/10 px-3 py-2 text-sm ring-1 ring-accent/40">
          {call ? (
            <span className="min-w-0 flex-1">
              <span className="text-ink-2">
                {call.favorite === 'left' ? picked[0].name : picked[1].name} is projected {call.gap.toFixed(1)} more a game. At that gap, the higher-projected player has outscored the other <span className="font-semibold text-ink">{Math.round(call.chance * 100)}%</span> of the time.
                {picked[0].weekLeft !== picked[1].weekLeft && ` Games left this week: ${picked[0].name} ${picked[0].weekLeft}, ${picked[1].name} ${picked[1].weekLeft}.`}{' '}
              </span>
              <Link href={`/nba/compare?a=${picked[0].id}&b=${picked[1].id}`} className="font-semibold text-ink underline underline-offset-2">
                Compare them →
              </Link>
            </span>
          ) : (
            <span className="text-ink-2">{picked[0].name}: pick one more to compare</span>
          )}
          <button type="button" onClick={() => setChosen([])} className="ml-auto text-xs text-ink-3 hover:text-ink">
            Clear
          </button>
        </div>
      )}

      <div className="card mt-3 overflow-x-auto p-0">
        <table className="w-full text-sm">
          <caption className="sr-only">{view === 'night' ? `Projected fantasy points, ${dayLabel}` : 'Projected fantasy points for the rest of the week'}</caption>
          <thead>
            <tr className="border-b border-line text-left text-xs text-ink-3">
              <th scope="col" className="w-10 py-3 pl-3 pr-2 font-medium sm:px-4">
                #
              </th>
              <th scope="col" className="py-3 font-medium">
                Player
              </th>
              <th scope="col" className="hidden py-3 font-medium sm:table-cell">
                {view === 'night' ? 'Game' : 'Next'}
              </th>
              <th scope="col" className="hidden py-3 pl-3 text-right font-medium md:table-cell" title="Points, rebounds and assists projected">
                Pts · Reb · Ast
              </th>
              {view === 'week' && (
                <th scope="col" className="py-3 pl-3 text-right font-medium" title="Games his team has left this week">
                  G
                </th>
              )}
              <th scope="col" className="py-3 pl-3 text-right font-medium" title={view === 'night' ? 'Projected fantasy points if he plays' : 'Projected fantasy points over the rest of the week if he plays every game'}>
                {view === 'night' ? 'Proj' : 'Week'}
              </th>
              {view === 'night' ? (
                <th scope="col" className="hidden py-3 pl-3 text-right font-medium sm:table-cell" title="Half of real scores have landed inside this range around a night's projection">
                  Range
                </th>
              ) : (
                <th scope="col" className="hidden py-3 pl-3 text-right font-medium sm:table-cell" title="Projected fantasy points in his next game">
                  Per game
                </th>
              )}
              <th scope="col" className="py-3 pl-3 text-right font-medium" title="His average over his last five games">
                L5
              </th>
              <th scope="col" className="hidden py-3 pl-3 text-right font-medium sm:table-cell" title="His average this season">
                Avg
              </th>
              <th scope="col" className="py-3 pl-2 pr-3 text-right font-medium sm:px-4">
                <span className="sr-only">Compare</span>
              </th>
            </tr>
          </thead>
          <tbody className="tabular">
            {shown.slice(0, limit).map((r) => {
              const [low, high] = nbaFantasyRange(r.points);
              const isChosen = chosen.includes(r.id);
              return (
                <tr key={r.id} className={`border-t border-line transition hover:bg-raised/60 ${isChosen ? 'bg-accent/10' : ''}`}>
                  <td className="whitespace-nowrap py-2 pl-3 pr-2 text-xs text-ink-3 sm:px-4">{r.rank}</td>
                  <td className="py-2">
                    <div className="flex items-center gap-2.5">
                      <span className="relative hidden shrink-0 sm:block">
                        <PlayerPhoto league="nba" id={r.id} name={r.name} size={32} ring={r.team.color} />
                        <span className="absolute -bottom-1 -right-1 rounded-full bg-surface">
                          <TeamLogo src={r.team.logo} abbr={r.team.abbr} size={14} />
                        </span>
                      </span>
                      <span className="min-w-0">
                        <Link href={`/nba/player/${r.id}`} className="block font-medium leading-tight text-ink hover:underline">
                          {r.name}
                        </Link>
                        <span className="block whitespace-nowrap text-xs text-ink-3">
                          {r.position && <span className="mr-1">{r.position}</span>}
                          <span className="sm:hidden">
                            · {r.team.abbr} {r.home ? 'vs' : '@'} {r.opponent} · <LocalTime iso={r.start} show={view === 'night' ? 'time' : 'day'} />
                          </span>
                          <span className="hidden sm:inline">· {r.team.abbr} · {Math.round(r.minutes)} min</span>
                        </span>
                        {r.status && <span className="block text-xs font-medium text-warn">{r.status}</span>}
                      </span>
                    </div>
                  </td>
                  <td className="hidden whitespace-nowrap py-2 text-xs text-ink-2 sm:table-cell">
                    <Link href={`/nba/game/${r.gameId}`} className="hover:underline">
                      {r.home ? 'vs' : '@'} {r.opponent}
                    </Link>
                    <span className="block text-ink-3">
                      <LocalTime iso={r.start} show={view === 'night' ? 'time' : 'day-time'} />
                    </span>
                  </td>
                  <td className="hidden whitespace-nowrap py-2 pl-3 text-right text-xs text-ink-2 md:table-cell">
                    {one(r.projected.pts)} · {one(r.projected.reb)} · {one(r.projected.ast)}
                  </td>
                  {view === 'week' && <td className="py-2 pl-3 text-right text-ink-2">{r.weekLeft}</td>}
                  <td className="py-2 pl-3 text-right font-semibold text-ink">{one(view === 'night' ? r.points : r.week)}</td>
                  <td className="hidden whitespace-nowrap py-2 pl-3 text-right text-xs text-ink-3 sm:table-cell">{view === 'night' ? `${low.toFixed(0)}–${high.toFixed(0)}` : one(r.points)}</td>
                  <td className="py-2 pl-3 text-right text-ink-2">{r.last5 === null ? '—' : one(r.last5)}</td>
                  <td className="hidden py-2 pl-3 text-right text-ink-2 sm:table-cell">{r.average === null ? '—' : one(r.average)}</td>
                  <td className="py-2 pl-2 pr-3 text-right sm:px-4">
                    <button type="button" onClick={() => toggle(r.id)} aria-pressed={isChosen} aria-label={`Compare ${r.name}`} className={`chip px-2 py-0.5 text-xs ${isChosen ? 'chip-active' : 'chip-idle'}`}>
                      {isChosen ? '✓' : '+'}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!shown.length && <p className="p-4 text-sm text-ink-3">No one matches. Clear the search or pick another position.</p>}
      </div>
      {shown.length > limit && (
        <button type="button" onClick={() => setLimit((l) => l + PAGE)} className="chip chip-idle mt-3 w-full justify-center">
          Show more ({shown.length - limit} left)
        </button>
      )}
    </div>
  );
}
