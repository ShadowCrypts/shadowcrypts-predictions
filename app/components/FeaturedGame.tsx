import { ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { pctCapped } from '../../lib/format';
import { leagueName } from '../../lib/leagueName';
import type { CardData, CardSide } from '../../lib/model/card';
import { LiveDot } from './Badges';
import { LocalTime } from './LocalTime';
import { ProbabilityMeter } from './ProbabilityMeter';
import { TeamLogo } from './TeamLogo';

function Side({ side, chance, picked, score, align }: { side: CardSide; chance: number | null; picked: boolean; score: number | null; align: 'left' | 'right' }) {
  return (
    <div className={`flex min-w-0 flex-1 flex-col gap-2 ${align === 'right' ? 'items-end text-right' : 'items-start text-left'}`}>
      <span
        className="inline-flex h-[72px] w-[72px] shrink-0 items-center justify-center rounded-full ring-1 ring-inset ring-white/10"
        style={{ background: `radial-gradient(circle at 50% 35%, ${side.color}55, ${side.color}18 70%)`, boxShadow: `0 0 36px -10px ${side.color}88` }}
      >
        <TeamLogo src={side.logo} abbr={side.abbr} size={50} />
      </span>
      <span className="max-w-full truncate font-display text-lg font-semibold text-ink">{side.shortName}</span>
      {score !== null ? (
        <span className="font-display text-4xl font-bold leading-none text-ink tabular">{score}</span>
      ) : chance !== null ? (
        <span className={`font-display font-bold leading-none tabular ${picked ? 'text-4xl text-ink' : 'text-3xl text-ink-3'}`}>{pctCapped(chance)}</span>
      ) : null}
    </div>
  );
}

/**
 * The home page's spotlight: one game, big, in its teams' colors. A game on
 * now when there is one, otherwise the day's game to watch.
 */
export function FeaturedGame({ card, reason }: { card: CardData; reason: string }) {
  const live = card.state === 'in';
  const homeProb = live && card.liveHomeProb !== null ? card.liveHomeProb : card.homeProb;
  const pick: 'home' | 'away' = homeProb >= 0.5 ? 'home' : 'away';
  const scored = card.state !== 'pre';
  return (
    <Link
      href={`/${card.league}/game/${card.id}`}
      className="group relative block overflow-hidden rounded-3xl border border-line bg-surface p-5 shadow-card transition duration-300 hover:-translate-y-0.5 hover:border-accent/50 hover:shadow-glow sm:p-6"
    >
      <span
        className="pointer-events-none absolute inset-0 opacity-[0.28]"
        style={{ background: `linear-gradient(115deg, ${card.away.color} 0%, transparent 46%, transparent 54%, ${card.home.color} 100%)` }}
        aria-hidden
      />
      <span
        className="pointer-events-none absolute inset-0 opacity-30 transition-opacity duration-300 group-hover:opacity-45"
        style={{ background: `radial-gradient(50% 80% at 12% 30%, ${card.away.color}, transparent 70%), radial-gradient(50% 80% at 88% 30%, ${card.home.color}, transparent 70%)` }}
        aria-hidden
      />
      <span className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/30 to-transparent" aria-hidden />
      <div className="relative">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs">
          <span className="inline-flex items-center gap-2 whitespace-nowrap font-semibold uppercase tracking-[0.14em] text-accent-strong">
            {live && <LiveDot />}
            {reason}
          </span>
          <span className="text-ink-3">
            {leagueName(card.league)} · {live ? card.statusDetail : card.state === 'post' ? card.statusDetail || 'Final' : <LocalTime iso={card.date} />}
          </span>
        </div>
        <div className="mt-5 flex items-start gap-3">
          <Side side={card.away} chance={1 - homeProb} picked={pick === 'away'} score={scored ? card.away.score : null} align="left" />
          <span className="mt-6 inline-flex h-7 shrink-0 items-center rounded-full bg-raised/80 px-2.5 text-[11px] font-semibold uppercase tracking-wider text-ink-3 ring-1 ring-line">
            {scored ? (live ? 'live' : 'final') : 'at'}
          </span>
          <Side side={card.home} chance={homeProb} picked={pick === 'home'} score={scored ? card.home.score : null} align="right" />
        </div>
        <div className="mt-5">
          <ProbabilityMeter awayAbbr={card.away.abbr} homeAbbr={card.home.abbr} homeProb={homeProb} pick={pick} size="lg" bare colors={{ away: card.away.color, home: card.home.color }} />
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-sm">
          <span className="text-ink-2">
            {live ? (
              <>
                Live: <span className="font-semibold text-ink">{(pick === 'home' ? card.home : card.away).abbr}</span> {pctCapped(Math.max(homeProb, 1 - homeProb))} to win
              </>
            ) : (
              <>
                {card.line ? `Line ${card.line}` : 'Pre-line forecast'}
                {card.projected && (
                  <span className="text-ink-3">
                    {' '}
                    · projected {Math.round(card.projected.away)}–{Math.round(card.projected.home)}
                  </span>
                )}
              </>
            )}
          </span>
          <span className="inline-flex items-center gap-1 font-medium text-accent-strong">
            Full breakdown <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
          </span>
        </div>
      </div>
    </Link>
  );
}
