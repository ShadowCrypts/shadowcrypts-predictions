import Link from 'next/link';
import { pctCapped } from '../../lib/format';
import type { GameStakes } from '../../lib/model/season';
import { TeamBadge } from './TeamColors';

type Side = { abbr: string; shortName: string; logo: string | null; color: string };

/** One team's playoff chance now, if it wins and if it loses, as a range bar with today's odds marked. */
function TeamStake({ side, now, stake }: { side: Side; now: number; stake: { ifWin: number; ifLoss: number } }) {
  const swing = Math.round((stake.ifWin - stake.ifLoss) * 100);
  const lo = Math.min(stake.ifLoss, stake.ifWin);
  const hi = Math.max(stake.ifLoss, stake.ifWin);
  return (
    <div className="rounded-xl bg-raised/60 p-4 ring-1 ring-line">
      <div className="flex items-center gap-2.5">
        <TeamBadge side={side} size={24} />
        <p className="font-semibold text-ink">{side.shortName}</p>
        <p className="ml-auto text-xs text-ink-3">
          Now <span className="font-semibold text-ink tabular">{pctCapped(now)}</span>
        </p>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3 text-center">
        <div>
          <p className="font-display text-2xl font-bold text-good tabular">{pctCapped(stake.ifWin)}</p>
          <p className="text-xs text-ink-3">with a win</p>
        </div>
        <div>
          <p className="font-display text-2xl font-bold text-ink-2 tabular">{pctCapped(stake.ifLoss)}</p>
          <p className="text-xs text-ink-3">with a loss</p>
        </div>
      </div>
      {/* The range this game decides, on a 0–100% track, with today's odds marked. */}
      <span className="relative mt-3 block h-2 rounded-full bg-track" aria-hidden>
        <span
          className="absolute inset-y-0 rounded-full"
          style={{ left: `${(lo * 100).toFixed(1)}%`, width: `${Math.max(1, (hi - lo) * 100).toFixed(1)}%`, background: side.color }}
        />
        <span className="absolute -inset-y-1 w-[3px] -translate-x-1/2 rounded-full bg-ink ring-2 ring-surface" style={{ left: `${(now * 100).toFixed(1)}%` }} />
      </span>
      <p className="mt-2 text-xs text-ink-2">
        {swing >= 1 ? (
          <>
            This game is worth{' '}
            <span className="font-semibold text-ink tabular">
              {swing} {swing === 1 ? 'point' : 'points'}
            </span>{' '}
            of playoff chance to them.
          </>
        ) : (
          'Their playoff odds barely move on this one.'
        )}
      </p>
    </div>
  );
}

/** A league's coming games with the most playoff chance riding on them, both teams' swings added up, biggest first. */
export function StakesList({ games }: { games: { href: string; away: Side; home: Side; date: string; awaySwing: number; homeSwing: number }[] }) {
  return (
    <ul className="-mx-2">
      {games.map((g) => (
        <li key={g.href}>
          <Link href={g.href} className="flex items-center gap-3 rounded-xl px-2 py-2.5 transition hover:bg-raised">
            <span className="flex shrink-0 -space-x-2">
              <TeamBadge side={g.away} size={20} />
              <TeamBadge side={g.home} size={20} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-ink">
                {g.away.abbr} @ {g.home.abbr}
              </span>
              <span className="block truncate text-xs text-ink-3 tabular">
                {g.home.abbr} {Math.round(g.homeSwing * 100)} pts · {g.away.abbr} {Math.round(g.awaySwing * 100)} pts of playoff chance
              </span>
            </span>
            <span className="shrink-0 rounded-md bg-warn/15 px-1.5 py-0.5 text-xs font-semibold text-warn tabular" title="Both teams' playoff chance swings, added up">
              {Math.round((g.homeSwing + g.awaySwing) * 100)}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** What a regular-season game means for both teams' playoff chances, from the season simulation. */
export function PlayoffStakes({ away, home, stakes, now, sims }: { away: Side; home: Side; stakes: GameStakes; now: { away: number; home: number }; sims: number }) {
  return (
    <section aria-labelledby="stakes-title" className="card p-4 sm:p-6">
      <h2 id="stakes-title" className="font-display text-lg font-semibold tracking-tight text-ink sm:text-xl">
        What&apos;s at stake
      </h2>
      <p className="mt-1 max-w-3xl text-sm text-ink-2">
        Each team&apos;s chance to make the playoffs if it wins this game and if it loses, from {sims.toLocaleString()} simulations of the rest of the
        season.
      </p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <TeamStake side={away} now={now.away} stake={stakes.away} />
        <TeamStake side={home} now={now.home} stake={stakes.home} />
      </div>
    </section>
  );
}
