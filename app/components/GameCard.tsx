import Link from 'next/link';
import { pct, pctCapped } from '../../lib/format';
import { leagueName } from '../../lib/leagueName';
import type { CardData, CardSide } from '../../lib/model/card';
import { BandChip, LeagueTag, LiveDot, ResultBadge } from './Badges';
import { FollowedStar } from './FollowedStar';
import { LocalTime } from './LocalTime';
import { ProbabilityMeter } from './ProbabilityMeter';
import { TeamBadge, TeamGlow } from './TeamColors';
import { TeamLogo } from './TeamLogo';

function TeamRow({ card, side, which }: { card: CardData; side: CardSide; which: 'home' | 'away' }) {
  const pre = card.state === 'pre';
  const other = which === 'home' ? card.away : card.home;
  const won = !pre && (side.score ?? 0) > (other.score ?? 0);
  const prob = which === 'home' ? card.homeProb : 1 - card.homeProb;
  const picked = card.pick === which;
  return (
    <div className="flex items-center gap-3">
      <TeamBadge side={side} size={34} />
      <div className="min-w-0 flex-1">
        <p className={`flex items-center gap-1.5 truncate font-semibold ${!pre && !won && card.completed ? 'text-ink-3' : 'text-ink'}`}>
          <span className="truncate">{side.shortName}</span>
          <FollowedStar league={card.league} teamId={side.teamId} />
        </p>
        {side.record && <p className="text-xs text-ink-3 tabular">{side.record}</p>}
      </div>
      {pre ? (
        <span className={`font-display tabular ${picked ? 'text-xl font-semibold text-ink' : 'text-lg text-ink-3'}`}>{pct(prob)}</span>
      ) : (
        <span className={`font-display text-2xl font-semibold tabular ${won || card.state === 'in' ? 'text-ink' : 'text-ink-3'}`}>{side.score ?? '–'}</span>
      )}
    </div>
  );
}

/** The home team's win probability through the game so far: up is home, the dashed line is even. */
function WinSparkline({ values, homeAbbr }: { values: number[]; homeAbbr: string }) {
  if (values.length < 2) return null;
  const w = 56;
  const h = 18;
  const x = (i: number) => (i / (values.length - 1)) * (w - 2) + 1;
  const y = (v: number) => (1 - v) * (h - 2) + 1;
  const d = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="shrink-0" role="img" aria-label={`${homeAbbr} win chance through the game, now ${pct(values[values.length - 1])}`}>
      <line x1={1} x2={w - 1} y1={h / 2} y2={h / 2} stroke="var(--axis)" strokeDasharray="2 2" />
      <path d={d} fill="none" stroke="var(--series-1)" strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(values.length - 1)} cy={y(values[values.length - 1])} r={2.25} fill="var(--series-1)" />
    </svg>
  );
}

export function StatusLine({ card, showLeague }: { card: CardData; showLeague?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 text-xs text-ink-3">
      <span className="flex shrink-0 items-center gap-2 whitespace-nowrap">
        {showLeague && <LeagueTag league={leagueName(card.league)} />}
        {card.state === 'in' ? (
          <>
            <LiveDot />
            <span className="truncate font-medium text-ink-2">{card.statusDetail}</span>
          </>
        ) : card.state === 'post' ? (
          <span className="font-medium">{card.statusDetail || 'Final'}</span>
        ) : (
          <LocalTime iso={card.date} className="tabular" />
        )}
      </span>
      {(card.note || card.broadcast) && <span className="min-w-0 truncate text-right">{card.note || card.broadcast}</span>}
    </div>
  );
}

