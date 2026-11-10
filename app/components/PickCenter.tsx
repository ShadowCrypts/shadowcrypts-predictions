'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { pct } from '../../lib/format';
import { leagueName } from '../../lib/leagueName';
import type { LeagueId } from '../../lib/leagues';
import type { CardData } from '../../lib/model/card';
import { formatDay } from '../../lib/time';
import { picksShareCode } from '../../lib/picksShare';
import { LeagueTag } from './Badges';
import { ShareButton } from './ShareButton';
import { ChanceRing } from './ChanceRing';
import { LocalTime } from './LocalTime';
import { PickButtons } from './PickButtons';
import { counts, pickKey, usePicks } from './picks';
import { ProbabilityMeter } from './ProbabilityMeter';
import { EmptyState } from './Section';
import { TeamBadge, TeamGlow } from './TeamColors';

const winnerOf = (c: CardData) =>
  !c.completed || c.home.score === null || c.away.score === null || c.home.score === c.away.score ? null : c.home.score > c.away.score ? 'home' : 'away';

/** One side of the scoreboard: a ring of how often they called it, and the record under it. */
function Contender({ name, correct, graded, empty }: { name: string; correct: number; graded: number; empty: string }) {
  return (
    <div className="flex flex-col items-center text-center">
      <ChanceRing value={graded ? correct / graded : null} size={104} label={`${name}, picks correct`} caption="correct" />
      <p className="mt-2 font-display text-base font-semibold text-ink">{name}</p>
      <p className="text-xs text-ink-3 tabular">{graded ? `${correct}–${graded - correct}` : empty}</p>
    </div>
  );
}

