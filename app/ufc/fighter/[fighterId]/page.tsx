import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { pct } from '../../../../lib/format';
import { renderedAt } from '../../../../lib/time';
import { boutEnding, type UfcBout } from '../../../../lib/ufc/feed';
import { getUfcModel, shownChance } from '../../../../lib/ufc/model';
import { JsonLd } from '../../../components/JsonLd';
import { LocalTime } from '../../../components/LocalTime';
import { PlayerPhoto } from '../../../components/PlayerPhoto';
import { PageHeader, Section, StatTile } from '../../../components/Section';
import { BoutCard, fightDate, Flag, rating } from '../../../components/ufc/UfcBits';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ fighterId: string }> };

async function load(fighterId: string) {
  if (!/^\d{1,15}$/.test(fighterId)) return null;
  const model = await getUfcModel();
  const fighter = model.fighters.get(fighterId);
  return fighter ? { model, fighter, bouts: model.boutsByFighter.get(fighterId) ?? [] } : null;
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const data = await load((await params).fighterId);
  if (!data) return { title: 'Fighter not found', robots: { index: false } };
  const { fighter } = data;
  const name = fighter.profile.name;
  const record = fighter.fights ? `${fighter.wins}-${fighter.losses}${fighter.draws ? `-${fighter.draws}` : ''} in the UFC` : 'UFC debut coming up';
  return {
    title: `${name}: UFC record, rating and fight history`,
    description: `${name}${fighter.profile.country ? ` (${fighter.profile.country})` : ''}: ${record}${fighter.division ? `, ${fighter.division}` : ''}. Every UFC fight with how it ended and the chance the forecast gave beforehand.`,
    alternates: { canonical: `/ufc/fighter/${fighter.profile.id}` },
    // Someone with no finished fight and nothing coming up has nothing to show.
    ...(fighter.fights === 0 && !data.bouts.some((b) => b.state !== 'post') ? { robots: { index: false } } : {})
  };
}

function outcomeFor(b: UfcBout, id: string) {
  const me = b.a.id === id ? b.a : b.b;
  const them = b.a.id === id ? b.b : b.a;
  if (!b.completed) return { label: b.state === 'in' ? 'Live' : 'Next', tone: 'bg-accent/15 text-accent-strong', opponent: them };
  if (me.winner === true) return { label: 'W', tone: 'bg-good/15 text-good', opponent: them };
  if (them.winner === true) return { label: 'L', tone: 'bg-bad/15 text-bad', opponent: them };
  return { label: b.round === b.rounds && b.clock === '5:00' ? 'D' : 'NC', tone: 'bg-raised text-ink-2', opponent: them };
}

export default async function UfcFighterPage({ params }: Params) {
  const data = await load((await params).fighterId);
  if (!data) notFound();
  const { model, fighter, bouts } = data;
  const { profile } = fighter;
  const next = bouts.find((b) => b.state !== 'post' && Date.parse(b.date || '0') > renderedAt().getTime() - 12 * 3_600_000);
  const nextEvent = next && model.eventsById.get(next.eventId);
  const finished = bouts.filter((b) => b.completed);
  const e = fighter.endings;
  const wins = e.stoppageWins + e.decisionWins;
  return (
    <div className="space-y-8">
      <JsonLd data={{ '@context': 'https://schema.org', '@type': 'Person', name: profile.name, ...(profile.country ? { nationality: profile.country } : {}) }} />
      <PageHeader
        eyebrow={
          <Link href="/ufc" className="hover:underline">
            UFC{fighter.division ? ` · ${fighter.division}` : ''}
          </Link>
        }
        title={
          <span className="flex items-center gap-3">
            <PlayerPhoto league="mma" id={profile.id} name={profile.name} size={64} eager />
            <span>{profile.name}</span>
          </span>
        }
      >
        <p className="flex flex-wrap items-center gap-2">
          <Flag fighter={profile} />
          {[profile.country, profile.listedRecord ? `Pro record ${profile.listedRecord}` : null, fighter.rank && fighter.division ? `#${fighter.rank} in ${fighter.division} by our ratings` : null]
            .filter(Boolean)
            .join(' · ')}
        </p>
      </PageHeader>

      <div className="grid gap-3 sm:grid-cols-3">
        <StatTile
          label="UFC record"
          value={fighter.fights ? `${fighter.wins}-${fighter.losses}${fighter.draws ? `-${fighter.draws}` : ''}` : '—'}
          sub={fighter.noContests ? `plus ${fighter.noContests} no contest${fighter.noContests === 1 ? '' : 's'}` : 'UFC fights since 2001'}
        />
        <StatTile label="Rating" value={fighter.fights ? rating(fighter.rating) : '—'} sub={fighter.fights ? `peak ${rating(fighter.peak)} · from UFC results alone` : 'Starts with the first UFC fight'} />
        <StatTile label="Wins by stoppage" value={wins ? pct(e.stoppageWins / wins) : '—'} sub={wins ? `${e.stoppageWins} of ${wins} UFC wins; lost ${e.stoppageLosses} by stoppage, ${e.decisionLosses} on the cards` : 'No UFC wins yet'} />
      </div>

      {next && nextEvent && (
        <Section
          title="Next fight"
          subtitle={
            <>
              <Link href={`/ufc/event/${nextEvent.id}`} className="underline underline-offset-2">
                {nextEvent.name}
              </Link>{' '}
              · <LocalTime iso={nextEvent.date} show="day" />
            </>
          }
          bare
        >
          <div className="max-w-xl">
            <BoutCard model={model} bout={next} event={nextEvent} />
          </div>
        </Section>
      )}

      <Section title="UFC fights" subtitle="Newest first, with the chance they were given beforehand: the betting line's where there was one (2019 on), our ratings' before that.">

        {finished.length === 0 ? (
          <p className="text-sm text-ink-3">No finished UFC fights yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[34rem] text-sm">
              <thead>
                <tr className="text-left text-xs text-ink-3">
                  <th className="pb-2 font-medium">Result</th>
                  <th className="pb-2 font-medium">Opponent</th>
                  <th className="pb-2 font-medium">How it ended</th>
                  <th className="pb-2 text-right font-medium">Their chance</th>
                  <th className="pb-2 text-right font-medium">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {finished.map((b) => {
                  const o = outcomeFor(b, profile.id);
                  const { chanceA } = shownChance(model, b.id);
                  const mine = b.a.id === profile.id ? chanceA : 1 - chanceA;
                  return (
                    <tr key={b.id}>
                      <td className="py-2">
                        <span className={`inline-flex w-8 justify-center rounded-md text-xs font-bold ${o.tone}`}>{o.label}</span>
                      </td>
                      <td className="py-2">
                        <Link href={`/ufc/fight/${b.id}`} className="text-ink hover:text-accent-strong">
                          {o.opponent.name}
                        </Link>
                      </td>
                      <td className="py-2 text-ink-2">{boutEnding(b) ?? '—'}</td>
                      <td className="py-2 text-right tabular text-ink-2">{pct(mine)}</td>
                      <td className="whitespace-nowrap py-2 text-right text-ink-3">{fightDate(b.date)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </div>
  );
}
