'use client';

import { Search, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { pct } from '../../lib/format';
import type { FollowedPlayer } from '../../lib/model/followedPlayers';
import { marketLabel } from '../../lib/props';
import { findPlayers, PlayerHit, PLAYERS_URL } from '../../lib/search';
import { ChanceBar } from './ChanceBar';
import { LineValue } from './LineValue';
import { LocalTime } from './LocalTime';
import { ParlayLeg, useParlay } from './parlay';
import { PlayerPhoto } from './PlayerPhoto';
import { LegButton } from './PlayerProps';

type Line = FollowedPlayer['lines'][number];

/** The same leg the game pages and the props board make, so adding it here or there is the same leg. */
function legFor(p: FollowedPlayer, l: Line, side: 'over' | 'under'): ParlayLeg {
  const group = `${p.league}:${p.next!.gameId}:${p.id}:${l.market}`;
  return {
    key: `${group}:${side}`,
    group,
    league: p.league,
    gameId: p.next!.gameId,
    game: p.next!.label,
    start: p.next!.date,
    label: `${p.name} ${side} ${l.line} ${marketLabel(l.market).long}`,
    prob: side === 'over' ? l.over : 1 - l.over,
    price: side === 'over' ? l.prices.over : l.prices.under,
    book: l.prices.book,
    link: { kind: 'prop', playerId: p.id, teamId: p.teamId, market: l.market, side },
    line: l.line
  };
}

/** Search any player and add his next game's lines to the parlay from here, without going to his game first. */
export function QuickAdd() {
  const [query, setQuery] = useState('');
  const [players, setPlayers] = useState<PlayerHit[] | null | 'failed'>(null);
  const [wanted, setWanted] = useState(false);
  const [picked, setPicked] = useState<PlayerHit | null>(null);
  const [detail, setDetail] = useState<{ key: string; player: FollowedPlayer | null } | null>(null);
  const { legs, toggle } = useParlay();
  const chosen = new Set(legs.map((l) => l.key));

  // The player list loads once, when the box is first used.
  useEffect(() => {
    if (!wanted || players !== null) return;
    let live = true;
    fetch(PLAYERS_URL)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((body: { players: PlayerHit[] }) => live && setPlayers(body.players))
      .catch(() => live && setPlayers('failed'));
    return () => {
      live = false;
    };
  }, [wanted, players]);

  const pickedKey = picked ? `${picked.league}:${picked.id}` : null;
  useEffect(() => {
    if (!pickedKey) return;
    let live = true;
    fetch(`/api/players/next?lines=all&ids=${encodeURIComponent(pickedKey)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((body: { players: FollowedPlayer[] }) => live && setDetail({ key: pickedKey, player: body.players[0] ?? null }))
      .catch(() => live && setDetail({ key: pickedKey, player: null }));
    return () => {
      live = false;
    };
  }, [pickedKey]);

  const matches = useMemo(() => (Array.isArray(players) ? findPlayers(players, query, 6) : []), [players, query]);
  const shown = detail && detail.key === pickedKey ? detail.player : undefined;

  return (
    <section className="card space-y-3 p-4 sm:p-5" aria-labelledby="quick-add-title">
      <h2 id="quick-add-title" className="font-display text-base font-semibold text-ink">
        Add a player prop
      </h2>
      {!picked ? (
        <div>
          <label className="flex h-10 items-center gap-2 rounded-lg bg-surface px-3 ring-1 ring-line focus-within:ring-accent">
            <Search className="h-4 w-4 shrink-0 text-ink-3" aria-hidden />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onFocus={() => setWanted(true)}
              placeholder="Any NBA, NHL or NFL player"
              className="w-full bg-transparent text-sm text-ink placeholder:text-ink-3 focus:outline-none"
              aria-label="Find a player to add to your parlay"
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          {players === 'failed' && <p className="mt-2 text-xs text-ink-3">Player search is unavailable right now.</p>}
          {query.trim().length >= 2 && players === null && <p className="mt-2 text-xs text-ink-3">Loading players…</p>}
          {matches.length > 0 && (
            <ul className="mt-2 grid gap-1 sm:grid-cols-2">
              {matches.map((p) => (
                <li key={`${p.league}:${p.id}`}>
                  <button
                    type="button"
                    onClick={() => setPicked(p)}
                    className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left ring-1 ring-line transition hover:bg-raised hover:ring-line-strong"
                  >
                    <PlayerPhoto league={p.league} id={p.id} name={p.name} size={28} />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-ink">{p.name}</span>
                      <span className="block text-xs text-ink-3">
                        {p.team ? `${p.team} · ` : ''}
                        {p.league.toUpperCase()}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <PlayerPhoto league={picked.league} id={picked.id} name={picked.name} size={40} ring={shown?.teamColor} />
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold text-ink">{picked.name}</p>
              <p className="truncate text-xs text-ink-3">
                {shown?.next ? (
                  <>
                    {shown.next.label} · <LocalTime iso={shown.next.date} />
                  </>
                ) : shown === undefined ? (
                  'Loading his lines…'
                ) : (
                  'No game on the board yet'
                )}
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setPicked(null);
                setQuery('');
              }}
              className="rounded-md p-1.5 text-ink-3 hover:bg-raised hover:text-ink"
              aria-label="Choose another player"
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          </div>
          {shown?.next && shown.lines.length ? (
            <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
              <table className="w-full min-w-[380px] text-left text-sm tabular">
                <thead>
                  <tr className="border-b border-line text-xs text-ink-3">
                    <th className="py-2 pr-3 font-medium">Stat</th>
                    <th className="py-2 pr-3 text-right font-medium">Line</th>
                    <th className="py-2 pr-3 text-right font-medium">Over</th>
                    <th className="py-2 text-right font-medium">Add</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.lines.map((l) => (
                    <tr key={l.market} className="border-b border-line/60 last:border-0">
                      <td className="py-2 pr-3 text-ink-2">{l.label}</td>
                      <td className="py-2 pr-3 text-right text-ink-2">
                        <LineValue line={l.line} openLine={l.openLine} />
                      </td>
                      <td className="py-2 pr-3 text-right">
                        <span className="inline-flex flex-col items-end">
                          <span className={l.over >= 0.5 ? 'font-semibold text-accent-strong' : 'text-ink-2'}>{pct(l.over)}</span>
                          <ChanceBar chance={l.over} />
                        </span>
                      </td>
                      <td className="py-2 text-right">
                        <span className="inline-flex gap-1.5">
                          {(['over', 'under'] as const).map((side) => {
                            const leg = legFor(shown, l, side);
                            return (
                              <LegButton
                                key={side}
                                leg={leg}
                                side={side === 'over' ? 'Over' : 'Under'}
                                price={leg.price}
                                active={chosen.has(leg.key)}
                                disabled={shown.next!.state !== 'pre' && !chosen.has(leg.key)}
                                onToggle={toggle}
                              />
                            );
                          })}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : shown !== undefined ? (
            <p className="text-sm text-ink-3">
              {shown?.injury?.toLowerCase() === 'out'
                ? 'He’s out, per the injury report, and books don’t post lines for a player ruled out.'
                : shown?.next
                  ? 'No lines posted for his next game yet. Books usually post them the day before.'
                  : 'His lines show here once his next game is on the board.'}
            </p>
          ) : null}
        </div>
      )}
    </section>
  );
}
