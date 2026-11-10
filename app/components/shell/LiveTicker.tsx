'use client';

import { Radio } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { shortStatus } from '../../../lib/format';
import type { CardData } from '../../../lib/model/card';
import type { LiveBoard } from '../../../lib/model/liveBoard';
import { useViewerZone } from '../LocalTime';
import { TeamLogo } from '../TeamLogo';
import { useLiveBoard } from '../useLiveBoard';

/** Pixels a second the ticker drifts. */
const SPEED = 40;

function Item({ card, time, copy }: { card: CardData; time: Intl.DateTimeFormat; copy?: boolean }) {
  const live = card.state === 'in';
  const final = card.completed;
  const homeUp = (card.home.score ?? 0) > (card.away.score ?? 0);
  const awayUp = (card.away.score ?? 0) > (card.home.score ?? 0);
  const p = card.liveHomeProb ?? card.homeProb;
  return (
    <li className="flex shrink-0 items-center">
      <Link
        href={`/${card.league}/game/${card.id}`}
        tabIndex={copy ? -1 : undefined}
        className="group flex items-center gap-2 rounded-md px-2.5 py-1 text-xs transition hover:bg-raised"
      >
        <span className="rounded bg-raised px-1 py-px text-[9px] font-bold uppercase tracking-wider text-ink-3 ring-1 ring-line">{card.league}</span>
        <span className="flex items-center gap-1">
          <TeamLogo src={card.away.logo} abbr={card.away.abbr} size={14} />
          <span className={final && awayUp ? 'font-bold text-ink' : 'font-medium text-ink-2'}>{card.away.abbr}</span>
          {card.away.score !== null && <span className={`tabular ${awayUp ? 'font-bold text-ink' : 'text-ink-2'}`}>{card.away.score}</span>}
        </span>
        <span className="flex items-center gap-1">
          <TeamLogo src={card.home.logo} abbr={card.home.abbr} size={14} />
          <span className={final && homeUp ? 'font-bold text-ink' : 'font-medium text-ink-2'}>{card.home.abbr}</span>
          {card.home.score !== null && <span className={`tabular ${homeUp ? 'font-bold text-ink' : 'text-ink-2'}`}>{card.home.score}</span>}
        </span>
        {live ? (
          <>
            <span className="flex items-center gap-1 font-semibold text-live">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-live" aria-hidden />
              {shortStatus(card.statusDetail)}
            </span>
            {/* Live win chance: away share on the left, home on the right. */}
            <span className="relative hidden h-1.5 w-10 overflow-hidden rounded-full bg-accent-2/40 sm:block" title={`${card.home.abbr} ${Math.round(p * 100)}% to win`} aria-hidden>
              <span className="absolute inset-y-0 right-0 rounded-full bg-accent transition-[width] duration-700" style={{ width: `${(p * 100).toFixed(1)}%` }} />
            </span>
          </>
        ) : final ? (
          <span className="text-ink-3">{shortStatus(card.statusDetail)}</span>
        ) : (
          <span className="text-ink-3">
            {time.format(new Date(card.date))} · {card.pick === 'home' ? card.home.abbr : card.away.abbr} {Math.round(card.pickProb * 100)}%
          </span>
        )}
      </Link>
    </li>
  );
}

function items(board: LiveBoard) {
  return [...board.live, ...board.soon, ...board.final.slice(0, 12), ...(board.next ? [board.next] : [])];
}

/**
 * Scores across every league under the header: games on now (with their live
 * win chance), then starting soon and just finished. Drifts sideways like a
 * broadcast ticker when it's wider than the screen, pauses on hover or focus,
 * and holds still for anyone who prefers less motion.
 */
export function LiveTicker() {
  const board = useLiveBoard();
  const zone = useViewerZone();
  const time = useMemo(() => new Intl.DateTimeFormat('en-US', { timeZone: zone, hour: 'numeric', minute: '2-digit' }), [zone]);
  const frame = useRef<HTMLDivElement>(null);
  const first = useRef<HTMLUListElement>(null);
  const [drift, setDrift] = useState<number | null>(null);
  const cards = board ? items(board) : [];
  const key = cards.map((c) => `${c.id}:${c.away.score}:${c.home.score}:${c.statusDetail}`).join('|');

  useEffect(() => {
    const measure = () => {
      const f = frame.current;
      const t = first.current;
      if (!f || !t) return;
      // Too wide to fit: a second copy follows the first and the pair drifts one copy's width, then loops.
      // With less motion asked for, it stays put and scrolls by hand instead.
      const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      setDrift(!still && t.scrollWidth > f.clientWidth ? t.scrollWidth : null);
    };
    measure();
    const observer = new ResizeObserver(measure);
    if (frame.current) observer.observe(frame.current);
    return () => observer.disconnect();
  }, [key]);

  const live = board?.live.length ?? 0;
  return (
    <div className="border-b border-line bg-surface/60" aria-label="Scores">
      <div className="mx-auto flex h-9 max-w-7xl items-center gap-2 px-4 sm:px-6">
        <Link
          href="/live"
          className="flex shrink-0 items-center gap-1.5 rounded-full bg-live/15 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-live ring-1 ring-live/30 transition hover:bg-live/25"
        >
          {live ? <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-live" aria-hidden /> : <Radio className="h-3 w-3" aria-hidden />}
          Live{live ? ` · ${live}` : ''}
        </Link>
        <div ref={frame} className="ticker-mask scrollbar-none relative min-w-0 flex-1 overflow-hidden">
          {!board ? (
            <div className="h-5 w-2/3 animate-pulse rounded bg-raised" aria-hidden />
          ) : cards.length ? (
            <div
              className={`flex w-max ${drift ? 'ticker-drift' : ''}`}
              style={drift ? ({ '--ticker-distance': `-${drift}px`, '--ticker-duration': `${Math.round(drift / SPEED)}s` } as React.CSSProperties) : undefined}
            >
              <ul ref={first} className="flex items-center">
                {cards.map((c) => (
                  <Item key={`${c.league}-${c.id}`} card={c} time={time} />
                ))}
              </ul>
              {/* The copy that makes the loop seamless, hidden from assistive tech and the tab order. */}
              {drift && (
                <ul className="flex items-center" aria-hidden>
                  {cards.map((c) => (
                    <Item key={`${c.league}-${c.id}`} card={c} time={time} copy />
                  ))}
                </ul>
              )}
            </div>
          ) : (
            <p className="text-xs text-ink-3">No games on the schedule right now.</p>
          )}
        </div>
      </div>
    </div>
  );
}
