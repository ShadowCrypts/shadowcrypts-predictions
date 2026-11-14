import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { pct } from '../../../../lib/format';
import { fairAmerican, formatAmerican } from '../../../../lib/model/market';
import { formatShortDate, renderedAt } from '../../../../lib/time';
import { boutEnding, type UfcBout, type UfcFighter } from '../../../../lib/ufc/feed';
import { calledIt, cardSpot, favoriteBand, fightNight, getUfcModel, shownChance, weightName, type UfcModel } from '../../../../lib/ufc/model';
import { AutoRefresh } from '../../../components/AutoRefresh';
import { ResultBadge } from '../../../components/Badges';
import { ChanceBar } from '../../../components/ChanceBar';
import { JsonLd } from '../../../components/JsonLd';
import { LocalTime } from '../../../components/LocalTime';
import { PlayerPhoto } from '../../../components/PlayerPhoto';
import { PageHeader, Section } from '../../../components/Section';
import { fightDate, Flag, rating } from '../../../components/ufc/UfcBits';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ fightId: string }> };

async function load(fightId: string) {
  if (!/^\d{1,15}$/.test(fightId)) return null;
  const model = await getUfcModel();
  const bout = model.boutsById.get(fightId);
  const event = bout && model.eventsById.get(bout.eventId);
  return bout && event ? { model, bout, event } : null;
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const data = await load((await params).fightId);
  if (!data) return { title: 'Fight not found', robots: { index: false } };
  const { model, bout, event } = data;
  const { chanceA } = shownChance(model, bout.id);
  const fav = chanceA >= 0.5 ? bout.a : bout.b;
  const winner = bout.a.winner ? bout.a : bout.b.winner ? bout.b : null;
  const forecastLine = `${fav.name} ${pct(Math.max(chanceA, 1 - chanceA))} to win`;
  return {
    title: bout.completed ? `${bout.a.name} vs ${bout.b.name}: result and forecast, ${event.shortName}` : `${bout.a.name} vs ${bout.b.name} prediction and odds, ${event.shortName}`,
    description: `${event.name}, ${formatShortDate(bout.date || event.date)}. ${
      winner ? `${winner.name} won (${boutEnding(bout)}); the forecast had ${forecastLine}.` : `${forecastLine}, with the tale of the tape, recent fights and how favorites like this have done.`
    }`,
    alternates: { canonical: `/ufc/fight/${bout.id}` }
  };
}

/** A fighter's last few UFC fights before this one, newest first. */
function formBefore(model: UfcModel, fighterId: string, bout: UfcBout, count = 5) {
  return (model.boutsByFighter.get(fighterId) ?? []).filter((b) => b.completed && b.id !== bout.id && b.date < bout.date).slice(0, count);
}

function resultFor(b: UfcBout, fighterId: string) {
  const me = b.a.id === fighterId ? b.a : b.b;
  const them = b.a.id === fighterId ? b.b : b.a;
  const outcome = me.winner === true ? 'W' : them.winner === true ? 'L' : b.round === b.rounds && b.clock === '5:00' ? 'D' : 'NC';
  return { outcome, opponent: them };
}

const tone = (outcome: string) => (outcome === 'W' ? 'bg-good/15 text-good' : outcome === 'L' ? 'bg-bad/15 text-bad' : 'bg-raised text-ink-2');

function Form({ model, fighter, bout }: { model: UfcModel; fighter: UfcFighter; bout: UfcBout }) {
  const fights = formBefore(model, fighter.id, bout);
  if (!fights.length) return <p className="text-sm text-ink-3">No earlier UFC fights: this is {fighter.name}&apos;s UFC debut.</p>;
  return (
    <ul className="space-y-1.5 text-sm">
      {fights.map((b) => {
        const { outcome, opponent } = resultFor(b, fighter.id);
        return (
          <li key={b.id} className="flex items-center gap-2">
            <span className={`inline-flex w-7 justify-center rounded-md text-xs font-bold ${tone(outcome)}`}>{outcome}</span>
            <Link href={`/ufc/fight/${b.id}`} className="min-w-0 flex-1 truncate text-ink-2 hover:text-ink">
              {opponent.name}
            </Link>
            <span className="shrink-0 text-xs text-ink-3">{boutEnding(b)?.replace('Stoppage, round', 'R').replace(/\s\(.*\)/, '') ?? ''}</span>
          </li>
        );
      })}
    </ul>
  );
}