export function GameCard({ card, showLeague = false }: { card: CardData; showLeague?: boolean }) {
  const pickSide = card.pick === 'home' ? card.home : card.away;
  const live = card.state === 'in';
  // While a game is on, the bar shows the live estimate; the pregame pick stays in the footer.
  const liveProb = live ? card.liveHomeProb : null;
  const meterProb = liveProb ?? card.homeProb;
  const meterPick = liveProb === null ? card.pick : liveProb >= 0.5 ? 'home' : 'away';
  const liveLeader = meterPick === 'home' ? card.home : card.away;
  return (
    <Link
      href={`/${card.league}/game/${card.id}`}
      className={`group relative block overflow-hidden rounded-2xl border bg-surface p-4 shadow-card transition duration-200 hover:-translate-y-0.5 hover:border-accent/50 hover:shadow-glow ${
        live ? 'border-bad/40' : 'border-line'
      }`}
    >
      <TeamGlow away={card.away.color} home={card.home.color} />
      {live && <span className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-transparent via-bad to-transparent" aria-hidden />}
      <div className="relative">
        <StatusLine card={card} showLeague={showLeague} />
        <div className="mt-3 space-y-2">
          <TeamRow card={card} side={card.away} which="away" />
          <TeamRow card={card} side={card.home} which="home" />
        </div>
        <div className="mt-4">
          <ProbabilityMeter
            awayAbbr={card.away.abbr}
            homeAbbr={card.home.abbr}
            homeProb={meterProb}
            pick={meterPick}
            bare
            colors={{ away: card.away.color, home: card.home.color }}
          />
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm">
          {liveProb !== null ? (
            <span className="flex items-center gap-1.5 text-ink-2">
              Live <span className="font-semibold text-ink">{liveLeader.abbr}</span>
              <span className="font-semibold text-accent-strong tabular">{pctCapped(Math.max(liveProb, 1 - liveProb))}</span>
              {card.liveFlow && <WinSparkline values={card.liveFlow} homeAbbr={card.home.abbr} />}
            </span>
          ) : (
            <span className="flex items-center gap-2">
              <span className="text-ink-2">
                Pick <span className="font-semibold text-ink">{pickSide.abbr}</span>
                {card.state !== 'pre' && <span className="ml-1 text-ink-3 tabular">{pct(card.pickProb)}</span>}
              </span>
              <BandChip band={card.band} />
            </span>
          )}
          {liveProb !== null ? (
            <span className="text-xs text-ink-3 tabular">
              Pregame {pickSide.abbr} {pct(card.pickProb)}
            </span>
          ) : card.completed ? (
            <ResultBadge correct={card.correct} />
          ) : card.line ? (
            <span className="text-xs text-ink-3">Line {card.line}</span>
          ) : (
            <span className="text-xs text-ink-3" title="No line is posted yet, so this is the pre-line forecast">
              Pre-line forecast
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}

/** One-line version for dense lists. */
export function GameRow({ card, showLeague = false }: { card: CardData; showLeague?: boolean }) {
  const pickSide = card.pick === 'home' ? card.home : card.away;
  const pre = card.state === 'pre';
  return (
    <Link href={`/${card.league}/game/${card.id}`} className="flex items-center gap-3 rounded-xl px-2 py-2 transition hover:bg-raised">
      <div className="flex w-[4.5rem] shrink-0 items-center -space-x-1.5">
        <TeamLogo src={card.away.logo} abbr={card.away.abbr} size={26} />
        <TeamLogo src={card.home.logo} abbr={card.home.abbr} size={26} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-ink">
          {card.away.abbr} {!pre && <span className="tabular text-ink-2">{card.away.score}</span>} <span className="text-ink-3">@</span> {card.home.abbr}{' '}
          {!pre && <span className="tabular text-ink-2">{card.home.score}</span>}
        </p>
        <p className="flex items-center gap-1.5 truncate text-xs text-ink-3">
          {showLeague && <span className="font-semibold text-ink-2">{leagueName(card.league)}</span>}
          {card.state === 'in' ? <LiveDot /> : pre ? <LocalTime iso={card.date} className="truncate" /> : card.statusDetail}
        </p>
      </div>
      <div className="w-[4.75rem] shrink-0 text-right">
        <p className="text-sm text-ink-2">
          {pickSide.abbr} <span className="font-semibold tabular text-ink">{pct(card.pickProb)}</span>
        </p>
        {/* The pick's chance as a short bar in its team's color. */}
        <span className="my-1 block h-1 overflow-hidden rounded-full bg-track" aria-hidden>
          <span className="block h-full rounded-full" style={{ width: `${(card.pickProb * 100).toFixed(1)}%`, background: pickSide.color }} />
        </span>
        {card.completed ? <ResultBadge correct={card.correct} /> : <p className="text-xs text-ink-3">{card.band}</p>}
      </div>
    </Link>
  );
}
