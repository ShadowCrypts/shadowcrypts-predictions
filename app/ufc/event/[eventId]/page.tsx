import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { pct } from '../../../../lib/format';
import { formatShortDate, renderedAt } from '../../../../lib/time';
import { fightNight, getUfcModel, shownChance } from '../../../../lib/ufc/model';
import { AutoRefresh } from '../../../components/AutoRefresh';
import { JsonLd } from '../../../components/JsonLd';
import { LocalTime } from '../../../components/LocalTime';
import { PageHeader, Section } from '../../../components/Section';
import { BoutCard, cardRecord, mainEventName, mainFirst } from '../../../components/ufc/UfcBits';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ eventId: string }> };

async function load(eventId: string) {
  if (!/^\d{1,15}$/.test(eventId)) return null;
  const model = await getUfcModel();
  const event = model.eventsById.get(eventId);
  return event ? { model, event } : null;
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const data = await load((await params).eventId);
  if (!data) return { title: 'Event not found', robots: { index: false } };
  const { model, event } = data;
  const main = mainFirst(event)[0];
  const over = event.bouts.every((b) => b.state === 'post');
  const lead = main ? `${main.a.name} ${pct(shownChance(model, main.id).chanceA)}, ${main.b.name} ${pct(1 - shownChance(model, main.id).chanceA)}` : '';
  return {
    title: over ? `${event.name} results and how the picks did` : `${event.name} predictions: every fight's win chances`,
    description: `${event.name}, ${formatShortDate(event.date)}${event.city ? ` in ${event.city}` : ''}: ${mainEventName(event)}${lead ? ` (${lead})` : ''} and the whole card, with the betting market's chances.`,
    alternates: { canonical: `/ufc/event/${event.id}` }
  };
}

export default async function UfcEventPage({ params }: Params) {
  const data = await load((await params).eventId);
  if (!data) notFound();
  const { model, event } = data;
  const bouts = mainFirst(event);
  const { right, graded } = cardRecord(model, event);
  const live = fightNight([event], renderedAt().getTime()) && event.bouts.some((b) => b.state !== 'post');
  return (
    <div className="space-y-8">
      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@type': 'SportsEvent',
          name: event.name,
          startDate: event.date,
          sport: 'Mixed martial arts',
          ...(event.venue ? { location: { '@type': 'Place', name: event.venue, ...(event.city ? { address: event.city } : {}) } } : {}),
          competitor: bouts.slice(0, 1).flatMap((b) => [b.a, b.b].map((f) => ({ '@type': 'Person', name: f.name })))
        }}
      />
      <PageHeader
        eyebrow={
          <Link href="/ufc" className="hover:underline">
            UFC
          </Link>
        }
        title={event.name}
        aside={<AutoRefresh live={live} at={model.generatedAt} />}
      >
        <p>
          <LocalTime iso={event.date} show="long-day" /> · <LocalTime iso={event.date} show="time" />
          {event.venue ? ` · ${event.venue}` : ''}
          {event.city ? `, ${event.city}` : ''}
        </p>
        <p className="mt-1 text-sm text-ink-3">
          {graded > 0
            ? `The forecasts called ${right} of ${graded} fights with a winner right.`
            : `${event.bouts.length} fights. With a betting line, each chance is the market's with the bookmaker's cut removed.`}
        </p>
      </PageHeader>
      <Section title="The card" subtitle="Main event first." bare>
        <div className="grid gap-3 lg:grid-cols-2">
          {bouts.map((b) => (
            <BoutCard key={b.id} model={model} bout={b} event={event} />
          ))}
        </div>
      </Section>
    </div>
  );
}
