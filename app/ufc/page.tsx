import type { Metadata } from 'next';
import Link from 'next/link';
import { pct } from '../../lib/format';
import { renderedAt } from '../../lib/time';
import { fightNight, getUfcModel, type UfcModel } from '../../lib/ufc/model';
import { AutoRefresh } from '../components/AutoRefresh';
import { LocalTime } from '../components/LocalTime';
import { PageHeader, Section, StatTile } from '../components/Section';
import { BoutCard, cardRecord, Flag, mainEventName, mainFirst, rating } from '../components/ufc/UfcBits';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'UFC predictions and odds: win chances for every fight',
  description: 'Win chances for every fight on the next UFC card, fighter ratings for every division, and an honest record of how the forecasts have done.',
  alternates: { canonical: '/ufc' }
};

function RecordSection({ model }: { model: UfcModel }) {
  const { withLines, ratings, live } = model.record;
  return (
    <Section
      id="record"
      title="How the forecasts have done"
      subtitle={`Every UFC fight since 2019 with a winner, graded against what each forecast said beforehand. With a line, a forecast here is the betting market's chance with the bookmaker's cut taken out: across ${withLines.market.games.toLocaleString('en-US')} fights, the market picked ${pct(withLines.market.accuracy)} of winners and our ratings only ${pct(withLines.ratings.accuracy)}, and mixing the ratings in made it worse, so they don't move the number.`}
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <StatTile label="Betting market" value={pct(withLines.market.accuracy, 1)} sub={`${withLines.market.correct.toLocaleString('en-US')} of ${withLines.market.games.toLocaleString('en-US')} fights with a line`} />
        <StatTile label="Our ratings alone" value={pct(ratings.accuracy, 1)} sub={`${ratings.correct.toLocaleString('en-US')} of ${ratings.games.toLocaleString('en-US')} fights, ratings set on 2006–2018`} />
        <StatTile
          label="Locked before each fight"
          value={live.games ? pct(live.accuracy, 1) : '—'}
          sub={live.games ? `${live.correct} of ${live.games} since the UFC section opened` : 'Grading starts with the first card after the UFC section opened (Nov 2026)'}
        />
      </div>
      <p className="mt-4 max-w-3xl text-sm text-ink-2">
        We also tried adding what the fighters bring on top of the market&apos;s chance: age on fight night, reach, height, stance, UFC experience and time
        since the last fight, with weights set on 2019–2022 fights. On 1,606 fights from 2023 on it helped by less than the noise and picked
        fewer winners, so it isn&apos;t used. Older fighters have won a little less often than their odds said (by up to about 4 points since 2019,
        more in some years than others), not steadily enough to forecast with.
      </p>
      <h3 className="mt-6 text-sm font-semibold text-ink">Favorites, by their chance</h3>
      <p className="mt-1 max-w-3xl text-sm text-ink-2">
        How often the market&apos;s favorite won, against the chance its price gave. Big favorites have won a little more often than their prices said: the
        long-known favorite–longshot lean, small enough that adjusting for it didn&apos;t hold up year to year.
      </p>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[22rem] text-sm">
          <thead>
            <tr className="text-left text-xs text-ink-3">
              <th className="pb-2 font-medium">Favorite&apos;s chance</th>
              <th className="pb-2 text-right font-medium">Fights</th>
              <th className="pb-2 text-right font-medium">Priced at</th>
              <th className="pb-2 text-right font-medium">Won</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {model.favorites
              .filter((b) => b.fights > 0)
              .map((b) => (
                <tr key={b.lo}>
                  <td className="py-1.5 text-ink-2">
                    {Math.round(b.lo * 100)}–{Math.round(b.hi * 100)}%
                  </td>
                  <td className="py-1.5 text-right tabular text-ink-2">{b.fights.toLocaleString('en-US')}</td>
                  <td className="py-1.5 text-right tabular text-ink-2">{pct(b.said, 1)}</td>
                  <td className="py-1.5 text-right font-semibold tabular text-ink">{pct(b.won, 1)}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

export default async function UfcPage() {
  const model = await getUfcModel();
  const [next, ...later] = model.upcoming;
  const live = fightNight(model.upcoming, renderedAt().getTime());
  return (
    <div className="space-y-8">
      <PageHeader eyebrow="UFC" title="UFC predictions" aside={<AutoRefresh live={live} at={model.generatedAt} />}>
        <p className="max-w-2xl">
          Win chances for every fight on the card, fighter ratings for every division, and a record of how it all held up. With a betting line, the chance is the
          market&apos;s with the bookmaker&apos;s cut removed: in UFC, nothing we tested beat it.
        </p>
      </PageHeader>

      {next ? (
        <Section
          title={next.name}
          subtitle={
            <>
              <LocalTime iso={next.date} show="long-day" /> · <LocalTime iso={next.date} show="time" />
              {next.venue ? ` · ${next.venue}` : ''}
              {next.city ? `, ${next.city}` : ''}
            </>
          }
          action={
            <Link href={`/ufc/event/${next.id}`} className="text-sm font-semibold text-accent-strong hover:underline">
              Full card
            </Link>
          }
          bare
        >
          <div className="grid gap-3 lg:grid-cols-2">
            {mainFirst(next).map((b) => (
              <BoutCard key={b.id} model={model} bout={b} event={next} />
            ))}
          </div>
        </Section>
      ) : (
        <Section title="Next card">
          <p className="text-sm text-ink-2">No UFC card is listed yet. Check back soon.</p>
        </Section>
      )}

      {later.length > 0 && (
        <Section title="Coming up">
          <ul className="divide-y divide-line">
            {later.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                <Link href={`/ufc/event/${e.id}`} className="font-semibold text-ink hover:text-accent-strong">
                  {e.name}
                </Link>
                <span className="text-sm text-ink-3">
                  <LocalTime iso={e.date} show="day" /> · {e.bouts.length} fight{e.bouts.length === 1 ? '' : 's'} listed
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {model.recent.length > 0 && (
        <Section title="Latest results">
          <ul className="divide-y divide-line">
            {model.recent.map((e) => {
              const { right, graded } = cardRecord(model, e);
              return (
                <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                  <span className="min-w-0">
                    <Link href={`/ufc/event/${e.id}`} className="font-semibold text-ink hover:text-accent-strong">
                      {e.name}
                    </Link>
                    <span className="block text-xs text-ink-3">
                      <LocalTime iso={e.date} show="day" /> · {mainEventName(e)}
                    </span>
                  </span>
                  {graded > 0 && (
                    <span className="text-sm text-ink-2 tabular">
                      {right} of {graded} called right
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </Section>
      )}

      <Section
        id="ratings"
        title="Fighter ratings by division"
        subtitle="From UFC results alone: every win moves a fighter up by how surprising it was. Active fighters with three or more UFC fights. A guide to who has beaten whom, not a forecast: as one, the ratings have been well behind the betting market."
      >
        <div className="grid gap-x-8 gap-y-6 sm:grid-cols-2 xl:grid-cols-3">
          {model.divisions.map((d) => (
            <div key={d.name}>
              <h3 className="text-sm font-semibold text-ink">{d.name}</h3>
              <ol className="mt-2 space-y-1.5 text-sm">
                {d.fighters.slice(0, 5).map((f) => (
                  <li key={f.profile.id} className="flex items-center gap-2">
                    <span className="w-4 text-right text-xs text-ink-3 tabular">{f.rank}</span>
                    <Flag fighter={f.profile} size={14} />
                    <Link href={`/ufc/fighter/${f.profile.id}`} className="min-w-0 flex-1 truncate text-ink-2 hover:text-ink">
                      {f.profile.name}
                    </Link>
                    <span className="text-xs text-ink-3 tabular">{rating(f.rating)}</span>
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </div>
      </Section>

      <RecordSection model={model} />
    </div>
  );
}
