'use client';

import { Search } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { FANTASY_RANGE, FantasyPosition, fantasyPoints, FantasyScoring, FLEX, projectedPoints, startSit } from '../../lib/model/fantasy';
import type { FantasyRow } from '../../lib/model/fantasyBoard';
import { searchable } from '../../lib/search';
import { LocalTime } from './LocalTime';
import { PlayerPhoto } from './PlayerPhoto';
import { TeamLogo } from './TeamLogo';

const SCORING: { id: FantasyScoring; label: string }[] = [
  { id: 'ppr', label: 'PPR' },
  { id: 'half', label: 'Half PPR' },
  { id: 'standard', label: 'Standard' }
];
const VIEWS: { id: FantasyPosition | 'ALL' | 'FLEX'; label: string }[] = [
  { id: 'ALL', label: 'All' },
  { id: 'QB', label: 'QB' },
  { id: 'RB', label: 'RB' },
  { id: 'WR', label: 'WR' },
  { id: 'TE', label: 'TE' },
  { id: 'FLEX', label: 'Flex' }
];
const PAGE = 50;

/** Weekly fantasy rankings: any scoring, any position, ranked by points discounted for the chance he sits. Tap two players to compare them. */
export function FantasyBoardView({ rows }: { rows: FantasyRow[] }) {
  const [scoring, setScoring] = useState<FantasyScoring>('ppr');
  const [view, setView] = useState<(typeof VIEWS)[number]['id']>('ALL');
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(PAGE);
  const [chosen, setChosen] = useState<string[]>([]);

  const ranked = useMemo(() => {
    const scored = rows
      .map((r) => {
        const points = projectedPoints(r.projected, r.position, scoring);
        return { ...r, points, expected: points * r.available, last3: r.recent ? fantasyPoints(r.recent, scoring) : null, average: r.season ? fantasyPoints(r.season, scoring) : null };
      })
      .sort((a, b) => b.expected - a.expected || a.name.localeCompare(b.name));
    // Each player's rank at his own position, whatever list he's showing in.
    const seen = new Map<string, number>();
    return scored.map((r) => {
      const at = (seen.get(r.position) ?? 0) + 1;
      seen.set(r.position, at);
      return { ...r, positionRank: at };
    });
  }, [rows, scoring]);
  const wanted = searchable(query);
  const shown = ranked.filter((r) => (view === 'ALL' ? true : view === 'FLEX' ? FLEX.includes(r.position) : r.position === view) && (!wanted || searchable(`${r.name} ${r.team.abbr}`).includes(wanted)));
  const toggle = (id: string) => setChosen((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id].slice(-2)));
  const picked = chosen.map((id) => rows.find((r) => r.id === id)).filter((r): r is FantasyRow => !!r);
  const call = picked.length === 2 ? startSit(picked[0].projected, picked[0].position, picked[1].projected, picked[1].position) : null;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1.5" role="group" aria-label="Scoring">
          {SCORING.map((s) => (
            <button key={s.id} type="button" aria-pressed={scoring === s.id} onClick={() => setScoring(s.id)} className={`chip ${scoring === s.id ? 'chip-active' : 'chip-idle'}`}>
              {s.label}
            </button>
          ))}
        </div>
        <label className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-lg bg-surface px-3 ring-1 ring-line focus-within:ring-accent sm:max-w-xs">
          <Search className="h-4 w-4 shrink-0 text-ink-3" aria-hidden />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a player or team" className="w-full bg-transparent text-sm text-ink placeholder:text-ink-3 focus:outline-none" aria-label="Find a player or team" />
        </label>
      </div>
      <div className="scrollbar-none -mx-4 mt-3 flex gap-1.5 overflow-x-auto px-4 sm:mx-0 sm:px-0" role="group" aria-label="Position">
        {VIEWS.map((v) => (
          <button
            key={v.id}
            type="button"
            aria-pressed={view === v.id}
            onClick={() => {
              setView(v.id);
              setLimit(PAGE);
            }}
            className={`chip ${view === v.id ? 'chip-active' : 'chip-idle'}`}
          >
            {v.label}
          </button>
        ))}
      </div>

      {picked.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl bg-accent/10 px-3 py-2 text-sm ring-1 ring-accent/40">
          {call ? (
            <span className="min-w-0 flex-1">
              <span className="text-ink-2">
                {call.favorite === 'left' ? picked[0].name : picked[1].name} is projected {call.gap.toFixed(1)} more in PPR. At that gap, the higher-projected player has outscored the other <span className="font-semibold text-ink">{Math.round(call.chance * 100)}%</span> of the time.{' '}
              </span>
              <Link href={`/nfl/compare?a=${picked[0].id}&b=${picked[1].id}`} className="font-semibold text-ink underline underline-offset-2">
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
          <caption className="sr-only">Projected fantasy points this week</caption>
          <thead>
            <tr className="border-b border-line text-left text-xs text-ink-3">
              <th scope="col" className="w-12 py-3 pl-3 pr-2 font-medium sm:px-4">
                #
              </th>
              <th scope="col" className="py-3 font-medium">
                Player
              </th>
              <th scope="col" className="hidden py-3 font-medium sm:table-cell">
                Game
              </th>
              <th scope="col" className="py-3 pl-3 text-right font-medium" title="Projected points if he plays">
                Proj
              </th>
              <th scope="col" className="hidden py-3 pl-3 text-right font-medium sm:table-cell" title="Half of real scores have landed inside this range around the projection">
                Range
              </th>
              <th scope="col" className="py-3 pl-3 text-right font-medium" title="His average over his last three games">
                L3
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
              const [low, high] = FANTASY_RANGE[r.position];
              const isChosen = chosen.includes(r.id);
              return (
                <tr key={`${r.id}-${r.gameId}`} className={`border-t border-line transition hover:bg-raised/60 ${isChosen ? 'bg-accent/10' : ''}`}>
                  <td className="whitespace-nowrap py-2 pl-3 pr-2 text-xs text-ink-3 sm:px-4">
                    {r.position}
                    {r.positionRank}
                  </td>
                  <td className="py-2">
                    <div className="flex items-center gap-2.5">
                      <span className="relative hidden shrink-0 sm:block">
                        <PlayerPhoto league="nfl" id={r.id} name={r.name} size={32} ring={r.team.color} />
                        <span className="absolute -bottom-1 -right-1 rounded-full bg-surface">
                          <TeamLogo src={r.team.logo} abbr={r.team.abbr} size={14} />
                        </span>
                      </span>
                      <span className="min-w-0">
                        <Link href={`/nfl/player/${r.id}`} className="block font-medium leading-tight text-ink hover:underline">
                          {r.name}
                        </Link>
                        {/* On a phone the game moves under the name, so the numbers fit without scrolling. Plain text: two stacked links are too close to tap apart. */}
                        <span className="block whitespace-nowrap text-xs text-ink-3 sm:hidden">
                          {r.team.abbr} {r.home ? 'vs' : '@'} {r.opponent} · <LocalTime iso={r.start} show="day" />
                        </span>
                        {r.status && <span className="block text-xs font-medium text-warn">{r.status}</span>}
                      </span>
                    </div>
                  </td>
                  <td className="hidden whitespace-nowrap py-2 text-xs text-ink-2 sm:table-cell">
                    <Link href={`/nfl/game/${r.gameId}`} className="hover:underline">
                      {r.home ? 'vs' : '@'} {r.opponent}
                    </Link>
                    <span className="block text-ink-3">
                      <LocalTime iso={r.start} show="day-time" />
                    </span>
                  </td>
                  <td className="py-2 pl-3 text-right font-semibold text-ink">{r.points.toFixed(1)}</td>
                  <td className="hidden whitespace-nowrap py-2 pl-3 text-right text-xs text-ink-3 sm:table-cell">
                    {(r.points * low).toFixed(0)}–{(r.points * high).toFixed(0)}
                  </td>
                  <td className="py-2 pl-3 text-right text-ink-2">{r.last3 === null ? '—' : r.last3.toFixed(1)}</td>
                  <td className="hidden py-2 pl-3 text-right text-ink-2 sm:table-cell">{r.average === null ? '—' : r.average.toFixed(1)}</td>
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
