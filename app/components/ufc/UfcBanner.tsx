import Link from 'next/link';
import { pct } from '../../../lib/format';
import type { UfcEvent } from '../../../lib/ufc/feed';
import { shownChance, type UfcModel } from '../../../lib/ufc/model';
import { LocalTime } from '../LocalTime';
import { mainFirst } from './UfcBits';

/** Fight week on the home page: the next UFC card, its main event's chances, and the way to the whole card. */
export function UfcBanner({ event, model }: { event: UfcEvent; model: UfcModel }) {
  const main = mainFirst(event)[0];
  const chanceA = main ? shownChance(model, main.id).chanceA : null;
  const live = event.bouts.some((b) => b.state === 'in');
  return (
    <Link
      href={`/ufc/event/${event.id}`}
      className="group flex flex-col gap-3 rounded-2xl border border-accent/30 bg-accent/10 px-5 py-4 transition hover:border-accent/60 hover:bg-accent/15 sm:flex-row sm:items-center sm:justify-between"
    >
      <span>
        <span className="block text-xs font-semibold uppercase tracking-wider text-accent-strong">{live ? 'UFC · live now' : 'UFC this week'}</span>
        <span className="mt-0.5 block font-display text-lg font-semibold text-ink">{event.name}</span>
        <span className="block text-sm text-ink-2">
          <LocalTime iso={event.date} show="day-time" />
          {main && chanceA !== null && (
            <>
              {' · '}
              {main.a.name} {pct(chanceA)}, {main.b.name} {pct(1 - chanceA)}
            </>
          )}
        </span>
      </span>
      <span className="shrink-0 self-start rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-on-accent transition group-hover:brightness-110 sm:self-auto">
        Every fight&apos;s chances →
      </span>
    </Link>
  );
}
