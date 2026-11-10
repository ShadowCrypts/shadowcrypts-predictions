import { TrendingUp } from 'lucide-react';
import Link from 'next/link';
import { pct } from '../../lib/format';
import { leagueName } from '../../lib/leagueName';
import type { CardData } from '../../lib/model/card';
import { newsText } from '../../lib/model/injuryNews';
import type { Mover } from '../../lib/model/movement';
import { LocalTime } from './LocalTime';
import { EmptyState } from './Section';
import { TeamBadge } from './TeamColors';

/** A chance going from one number to a higher one: the old share muted, the gain in the team's color. Decorative; the numbers say it. */
export function GainBar({ from, to, color }: { from: number; to: number; color: string }) {
  const [low, high] = [Math.min(from, to), Math.max(from, to)].map((p) => Math.max(0, Math.min(1, p)) * 100);
  return (
    <span className="relative my-1 block h-1 overflow-hidden rounded-full bg-track" aria-hidden>
      <span className="absolute inset-y-0 left-0 rounded-l-full bg-ink-3/40" style={{ width: `${low.toFixed(1)}%` }} />
      <span className="absolute inset-y-0 rounded-r-full" style={{ left: `${low.toFixed(1)}%`, width: `${(high - low).toFixed(1)}%`, background: color }} />
    </span>
  );
}

const REASONS: Record<Mover['reason'], string> = {
  'line posted': 'Betting line posted',
  'line moved': 'Betting line moved',
  'line pulled': 'Line taken down',
  'model update': 'Pre-line model update'
};

/** Forecasts that moved most recently, told from the side of the team that gained. `cards` is keyed `league:gameId`. */
export function Movers({ movers, cards }: { movers: Mover[]; cards: Map<string, CardData> }) {
  if (!movers.length) return <EmptyState>No forecast has moved 3 points or more in the last day.</EmptyState>;
  return (
    <ul className="-mx-2">
      {movers.map((m) => {
        const card = cards.get(`${m.league}:${m.gameId}`);
        if (!card) return null;
        const homeGained = m.to.p > m.from.p;
        const team = homeGained ? card.home : card.away;
        const before = homeGained ? m.from.p : 1 - m.from.p;
        const after = homeGained ? m.to.p : 1 - m.to.p;
        // Name the injury news when key players went out or came back in that time.
        const news = m.news ? newsText(m.news) : null;
        const why = news ? (m.reason === 'model update' ? `Injury news: ${news}` : `${REASONS[m.reason]}, ${news}`) : REASONS[m.reason];
        return (
          <li key={`${m.league}:${m.gameId}`}>
            <Link href={`/${card.league}/game/${card.id}`} className="flex items-center gap-3 rounded-xl px-2 py-2.5 transition hover:bg-raised">
              <TeamBadge side={team} size={24} />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5 text-sm font-medium text-ink">
                  {team.abbr} <span className="tabular text-ink-3">{pct(before)}</span>
                  <TrendingUp className="h-3.5 w-3.5 text-good" aria-label="up to" />
                  <span className="font-semibold tabular text-ink">{pct(after)}</span>
                </span>
                <GainBar from={before} to={after} color={team.color} />
                <span className={`block truncate text-xs ${news ? 'text-ink-2' : 'text-ink-3'}`}>{why}</span>
                <span className="block truncate text-xs text-ink-3">
                  {leagueName(card.league)} {card.away.abbr} @ {card.home.abbr} · <LocalTime iso={card.date} />
                </span>
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
