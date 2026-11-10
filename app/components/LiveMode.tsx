'use client';

import { Check, Clock, Minus, Radio, Trophy, X } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useMemo, useRef } from 'react';
import { pctCapped, shortStatus } from '../../lib/format';
import { LegResult, legId } from '../../lib/legs';
import type { CardData } from '../../lib/model/card';
import type { LiveBoard } from '../../lib/model/liveBoard';
import { formatAmerican } from '../../lib/model/market';
import { marketLabel } from '../../lib/props';
import { liveLegChance, liveParlayChance, settle } from '../../lib/parlay';
import { AlertSettings } from './AlertSettings';
import { notify } from './alerts';
import { AnimatedNumber } from './AnimatedNumber';
import { ChanceRing } from './ChanceRing';
import { confetti, confettiFrom } from './fx';
import { useViewerZone } from './LocalTime';
import type { ParlayLeg } from './parlay';
import { TrackedParlay, useParlayLog } from './parlayLog';
import { Sparkline } from './Sparkline';
import { ProbabilityMeter } from './ProbabilityMeter';
import { TeamBadge, TeamGlow } from './TeamColors';
import { TeamLogo } from './TeamLogo';
import { useLiveBoard } from './useLiveBoard';
import { useLiveLegs } from './useLiveLegs';
import { YourPlayers } from './YourPlayers';

/** A parlay stays on the live page this long after its last game starts, so a finish can be seen and celebrated. */
const KEEP_MS = 12 * 3_600_000;

type LegState = 'pre' | 'open' | 'won' | 'lost' | 'push' | 'void';
type LegView = { leg: ParlayLeg; state: LegState; current: number | null; chance: number | null; status: string | null };
type ParlayView = { parlay: TrackedParlay; state: 'pending' | 'won' | 'lost' | 'void' | 'push'; busted: boolean; cash: number | null; legs: LegView[] };

function viewOf(parlay: TrackedParlay, live: Record<string, LegResult>, now: number): ParlayView {
  const results: Record<string, LegResult | undefined> = parlay.results;
  const finals = Object.fromEntries(parlay.legs.map((l) => [l.key, results[l.key]?.state]));
  const { state } = settle(parlay.legs, parlay.price, finals);
  const current = Object.fromEntries(parlay.legs.map((l) => [l.key, results[l.key] ? undefined : live[legId(l) ?? '']]));
  const legs = parlay.legs.map((leg): LegView => {
    const final = results[leg.key];
    const running = current[leg.key];
    const decided = running?.live?.decided ?? null;
    const legState: LegState = final && final.state !== 'pending' ? final.state : decided ? decided : Date.parse(leg.start) <= now ? 'open' : 'pre';
    const chance =
      legState === 'won' ? 1 : legState === 'lost' ? 0 : legState === 'push' || legState === 'void' ? null : (liveLegChance(leg, running) ?? (running ? null : leg.prob));
    return { leg, state: legState, current: final?.actual ?? running?.actual ?? null, chance: chance === undefined ? leg.prob : chance, status: running?.live?.status ?? null };
  });
  const busted = state === 'lost' || legs.some((l) => l.state === 'lost');
  const cash = state === 'won' ? 1 : busted ? 0 : state === 'pending' ? liveParlayChance(parlay.legs, finals, current) : null;
  return { parlay, state, busted, cash, legs };
}

function LegMark({ state }: { state: LegState }) {
  const box = 'flex h-6 w-6 shrink-0 items-center justify-center rounded-full';
  if (state === 'won') return <span className={`${box} bg-good/15 text-good`}><Check className="h-3.5 w-3.5" aria-label="Hit" /></span>;
  if (state === 'lost') return <span className={`${box} bg-bad/15 text-bad`}><X className="h-3.5 w-3.5" aria-label="Missed" /></span>;
  if (state === 'open') return <span className={`${box} bg-live/15`}><span className="h-2 w-2 animate-pulse rounded-full bg-live" aria-label="In progress" /></span>;
  if (state === 'pre') return <span className={`${box} bg-raised text-ink-3`}><Clock className="h-3.5 w-3.5" aria-label="Not started" /></span>;
  return <span className={`${box} bg-raised text-ink-3`}><Minus className="h-3.5 w-3.5" aria-label={state === 'push' ? 'Push' : 'Void'} /></span>;
}