/** Pick upcoming games and track your record against the model on the same games. */
export function PickCenter({ upcoming }: { upcoming: CardData[] }) {
  const { picks } = usePicks();
  const [fetched, setFetched] = useState<CardData[]>([]);
  const [league, setLeague] = useState<LeagueId | 'all'>('all');

  // Picked games no longer on the board (finished ones) come from the API.
  const missing = useMemo(() => {
    const onBoard = new Set(upcoming.map((c) => pickKey(c.league, c.id)));
    return Object.keys(picks).filter((k) => !onBoard.has(k));
  }, [picks, upcoming]);
  const missingKey = [...missing].sort().join(',');
  useEffect(() => {
    if (!missingKey) return;
    fetch(`/api/cards?ids=${missingKey}`)
      .then((r) => (r.ok ? r.json() : { cards: [] }))
      .then((data: { cards: CardData[] }) => setFetched(data.cards))
      .catch(() => undefined);
  }, [missingKey]);

  const all = useMemo(() => {
    const byKey = new Map<string, CardData>();
    for (const c of [...fetched, ...upcoming]) byKey.set(pickKey(c.league, c.id), c);
    return byKey;
  }, [fetched, upcoming]);

  const graded = [...all.values()]
    .filter((c) => counts(picks[pickKey(c.league, c.id)], c.date) && winnerOf(c))
    .sort((a, b) => b.date.localeCompare(a.date));
  const yours = graded.filter((c) => picks[pickKey(c.league, c.id)].side === winnerOf(c)).length;
  const model = graded.filter((c) => c.pick === winnerOf(c)).length;
  const against = graded.filter((c) => picks[pickKey(c.league, c.id)].side !== c.pick);
  const againstWins = against.filter((c) => picks[pickKey(c.league, c.id)].side === winnerOf(c)).length;
  const pending = [...all.values()].filter((c) => counts(picks[pickKey(c.league, c.id)], c.date) && !c.completed).length;

  const leagues = [...new Set(upcoming.map((c) => c.league))];
  const open = upcoming.filter((c) => c.state === 'pre' && (league === 'all' || c.league === league));

  return (
    <div className="space-y-8">
      {/* You and the model on the same games, side by side. */}
      <div className="card relative overflow-hidden p-5 sm:p-6">
        <span className="pointer-events-none absolute -left-16 -top-20 h-56 w-56 rounded-full bg-accent/20 blur-3xl" aria-hidden />
        <span className="pointer-events-none absolute -bottom-20 -right-16 h-56 w-56 rounded-full bg-accent-2/15 blur-3xl" aria-hidden />
        <div className="relative grid gap-5 lg:grid-cols-[minmax(0,1fr)_16rem] lg:items-center">
          <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 sm:gap-6">
            <Contender name="You" correct={yours} graded={graded.length} empty="Make picks below" />
            <div className="text-center">
              <p className="font-display text-sm font-semibold uppercase tracking-[0.2em] text-ink-3">vs</p>
              {graded.length > 0 && (
                <>
                  <p className="mt-2 max-w-[9rem] text-xs font-medium text-ink-2">
                    {yours === model ? 'Dead even' : yours > model ? `You lead by ${yours - model}` : `The model leads by ${model - yours}`}
                  </p>
                  <div className="mt-3 flex justify-center">
                    <ShareButton
                      title="Can you beat the model?"
                      text={`I went ${yours}–${graded.length - yours} picking winners; the model went ${model}–${graded.length - model} on the same games.`}
                      url={`/picks/s/${picksShareCode({ yours: { won: yours, lost: graded.length - yours }, model: { won: model, lost: graded.length - model } })}`}
                    />
                  </div>
                </>
              )}
            </div>
            <Contender name="The model" correct={model} graded={graded.length} empty="Same games as yours" />
          </div>
          <dl className="grid grid-cols-2 gap-3 border-t border-line pt-4 text-sm lg:grid-cols-1 lg:gap-5 lg:border-l lg:border-t-0 lg:py-1 lg:pl-6">
            <div>
              <dt className="text-xs text-ink-3">Against the model</dt>
              <dd className="mt-0.5 font-display text-xl font-bold text-ink tabular">{against.length ? `${againstWins}–${against.length - againstWins}` : '—'}</dd>
              <dd className="text-xs text-ink-3">Games where you took the other side</dd>
            </div>
            <div>
              <dt className="text-xs text-ink-3">Waiting</dt>
              <dd className="mt-0.5 font-display text-xl font-bold text-ink tabular">{pending}</dd>
              <dd className="text-xs text-ink-3">Picks on games not finished yet</dd>
            </div>
          </dl>
        </div>
      </div>

      <section aria-labelledby="open-title">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="open-title" className="font-display text-lg font-semibold text-ink sm:text-xl">
              Open games
            </h2>
            <p className="mt-1 text-sm text-ink-2">Picks lock at the scheduled start. Tap your side again to clear it.</p>
          </div>
          {leagues.length > 1 && (
            <div className="flex flex-wrap gap-2" role="group" aria-label="League">
              {(['all', ...leagues] as const).map((id) => (
                <button key={id} type="button" onClick={() => setLeague(id)} aria-pressed={league === id} className={`chip ${league === id ? 'chip-active' : 'chip-idle'}`}>
                  {id === 'all' ? 'All' : leagueName(id)}
                </button>
              ))}
            </div>
          )}
        </div>
        {open.length ? (
          <ul className="grid gap-3 md:grid-cols-2">
            {open.map((c) => (
              <li key={c.id} className="card relative overflow-hidden p-4 pl-5">
                <TeamGlow away={c.away.color} home={c.home.color} strength={0.8} />
                <div className="relative">
                  <div className="flex items-center justify-between gap-2 text-xs text-ink-3">
                    <span className="flex items-center gap-2">
                      <LeagueTag league={leagueName(c.league)} />
                      <LocalTime iso={c.date} />
                    </span>
                    <Link href={`/${c.league}/game/${c.id}`} className="hover:text-ink hover:underline">
                      Preview →
                    </Link>
                  </div>
                  <div className="mt-3">
                    <PickButtons league={c.league} gameId={c.id} start={c.date} state={c.state} away={c.away} home={c.home} modelPick={c.pick} compact />
                  </div>
                  <div className="mt-3 flex items-center gap-3">
                    <span className="shrink-0 text-[11px] font-medium uppercase tracking-wider text-ink-3">Model</span>
                    <div className="min-w-0 flex-1">
                      <ProbabilityMeter awayAbbr={c.away.abbr} homeAbbr={c.home.abbr} homeProb={c.homeProb} pick={c.pick} colors={{ away: c.away.color, home: c.home.color }} />
                    </div>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState>No open games right now.</EmptyState>
        )}
      </section>

      <section aria-labelledby="history-title">
        <h2 id="history-title" className="mb-4 font-display text-lg font-semibold text-ink sm:text-xl">
          Your graded picks
        </h2>
        {graded.length ? (
          <ul className="card divide-y divide-line p-2">
            {graded.slice(0, 100).map((c) => {
              const side = picks[pickKey(c.league, c.id)].side;
              const team = side === 'home' ? c.home : c.away;
              const hit = side === winnerOf(c);
              return (
                <li key={c.id}>
                  <Link href={`/${c.league}/game/${c.id}`} className="flex items-center gap-3 rounded-lg px-2 py-2 text-sm hover:bg-raised">
                    <span className={`w-12 shrink-0 rounded-full py-0.5 text-center text-[11px] font-semibold ring-1 ${hit ? 'bg-good/10 text-good ring-good/30' : 'bg-bad/10 text-bad ring-bad/30'}`}>
                      {hit ? 'Hit' : 'Miss'}
                    </span>
                    <TeamBadge side={team} size={20} />
                    <span className="min-w-0 flex-1 truncate text-ink-2">
                      {c.away.abbr} {c.away.score} @ {c.home.abbr} {c.home.score}
                    </span>
                    <span className="hidden text-xs text-ink-3 sm:inline">
                      Model {(c.pick === 'home' ? c.home : c.away).abbr} {pct(c.pickProb)} · {c.correct ? 'hit' : 'miss'}
                    </span>
                    <span className="text-xs text-ink-3">{formatDay(c.date)}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        ) : (
          <EmptyState>Once games you&apos;ve picked are final, they&apos;re graded here next to the model.</EmptyState>
        )}
      </section>
    </div>
  );
}
