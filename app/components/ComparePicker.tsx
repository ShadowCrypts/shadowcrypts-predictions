'use client';

import { ArrowLeftRight } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useState } from 'react';
import { findPlayers, PlayerHit, PLAYERS_URL } from '../../lib/search';

type Chosen = { id: string; name: string } | null;

/** The league's players for the search boxes, fetched once either box is first used; null until then. */
function usePlayers(wanted: boolean, league: string) {
  const [list, setList] = useState<PlayerHit[] | null>(null);
  useEffect(() => {
    if (!wanted || list) return;
    let live = true;
    fetch(PLAYERS_URL)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data: { players: PlayerHit[] }) => live && setList(data.players.filter((p) => p.league === league)))
      .catch(() => live && setList([]));
    return () => {
      live = false;
    };
  }, [wanted, list, league]);
  return list;
}

/** A search box that picks one player: type a name, choose from the matches. */
function PlayerField({ label, chosen, players, onWant, onPick }: { label: string; chosen: Chosen; players: PlayerHit[] | null; onWant: () => void; onPick: (p: PlayerHit) => void }) {
  const [query, setQuery] = useState(chosen?.name ?? '');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();
  const hits = open && players ? findPlayers(players, query, 6) : [];
  const pick = (p: PlayerHit) => {
    setQuery(p.name);
    setOpen(false);
    onPick(p);
  };
  return (
    <div className="relative min-w-0 flex-1">
      <label className="mb-1 block text-xs font-medium text-ink-3" htmlFor={`${listId}-input`}>
        {label}
      </label>
      <input
        id={`${listId}-input`}
        type="search"
        role="combobox"
        aria-expanded={hits.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={hits.length ? `${listId}-${active}` : undefined}
        autoComplete="off"
        placeholder="Type a name"
        value={query}
        onFocus={() => {
          onWant();
          setOpen(true);
        }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (!hits.length) return;
          if (e.key === 'ArrowDown') setActive((i) => Math.min(hits.length - 1, i + 1));
          else if (e.key === 'ArrowUp') setActive((i) => Math.max(0, i - 1));
          else if (e.key === 'Enter') pick(hits[active] ?? hits[0]);
          else if (e.key === 'Escape') setOpen(false);
          else return;
          e.preventDefault();
        }}
        className="w-full rounded-lg bg-surface px-3 py-2 text-sm text-ink ring-1 ring-line placeholder:text-ink-3 focus:outline-none focus:ring-accent"
      />
      {hits.length > 0 && (
        <ul id={listId} role="listbox" aria-label={`${label} matches`} className="absolute inset-x-0 top-full z-20 mt-1 overflow-hidden rounded-lg bg-raised py-1 shadow-xl ring-1 ring-line-strong">
          {hits.map((p, i) => (
            <li
              key={p.id}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(p);
              }}
              onMouseEnter={() => setActive(i)}
              className={`flex cursor-pointer items-baseline justify-between gap-3 px-3 py-2 text-sm ${i === active ? 'bg-accent/15 text-ink' : 'text-ink-2'}`}
            >
              <span className="truncate">{p.name}</span>
              <span className="shrink-0 text-xs text-ink-3">{p.team}</span>
            </li>
          ))}
        </ul>
      )}
      {open && players?.length === 0 && <p className="mt-1 text-xs text-ink-3">The player list didn&apos;t load. Try again in a moment.</p>}
    </div>
  );
}

/** Two player search boxes; choosing one reloads the comparison with that player. */
export function ComparePicker({ league, a, b }: { league: string; a: Chosen; b: Chosen }) {
  const router = useRouter();
  const [wanted, setWanted] = useState(false);
  const players = usePlayers(wanted, league);
  const go = (next: { a?: string; b?: string }) => {
    const query = new URLSearchParams();
    if (next.a) query.set('a', next.a);
    if (next.b) query.set('b', next.b);
    router.push(`/${league}/compare${query.size ? `?${query}` : ''}`, { scroll: false });
  };
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
      <PlayerField key={`a-${a?.id ?? ''}`} label="First player" chosen={a} players={players} onWant={() => setWanted(true)} onPick={(p) => go({ a: p.id, b: b?.id })} />
      <button
        type="button"
        onClick={() => go({ a: b?.id, b: a?.id })}
        disabled={!a && !b}
        className="self-center rounded-full bg-surface p-2 text-ink-2 ring-1 ring-line transition hover:bg-raised hover:text-ink disabled:opacity-40 sm:mb-0.5"
        aria-label="Swap players"
        title="Swap players"
      >
        <ArrowLeftRight className="h-4 w-4" aria-hidden />
      </button>
      <PlayerField key={`b-${b?.id ?? ''}`} label="Second player" chosen={b} players={players} onWant={() => setWanted(true)} onPick={(p) => go({ a: a?.id, b: p.id })} />
    </div>
  );
}