/** How far a prop leg has come: the stat so far against a scale past its line, with the line marked. */
function Progress({ view }: { view: LegView }) {
  const { leg, current, state, chance } = view;
  const link = leg.link;
  if (link?.kind === 'prop' && leg.line !== undefined) {
    const c = current ?? 0;
    const top = Math.max(leg.line * 1.6, c * 1.1, leg.line + 1);
    const past = c > leg.line;
    const tone = state === 'won' || (link.side === 'over' && past) ? 'bg-good' : state === 'lost' || (link.side === 'under' && past) ? 'bg-bad' : 'bg-accent';
    return (
      <div className="relative mt-2 h-2 rounded-full bg-track" aria-hidden>
        <div className={`absolute inset-y-0 left-0 rounded-full ${tone} transition-[width] duration-1000 ease-out`} style={{ width: `${((Math.min(c, top) / top) * 100).toFixed(1)}%` }} />
        <div className="absolute -inset-y-1 w-0.5 rounded bg-ink-2" style={{ left: `${((leg.line / top) * 100).toFixed(1)}%` }} title={`Line ${leg.line}`} />
      </div>
    );
  }
  const p = chance ?? leg.prob;
  return (
    <div className="relative mt-2 h-2 overflow-hidden rounded-full bg-track" aria-hidden>
      <div className={`absolute inset-y-0 left-0 rounded-full ${state === 'won' ? 'bg-good' : state === 'lost' ? 'bg-bad' : 'bg-accent-2'} transition-[width] duration-1000 ease-out`} style={{ width: `${(p * 100).toFixed(1)}%` }} />
    </div>
  );
}

function LegRow({ view, parlayId, time }: { view: LegView; parlayId: string; time: Intl.DateTimeFormat }) {
  const { leg, state, current, chance, status } = view;
  const prop = leg.link?.kind === 'prop' ? leg.link : null;
  const note =
    state === 'pre'
      ? `Starts ${time.format(new Date(leg.start))}`
      : state === 'open'
        ? [status ? shortStatus(status) : 'Under way', prop && current === null ? 'hasn’t played yet' : null].filter(Boolean).join(' · ')
        : state === 'won'
          ? 'Hit'
          : state === 'lost'
            ? 'Missed'
            : state === 'push'
              ? 'Push'
              : 'Didn’t play';
  return (
    <li data-leg={`${parlayId}|${leg.key}`} className="rounded-xl bg-raised/50 px-3 py-2.5 ring-1 ring-line/70">
      <div className="flex items-center gap-3">
        <LegMark state={state} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-ink">{leg.label}</p>
          <p className="truncate text-xs text-ink-3">
            <Link href={`/${leg.league}/game/${leg.gameId}`} className="hover:text-ink hover:underline">
              {leg.game}
            </Link>{' '}
            · {note}
          </p>
        </div>
        <div className="shrink-0 text-right">
          {prop && current !== null && (
            <p className="font-display text-lg font-bold leading-none tabular text-ink">
              <AnimatedNumber value={current} format={(v) => String(Math.round(v))} />
              <span className="ml-1 text-xs font-medium text-ink-3">/ {leg.line}</span>
            </p>
          )}
          <p className="mt-0.5 text-xs font-semibold tabular text-accent-strong">
            {chance === null ? '—' : state === 'won' || state === 'lost' ? '' : <AnimatedNumber value={chance} format={pctCapped} />}
            {prop && state !== 'won' && state !== 'lost' && chance !== null && <span className="font-normal text-ink-3"> {marketLabel(prop.market).short.toLowerCase()}</span>}
          </p>
        </div>
      </div>
      <Progress view={view} />
    </li>
  );
}

