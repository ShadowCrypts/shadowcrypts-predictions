'use client';

import { ArrowDownWideNarrow, Clock, Star } from 'lucide-react';
import { useMemo, useState } from 'react';
import { leagueName } from '../../lib/leagueName';
import type { LeagueId } from '../../lib/leagues';
import type { CardData } from '../../lib/model/card';
import { etDateKey, relativeDayLabel } from '../../lib/time';
import { CalendarButton } from './CalendarButton';
import { teamKey, useFavorites } from './favorites';
import { GameCard } from './GameCard';
import { EmptyState } from './Section';

type Status = 'all' | 'live' | 'upcoming' | 'final';
type Sort = 'time' | 'confidence';

const STATUS: { id: Status; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'live', label: 'Live' },
  { id: 'upcoming', label: 'Upcoming' },
  { id: 'final', label: 'Final' }
];

const matchesStatus = (card: CardData, status: Status) =>
  status === 'all' || (status === 'live' ? card.state === 'in' : status === 'upcoming' ? card.state === 'pre' : card.state === 'post');

function Chip({ active, onClick, children, label }: { active: boolean; onClick: () => void; children: React.ReactNode; label?: string }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={active} aria-label={label} className={`chip ${active ? 'chip-active' : 'chip-idle'}`}>
      {children}
    </button>
  );
}

const Count = ({ n }: { n: number }) => <span className="text-xs tabular text-ink-3">{n}</span>;

export function Board({ cards, leagues, emptyText }: { cards: CardData[]; leagues?: LeagueId[]; emptyText: string }) {
  const { favorites } = useFavorites();
  const [league, setLeague] = useState<LeagueId | 'all'>('all');
  const [status, setStatus] = useState<Status>('all');
  const [sort, setSort] = useState<Sort>('time');
  const [mine, setMine] = useState(false);

  const isMine = (c: CardData) => favorites.has(teamKey(c.league, c.home.teamId)) || favorites.has(teamKey(c.league, c.away.teamId));
  const multiLeague = (leagues?.length ?? 0) > 1;

  const visible = useMemo(
    () =>
      cards
        .filter((c) => (league === 'all' || c.league === league) && matchesStatus(c, status) && (!mine || isMine(c)))
        .sort((a, b) => (sort === 'time' ? a.date.localeCompare(b.date) : b.pickProb - a.pickProb)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cards, league, status, sort, mine, favorites]
  );

  const groups = useMemo(() => {
    if (sort !== 'time') return [['', visible] as const];
    const byDay = new Map<string, CardData[]>();
    for (const c of visible) {
      const key = etDateKey(c.date);
      byDay.set(key, [...(byDay.get(key) ?? []), c]);
    }
    return [...byDay];
  }, [visible, sort]);

  const liveCount = cards.filter((c) => c.state === 'in').length;
  const mineCount = cards.filter(isMine).length;

  return (
    <div>
      <div className="flex flex-col gap-3">
        {multiLeague && (
          <div className="scrollbar-none -mx-4 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:px-0" role="group" aria-label="League">
            <Chip active={league === 'all'} onClick={() => setLeague('all')}>
              All leagues <Count n={cards.length} />
            </Chip>
            {leagues!.map((id) => {
              const n = cards.filter((c) => c.league === id).length;
              return (
                <Chip key={id} active={league === id} onClick={() => setLeague(id)}>
                  {leagueName(id)} <Count n={n} />
                </Chip>
              );
            })}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-full bg-surface p-0.5 ring-1 ring-line" role="group" aria-label="Status">
            {STATUS.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setStatus(s.id)}
                aria-pressed={status === s.id}
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium transition ${
                  status === s.id ? 'bg-raised text-ink ring-1 ring-line-strong' : 'text-ink-3 hover:text-ink'
                }`}
              >
                {s.id === 'live' && liveCount > 0 && <span className="h-1.5 w-1.5 rounded-full bg-bad" aria-hidden />}
                {s.label}
                {s.id === 'live' && liveCount > 0 && <span className="tabular text-xs">{liveCount}</span>}
              </button>
            ))}
          </div>
          <Chip active={mine} onClick={() => setMine((m) => !m)} label={`My teams, ${mineCount} games`}>
            <Star className={`h-3.5 w-3.5 ${mine ? 'fill-warn text-warn' : ''}`} aria-hidden /> My teams <Count n={mineCount} />
          </Chip>
          {mine && <CalendarButton label="Add my teams to calendar" />}
          <button
            type="button"
            onClick={() => setSort((s) => (s === 'time' ? 'confidence' : 'time'))}
            className="chip chip-idle ml-auto"
            aria-label={`Sorted by ${sort === 'time' ? 'start time' : 'confidence'}; switch`}
          >
            {sort === 'time' ? <Clock className="h-3.5 w-3.5" aria-hidden /> : <ArrowDownWideNarrow className="h-3.5 w-3.5" aria-hidden />}
            {sort === 'time' ? 'By start time' : 'By confidence'}
          </button>
        </div>
      </div>

      <div className="mt-5 space-y-7">
        {visible.length === 0 ? (
          <EmptyState>
            {mine && mineCount === 0
              ? 'Follow teams with the star on any team or game page, and their games collect here.'
              : cards.length === 0
                ? emptyText
                : 'No games match these filters.'}
          </EmptyState>
        ) : (
          groups.map(([day, list]) => (
            <div key={day || 'all'}>
              {day && (
                <h3 className="mb-3 flex items-baseline gap-2 text-sm font-semibold text-ink">
                  {relativeDayLabel(day)}
                  <span className="text-xs font-normal text-ink-3">
                    {list.length} game{list.length === 1 ? '' : 's'}
                  </span>
                </h3>
              )}
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {list.map((c) => (
                  <GameCard key={c.id} card={c} showLeague={multiLeague} />
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