export default async function UfcFightPage({ params }: Params) {
  const data = await load((await params).fightId);
  if (!data) notFound();
  const { model, bout, event } = data;
  const { chanceA, fromMarket, locked } = shownChance(model, bout.id);
  const forecast = model.forecasts.get(bout.id)!;
  const fa = model.fighters.get(bout.a.id);
  const fb = model.fighters.get(bout.b.id);
  const band = fromMarket ? favoriteBand(model.favorites, chanceA) : null;
  const favorite = chanceA >= 0.5 ? bout.a : bout.b;
  const ending = boutEnding(bout);
  const correct = calledIt(bout, chanceA);
  const spot = cardSpot(bout, event);
  const meetings = (model.boutsByFighter.get(bout.a.id) ?? []).filter((b) => b.id !== bout.id && (b.a.id === bout.b.id || b.b.id === bout.b.id));
  const live = fightNight([event], renderedAt().getTime()) && bout.state !== 'post';

  const tape: [string, string, string][] = [
    ['Country', bout.a.country ?? '—', bout.b.country ?? '—'],
    ['Pro record (all promotions, today)', bout.a.listedRecord ?? '—', bout.b.listedRecord ?? '—'],
    ['UFC record', fa?.fights ? `${fa.wins}-${fa.losses}${fa.draws ? `-${fa.draws}` : ''}` : 'Debut', fb?.fights ? `${fb.wins}-${fb.losses}${fb.draws ? `-${fb.draws}` : ''}` : 'Debut'],
    ['UFC wins by stoppage / decision', fa ? `${fa.endings.stoppageWins} / ${fa.endings.decisionWins}` : '—', fb ? `${fb.endings.stoppageWins} / ${fb.endings.decisionWins}` : '—'],
    ['UFC losses by stoppage / decision', fa ? `${fa.endings.stoppageLosses} / ${fa.endings.decisionLosses}` : '—', fb ? `${fb.endings.stoppageLosses} / ${fb.endings.decisionLosses}` : '—'],
    ['Rating (rank in division)', fa?.fights ? `${rating(fa.rating)}${fa.rank ? ` (#${fa.rank})` : ''}` : '—', fb?.fights ? `${rating(fb.rating)}${fb.rank ? ` (#${fb.rank})` : ''}` : '—']
  ];

  return (
    <div className="space-y-8">
      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@type': 'SportsEvent',
          name: `${bout.a.name} vs. ${bout.b.name}`,
          startDate: bout.date || event.date,
          sport: 'Mixed martial arts',
          superEvent: { '@type': 'SportsEvent', name: event.name },
          competitor: [bout.a, bout.b].map((f) => ({ '@type': 'Person', name: f.name }))
        }}
      />
      <PageHeader
        eyebrow={
          <Link href={`/ufc/event/${event.id}`} className="hover:underline">
            {event.name}
          </Link>
        }
        title={`${bout.a.name} vs. ${bout.b.name}`}
        aside={<AutoRefresh live={live} at={model.generatedAt} />}
      >
        <p>
          {[spot, weightName(bout.weightClass), `${bout.rounds} rounds`].filter(Boolean).join(' · ')} · <LocalTime iso={event.date} show="day" />
        </p>
      </PageHeader>

      <section className="card p-4 sm:p-6" aria-label="Forecast">
        <div className="grid grid-cols-2 gap-4">
          {[
            { f: bout.a, chance: chanceA, odds: forecast.odds?.aMoneyline ?? null },
            { f: bout.b, chance: 1 - chanceA, odds: forecast.odds?.bMoneyline ?? null }
          ].map(({ f, chance, odds }) => (
            <div key={f.id} className="flex flex-col items-center text-center">
              <PlayerPhoto league="mma" id={f.id} name={f.name} size={88} eager />
              <Link href={`/ufc/fighter/${f.id}`} className="mt-2 flex items-center gap-1.5 font-display text-lg font-semibold text-ink hover:text-accent-strong">
                {f.name} <Flag fighter={f} />
              </Link>
              <p className={`mt-1 font-display text-3xl font-bold tabular ${chance >= 0.5 ? 'text-ink' : 'text-ink-2'}`}>{pct(chance)}</p>
              <ChanceBar chance={chance} width="w-24" />
              <p className="mt-1 text-xs text-ink-3 tabular">
                {odds !== null ? `Line ${formatAmerican(odds)} · fair ${formatAmerican(fairAmerican(chance))}` : `Fair odds ${formatAmerican(fairAmerican(chance))}`}
              </p>
              {f.winner === true && <p className="mt-1 text-sm font-semibold text-good">Won{ending ? ` · ${ending}` : ''}</p>}
            </div>
          ))}
        </div>
        <div className="mt-4 space-y-1.5 border-t border-line pt-4 text-sm text-ink-2">
          <p className="flex flex-wrap items-center gap-2">
            {fromMarket
              ? `The chance is the betting market's${forecast.odds ? ` (${forecast.odds.provider})` : ''}, with the bookmaker's cut removed${locked && bout.state !== 'pre' ? ', locked before the fight' : ''}.`
              : `No betting line yet, so this is our ratings alone: in UFC they have picked only ${pct(model.record.ratings.accuracy)} of winners since 2019, so treat it as a rough guide.`}
            <ResultBadge correct={correct} />
          </p>
          {band && (
            <p>
              Since 2019, UFC favorites priced between {Math.round(band.lo * 100)}% and {Math.round(band.hi * 100)}% have won {pct(band.won)} of {band.fights.toLocaleString('en-US')} fights.
              {bout.state === 'pre' ? ` ${favorite.name} is the favorite here.` : ''}
            </p>
          )}
          {fromMarket && (
            <p className="text-ink-3">
              Our ratings alone: {bout.a.name} {pct(forecast.ratingsA)}, {bout.b.name} {pct(1 - forecast.ratingsA)}. They&apos;re a weaker guide than the market, so they don&apos;t move the number.
            </p>
          )}
          {!bout.completed && bout.state === 'in' && <p className="font-semibold text-bad">Live now{bout.round ? `: round ${bout.round}` : ''}.</p>}
          {bout.completed && !bout.a.winner && !bout.b.winner && <p>{ending ?? 'No winner'}.</p>}
        </div>
      </section>

      <Section title="Tale of the tape" subtitle="UFC numbers count fights in the UFC only (from 2001); the pro record is everything, as ESPN lists it today.">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[24rem] text-sm">
            <thead>
              <tr className="text-xs text-ink-3">
                <th className="pb-2 text-left font-medium">{bout.a.name}</th>
                <th className="pb-2 text-center font-medium" />
                <th className="pb-2 text-right font-medium">{bout.b.name}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {tape.map(([label, a, b]) => (
                <tr key={label}>
                  <td className="py-2 font-semibold tabular text-ink">{a}</td>
                  <td className="px-2 py-2 text-center text-xs text-ink-3">{label}</td>
                  <td className="py-2 text-right font-semibold tabular text-ink">{b}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <div className="grid gap-6 md:grid-cols-2">
        <Section title={`${bout.a.name}: last UFC fights`}>
          <Form model={model} fighter={bout.a} bout={bout} />
        </Section>
        <Section title={`${bout.b.name}: last UFC fights`}>
          <Form model={model} fighter={bout.b} bout={bout} />
        </Section>
      </div>

      {meetings.length > 0 && (
        <Section title="When they met before">
          <ul className="space-y-1.5 text-sm">
            {meetings.map((m) => {
              const { outcome } = resultFor(m, bout.a.id);
              return (
                <li key={m.id}>
                  <Link href={`/ufc/fight/${m.id}`} className="text-ink-2 hover:text-ink">
                    {fightDate(m.date)}: {outcome === 'W' ? `${bout.a.name} won` : outcome === 'L' ? `${bout.b.name} won` : outcome === 'D' ? 'Draw' : 'No contest'}
                    {boutEnding(m) ? ` (${boutEnding(m)})` : ''}
                  </Link>
                </li>
              );
            })}
          </ul>
        </Section>
      )}
    </div>
  );
}