function ParlayLive({ view, time }: { view: ParlayView; time: Intl.DateTimeFormat }) {
  const { parlay, state, busted, cash, legs } = view;
  const cleared = legs.filter((l) => l.state === 'won').length;
  const badge =
    state === 'won'
      ? { text: 'Cashed', tone: 'bg-good/15 text-good ring-good/30' }
      : busted
        ? { text: 'Busted', tone: 'bg-bad/15 text-bad ring-bad/30' }
        : legs.some((l) => l.state === 'open')
          ? { text: `Live · ${cleared} of ${legs.length} in`, tone: 'bg-live/15 text-live ring-live/30' }
          : { text: `${cleared} of ${legs.length} in`, tone: 'bg-raised text-ink-2 ring-line' };
  return (
    <li id={`parlay-${parlay.id}`} className={`card overflow-hidden p-4 sm:p-5 ${state === 'won' ? 'shadow-glow' : ''} ${busted ? 'animate-shake' : ''}`}>
      <div className="flex items-center gap-4">
        <ChanceRing value={cash} label="Chance to cash" tone={state === 'won' ? 'good' : busted ? 'bad' : 'accent'} />
        <div className="min-w-0 flex-1">
          <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider ring-1 ${badge.tone}`}>
            {state === 'won' && <Trophy className="h-3 w-3" aria-hidden />}
            {badge.text}
          </span>
          <p className="mt-2 font-display text-lg font-semibold text-ink">
            {legs.length}-leg parlay{parlay.price !== null && <span className="text-ink-2"> · {formatAmerican(parlay.price)}</span>}
          </p>
          <p className="text-xs text-ink-3">
            Saved at {pctCapped(parlay.chance)}
            {cash !== null && state === 'pending' && !busted && Math.round(Math.abs(cash - parlay.chance) * 100) > 0 && (
              <span className={cash > parlay.chance ? 'text-good' : 'text-bad'}>
                {' '}
                · {cash > parlay.chance ? 'up' : 'down'} {Math.round(Math.abs(cash - parlay.chance) * 100)}{' '}
                {Math.round(Math.abs(cash - parlay.chance) * 100) === 1 ? 'pt' : 'pts'} since
              </span>
            )}
          </p>
        </div>
      </div>
      <ul className="mt-4 space-y-2">
        {legs.map((l) => (
          <LegRow key={l.leg.key} view={l} parlayId={parlay.id} time={time} />
        ))}
      </ul>
    </li>
  );
}

function WinBar({ card }: { card: CardData }) {
  const p = card.liveHomeProb ?? card.homeProb;
  const leader = p >= 0.5 ? card.home : card.away;
  return (
    <div className="mt-3">
      <ProbabilityMeter awayAbbr={card.away.abbr} homeAbbr={card.home.abbr} homeProb={p} pick={p >= 0.5 ? 'home' : 'away'} bare colors={{ away: card.away.color, home: card.home.color }} />
      <p className="mt-1.5 text-xs text-ink-2">
        <span className="font-semibold tabular text-ink">{leader.abbr} {pctCapped(Math.max(p, 1 - p))}</span> to win
        {card.state === 'in' ? ' now' : ''}
      </p>
    </div>
  );
}

function Side({ side, up, final }: { side: CardData['home']; up: boolean; final: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <TeamBadge side={side} size={30} />
      <p className={`min-w-0 flex-1 truncate font-medium ${up || !final ? 'text-ink' : 'text-ink-2'}`}>{side.shortName}</p>
      {side.score !== null && (
        <span key={side.score} className={`font-display text-2xl font-bold tabular ${up ? 'text-ink' : 'text-ink-2'} animate-score-pop`}>
          {side.score}
        </span>
      )}
    </div>
  );
}

function GameTile({ card, time, now }: { card: CardData; time: Intl.DateTimeFormat; now: number }) {
  const live = card.state === 'in';
  const homeUp = (card.home.score ?? 0) > (card.away.score ?? 0);
  const awayUp = (card.away.score ?? 0) > (card.home.score ?? 0);
  const mins = Math.round((Date.parse(card.date) - now) / 60_000);
  const countdown = mins <= 0 ? 'Starting' : mins < 60 ? `in ${mins} min` : `in ${Math.floor(mins / 60)}h ${mins % 60}m`;
  return (
    <li>
      <Link href={`/${card.league}/game/${card.id}`} className="card group relative block overflow-hidden p-4 transition hover:-translate-y-0.5 hover:shadow-glow">
        <TeamGlow away={card.away.color} home={card.home.color} />
        <div className="relative">
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="rounded bg-raised px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-ink-3 ring-1 ring-line">{card.league}</span>
            {live ? (
              <span className="flex items-center gap-1.5 font-semibold text-live">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-live" aria-hidden />
                {shortStatus(card.statusDetail)}
              </span>
            ) : card.completed ? (
              <span className={`font-semibold ${card.correct ? 'text-good' : 'text-ink-3'}`}>
                {shortStatus(card.statusDetail)} · forecast {card.correct ? 'hit' : 'missed'}
              </span>
            ) : (
              <span className="text-ink-3">
                {time.format(new Date(card.date))}
                {now > 0 && ` · ${countdown}`}
              </span>
            )}
          </div>
          <div className="mt-3 space-y-2">
            <Side side={card.away} up={awayUp} final={card.completed} />
            <Side side={card.home} up={homeUp} final={card.completed} />
          </div>
          {!card.completed && <WinBar card={card} />}
          {live && card.liveFlow && card.liveFlow.length > 1 && (
            <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-ink-3">
              <span>{card.home.abbr} win chance by period</span>
              <Sparkline values={[...card.liveFlow, card.liveHomeProb ?? card.homeProb]} width={88} height={22} label={`${card.home.abbr} win chance through the game`} />
            </div>
          )}
        </div>
      </Link>
    </li>
  );
}

function Games({ title, cards, time, now }: { title: string; cards: CardData[]; time: Intl.DateTimeFormat; now: number }) {
  if (!cards.length) return null;
  return (
    <section aria-label={title} className="space-y-3">
      <h2 className="font-display text-lg font-semibold text-ink">
        {title} <span className="text-sm font-medium text-ink-3">· {cards.length}</span>
      </h2>
      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {cards.map((c) => (
          <GameTile key={`${c.league}-${c.id}`} card={c} time={time} now={now} />
        ))}
      </ul>
    </section>
  );
}

/**
 * Everything happening now: tracked parlays sweating in real time (each leg
 * filling toward its line, the chance to cash on a ring) and every game on,
 * about to start or just finished. Celebrates legs that hit and parlays that
 * cash, and can send an alert for each.
 */
export function LiveMode({ initial }: { initial: LiveBoard | null }) {
  const board = useLiveBoard(initial);
  const { log, record } = useParlayLog();
  const { live, now } = useLiveLegs(log, record);
  const zone = useViewerZone();
  const time = useMemo(() => new Intl.DateTimeFormat('en-US', { timeZone: zone, hour: 'numeric', minute: '2-digit' }), [zone]);
  const updated = useMemo(() => new Intl.DateTimeFormat('en-US', { timeZone: zone, hour: 'numeric', minute: '2-digit', second: '2-digit' }), [zone]);

  const views = useMemo(
    () =>
      now
        ? log
            .filter((p) => {
              const starts = p.legs.map((l) => Date.parse(l.start));
              return starts.some((s) => s <= now) && now - Math.max(...starts) < KEEP_MS;
            })
            .map((p) => viewOf(p, live, now))
        : [],
    [log, live, now]
  );

  // Celebrate what changed since the last look (not what was already settled when the page opened).
  const seen = useRef<Map<string, string> | null>(null);
  const signature = views.map((v) => `${v.parlay.id}:${v.busted ? 'lost' : v.state}:${v.legs.map((l) => l.state).join(',')}`).join('|');
  useEffect(() => {
    const before = seen.current;
    const after = new Map<string, string>();
    for (const v of views) {
      const overall = v.state === 'won' ? 'won' : v.busted ? 'lost' : 'open';
      after.set(v.parlay.id, overall);
      for (const l of v.legs) after.set(`${v.parlay.id}|${l.leg.key}`, l.state);
      if (!before || !before.has(v.parlay.id)) continue;
      for (const l of v.legs) {
        const key = `${v.parlay.id}|${l.leg.key}`;
        if (before.get(key) === l.state) continue;
        if (l.state === 'won') {
          confettiFrom(document.querySelector(`[data-leg="${CSS.escape(key)}"]`), 45);
          notify('Leg hit ✓', l.leg.label, key);
        } else if (l.state === 'lost') {
          notify('Leg missed', l.leg.label, key);
        }
      }
      if (before.get(v.parlay.id) !== overall) {
        if (overall === 'won') {
          confetti({ count: 220 });
          notify('Parlay cashed! 🎉', `${v.legs.length} legs, all in${v.parlay.price !== null ? ` at ${formatAmerican(v.parlay.price)}` : ''}.`, v.parlay.id);
        } else if (overall === 'lost') {
          notify('Parlay busted', `${v.legs.find((l) => l.state === 'lost')?.leg.label ?? 'A leg'} missed.`, v.parlay.id);
        }
      }
    }
    seen.current = after;
    // `signature` captures every state these effects react to.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  const liveCount = board?.live.length ?? 0;
  return (
    <div className="space-y-10">
      <header className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-3xl animate-fade-up">
          <p className="eyebrow flex items-center gap-2">
            <span className="relative flex h-2 w-2" aria-hidden>
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-live opacity-70" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-live" />
            </span>
            Live mode
          </p>
          <h1 className="mt-2 font-display text-3xl font-bold tracking-tight text-ink sm:text-5xl">
            {liveCount ? (
              <>
                <span className="text-gradient">{liveCount}</span> {liveCount === 1 ? 'game' : 'games'} on right now
              </>
            ) : (
              'Everything happening right now'
            )}
          </h1>
          <p className="mt-3 text-base text-ink-2">
            Your tracked parlays sweat here in real time: every leg filling toward its line and the chance to cash on the ring. Scores and win
            chances refresh every 15 seconds.
            {board && <span className="text-ink-3"> Updated {updated.format(new Date(board.generatedAt))}.</span>}
          </p>
        </div>
        <div className="shrink-0">
          <AlertSettings />
        </div>
      </header>

      <section aria-labelledby="sweating" className="space-y-3">
        <h2 id="sweating" className="font-display text-lg font-semibold text-ink">
          Your parlays in play
        </h2>
        {views.length ? (
          <ul className="grid gap-4 lg:grid-cols-2">
            {views.map((v) => (
              <ParlayLive key={v.parlay.id} view={v} time={time} />
            ))}
          </ul>
        ) : (
          <div className="card flex flex-col items-start gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-ink-2">
              {now && log.length
                ? 'None of your tracked parlays has a game on right now. They show up here from the first game’s start until a few hours after the last.'
                : 'Track a parlay and sweat it here: every leg filling toward its line, the chance to cash moving with each play, confetti when it hits.'}
            </p>
            <div className="flex shrink-0 gap-2">
              <Link href="/props" className="rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-on-accent transition hover:brightness-110">
                Find props
              </Link>
              <Link href="/parlay" className="rounded-xl bg-raised px-4 py-2 text-sm font-semibold text-ink ring-1 ring-line transition hover:bg-line">
                Your parlay
              </Link>
            </div>
          </div>
        )}
      </section>

      <YourPlayers onlyLive title="Your players on now" />

      {!board ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-label="Loading games">
          {[0, 1, 2].map((i) => (
            <div key={i} className="skeleton h-44" />
          ))}
        </div>
      ) : (
        <>
          <Games title="On now" cards={board.live} time={time} now={now} />
          <Games title="Starting soon" cards={board.soon} time={time} now={now} />
          <Games title="Just finished" cards={board.final} time={time} now={now} />
          {!board.live.length && !board.soon.length && !board.final.length && (
            <div className="card flex items-center gap-3 p-5 text-sm text-ink-2">
              <Radio className="h-5 w-5 text-ink-3" aria-hidden />
              {board.next ? (
                <span>
                  Quiet right now. Next up: {board.next.away.abbr} @ {board.next.home.abbr} ({board.next.league.toUpperCase()}),{' '}
                  {new Intl.DateTimeFormat('en-US', { timeZone: zone, weekday: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(board.next.date))}.
                </span>
              ) : (
                <span>No games on the schedule right now.</span>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
