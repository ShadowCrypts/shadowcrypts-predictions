import Link from 'next/link';
import { leagueName } from '../../lib/leagueName';
import type { Standout } from '../../lib/model/standouts';
import { PlayerPhoto } from './PlayerPhoto';

/** The day's best lines as player cards: photo, the number, and links to his page and the game. */
export function Standouts({ items, compact = false }: { items: Standout[]; compact?: boolean }) {
  return (
    <ul className={compact ? 'grid gap-2' : 'grid gap-3 sm:grid-cols-2 lg:grid-cols-3'}>
      {items.map((s) => (
        <li key={`${s.league}-${s.market}`} className={`relative flex min-w-0 items-center gap-3 overflow-hidden ${compact ? 'rounded-xl px-1 py-1' : 'card p-3'}`}>
          {/* His team's color glowing in from the corner behind the photo. */}
          {!compact && (
            <span
              className="pointer-events-none absolute inset-0"
              style={{ background: `radial-gradient(90% 120% at 0% 50%, ${s.color}2e, transparent 60%)` }}
              aria-hidden
            />
          )}
          <PlayerPhoto league={s.league} id={s.playerId} name={s.name} size={compact ? 36 : 48} ring={s.color} />
          <span className="relative min-w-0 flex-1">
            <Link href={`/${s.league}/player/${s.playerId}`} className="block truncate text-sm font-semibold text-ink hover:underline">
              {s.name}
            </Link>
            <span className="block text-sm text-ink-2">
              <span className={`font-display font-bold text-ink tabular ${compact ? 'text-base' : 'text-xl'}`}>{s.value}</span> {s.label}
            </span>
            <Link href={`/${s.league}/game/${s.gameId}`} className="block truncate text-xs text-ink-3 hover:text-ink hover:underline">
              {leagueName(s.league)} · {s.team} · {s.game}
            </Link>
          </span>
        </li>
      ))}
    </ul>
  );
}
