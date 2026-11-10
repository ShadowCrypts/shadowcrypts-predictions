import Link from 'next/link';
import { pct, signed } from '../../lib/format';
import { leagueName } from '../../lib/leagueName';
import type { CardData } from '../../lib/model/card';
import { formatDay } from '../../lib/time';
import { GainBar } from './Movers';
import { EmptyState } from './Section';
import { TeamBadge } from './TeamColors';

/** Upcoming games where the Elo ratings and the vig-free market number differ most. */
export function DisagreementList({ cards, limit = 5, showLeague = true }: { cards: CardData[]; limit?: number; showLeague?: boolean }) {
  const rows = cards
    .filter((c) => c.state === 'pre' && c.marketHomeProb !== null)
    .map((c) => ({ c, gap: c.modelHomeProb - c.marketHomeProb! }))
    .sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap))
    .slice(0, limit);

  if (!rows.length) return <EmptyState>No lines are posted for upcoming games yet.</EmptyState>;

  return (
    <ul className="-mx-2">
      {rows.map(({ c, gap }) => {
        // Name the team the ratings like more than the market does.
        const side = gap >= 0 ? c.home : c.away;
        const ratings = gap >= 0 ? c.modelHomeProb : 1 - c.modelHomeProb;
        const market = gap >= 0 ? c.marketHomeProb! : 1 - c.marketHomeProb!;
        return (
          <li key={c.id}>
            <Link href={`/${c.league}/game/${c.id}`} className="flex items-center gap-3 rounded-xl px-2 py-2 transition hover:bg-raised">
              <TeamBadge side={side} size={24} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-ink">
                  {c.away.abbr} @ {c.home.abbr}
                </p>
                {/* The market's number muted, and what the ratings add on top in the team's color. */}
                <GainBar from={market} to={ratings} color={side.color} />
                <p className="truncate text-xs text-ink-3">
                  {showLeague && `${leagueName(c.league)} · `}
                  {formatDay(c.date)} · {side.abbr}: ratings {pct(ratings)}, market {pct(market)}
                </p>
              </div>
              <span className="shrink-0 rounded-md bg-accent/15 px-1.5 py-0.5 text-xs font-semibold text-accent-strong tabular" title="Percentage points the ratings add over the market">
                {signed(Math.abs(gap) * 100)}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
