import type { Metadata } from 'next';
import Link from 'next/link';
import { Trophy } from 'lucide-react';
import { pct, pctCapped } from '../../../../lib/format';
import { formatAmerican } from '../../../../lib/model/market';
import { sharedLegs } from '../../../../lib/model/sharedParlay';
import { readShareCode, summarize } from '../../../../lib/parlay';
import { ChanceBar } from '../../../components/ChanceBar';
import { ChanceRing } from '../../../components/ChanceRing';
import { LocalTime } from '../../../components/LocalTime';
import { PlayerPhoto } from '../../../components/PlayerPhoto';
import { EmptyState, PageHeader } from '../../../components/Section';
import { SharedParlayActions } from '../../../components/SharedParlayActions';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ code: string }> };

async function load(code: string) {
  const { ids, price } = readShareCode(code);
  const { legs, unavailable } = ids.length ? await sharedLegs(ids) : { legs: [], unavailable: 0 };
  return { legs, unavailable, price, summary: summarize(legs, price) };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { legs, summary } = await load((await params).code);
  if (!summary) return { title: 'Shared parlay', robots: { index: false } };
  return {
    title: `${legs.length}-leg parlay · ${pctCapped(summary.chance)} to cash`,
    description: legs.map((l) => l.label).join(' · '),
    // Anyone can make one of these: they're for sharing, not for search results.
    robots: { index: false }
  };
}

function Figure({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl bg-raised p-3 ring-1 ring-line">
      <p className="text-xs text-ink-3">{label}</p>
      <p className="mt-1 font-display text-xl font-semibold tabular text-ink">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-ink-3">{sub}</p>}
    </div>
  );
}

/**
 * A parlay someone shared: every leg priced fresh from the model (names,
 * chances and prices are the site's own, whatever the link says), the chance
 * the whole thing cashes, and a button to load it into your own builder.
 */
export default async function SharedParlayPage({ params }: Props) {
  const { legs, unavailable, price, summary } = await load((await params).code);
  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Shared parlay"
        title={
          summary ? (
            <>
              {legs.length}-leg parlay, <span className="text-gradient">{pctCapped(summary.chance)} to cash</span>
            </>
          ) : (
            'This parlay can’t be priced now'
          )
        }
      >
        <p>
          Someone sent you a parlay. Every leg below is priced fresh from today&apos;s forecasts and lines, the same numbers the rest of
          the site shows, so this is what it&apos;s worth right now.
        </p>
      </PageHeader>

      {summary ? (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
          <section aria-label="Legs" className="card p-4 sm:p-5">
            <ul className="divide-y divide-line/60">
              {legs.map((l) => (
                <li key={l.key} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                  {l.link?.kind === 'prop' ? (
                    <PlayerPhoto league={l.league} id={l.link.playerId} name={l.label.split(/ (?:over|under) /)[0]} size={36} />
                  ) : (
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent-strong ring-1 ring-accent/25" aria-hidden>
                      <Trophy className="h-4 w-4" />
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-ink">{l.label}</p>
                    <p className="text-xs text-ink-3">
                      <Link href={`/${l.league}/game/${l.gameId}`} className="hover:text-ink hover:underline">
                        {l.game}
                      </Link>{' '}
                      · <LocalTime iso={l.start} />
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end text-right">
                    <p className="font-display text-lg font-semibold tabular text-ink">{pct(l.prob)}</p>
                    <ChanceBar chance={l.prob} />
                    <p className="mt-1 text-xs tabular text-ink-3">{l.price !== null ? formatAmerican(l.price) : 'no posted price'}</p>
                  </div>
                </li>
              ))}
            </ul>
            {unavailable > 0 && (
              <p className="mt-4 rounded-lg bg-raised px-3 py-2 text-xs text-ink-3 ring-1 ring-line">
                {unavailable} {unavailable === 1 ? 'leg was' : 'legs were'} left out: the game has started, the line is no longer posted,
                or it repeats a bet already above.
              </p>
            )}
          </section>
          <aside className="space-y-4">
            <div className="card relative flex flex-col items-center gap-4 overflow-hidden p-5">
              <span className="pointer-events-none absolute -top-16 left-1/2 h-48 w-48 -translate-x-1/2 rounded-full bg-accent/25 blur-3xl" aria-hidden />
              <span className="relative">
                <ChanceRing value={summary.chance} size={150} label="Chance every leg hits" decimals={summary.chance < 0.1 ? 1 : 0} />
              </span>
              <div className="relative grid w-full grid-cols-2 gap-2">
                <Figure label="Fair odds" value={formatAmerican(summary.fair)} sub="break-even price" />
                <Figure
                  label={price !== null ? 'Offered' : summary.sameGame ? 'Legs multiplied' : 'Book pays'}
                  value={price !== null ? formatAmerican(price) : summary.multiplied ? formatAmerican(summary.multiplied.american) : '—'}
                  sub={summary.expectedReturn !== null ? `${summary.expectedReturn >= 0 ? '+' : '−'}${Math.abs(summary.expectedReturn * 100).toFixed(1)}% a bet on average` : undefined}
                />
              </div>
              {summary.sameGame && (
                <p className="relative text-xs text-ink-3">Some legs share a game, so they move together; the chance accounts for it. Books price those parlays themselves.</p>
              )}
            </div>
            <SharedParlayActions legs={legs} />
            <p className="text-xs text-ink-3">
              Chances are the books&apos; own numbers with their margin removed, combined. For insight and fun, not betting advice.
            </p>
          </aside>
        </div>
      ) : (
        <EmptyState>
          {unavailable
            ? 'Every leg in this link has started or come off the board, so there’s nothing left to price.'
            : 'This link doesn’t hold any legs we can read.'}{' '}
          <Link href="/props" className="text-accent-strong underline underline-offset-2">
            Build your own from today&apos;s props →
          </Link>
        </EmptyState>
      )}
    </div>
  );
}
