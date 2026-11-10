'use client';

import { Check, Plus } from 'lucide-react';
import { pct } from '../../lib/format';
import { formatAmerican } from '../../lib/model/market';
import { ParlayLeg, useParlay } from './parlay';

type Side = { teamId: string; abbr: string; name: string; prob: number; price: number };

/** "Add CIN to win" buttons for the parlay, priced at the posted moneyline. */
export function MoneylineLegs({ league, gameId, game, start, book, sides }: { league: string; gameId: string; game: string; start: string; book: string; sides: Side[] }) {
  const { legs, toggle } = useParlay();
  const chosen = new Set(legs.map((l) => l.key));
  const group = `${league}:${gameId}:moneyline`;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs text-ink-3">Add to your parlay:</span>
      {sides.map((s) => {
        const leg: ParlayLeg = {
          key: `${group}:${s.abbr}`,
          group,
          league,
          gameId,
          game,
          start,
          label: `${s.name} to win`,
          prob: s.prob,
          price: s.price,
          book,
          link: { kind: 'win', teamId: s.teamId }
        };
        const active = chosen.has(leg.key);
        return (
          <button
            key={s.abbr}
            type="button"
            onClick={() => toggle(leg)}
            aria-pressed={active}
            className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium tabular ring-1 transition ${
              active ? 'bg-accent/15 text-ink ring-accent/60' : 'text-ink-2 ring-line hover:text-ink hover:ring-line-strong'
            }`}
          >
            {active ? <Check className="h-3 w-3" aria-hidden /> : <Plus className="h-3 w-3" aria-hidden />}
            {s.abbr} {formatAmerican(s.price)} · {pct(s.prob)}
          </button>
        );
      })}
    </div>
  );
}
