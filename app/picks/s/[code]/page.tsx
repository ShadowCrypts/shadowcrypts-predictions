import type { Metadata } from 'next';
import Link from 'next/link';
import { readPicksShare } from '../../../../lib/picksShare';
import { ChanceRing } from '../../../components/ChanceRing';
import { EmptyState, PageHeader } from '../../../components/Section';

type Props = { params: Promise<{ code: string }> };

const record = (r: { won: number; lost: number }) => `${r.won}–${r.lost}`;

/** One side of the scoreboard: how often they called it, as a ring, and the record. */
function Side({ name, r, games }: { name: string; r: { won: number; lost: number }; games: number }) {
  return (
    <div className="flex flex-col items-center text-center">
      <ChanceRing value={r.won / games} size={124} label={`${name}, picks correct`} caption="correct" />
      <p className="mt-2 font-display text-lg font-semibold text-ink">{name}</p>
      <p className="text-sm text-ink-3 tabular">{record(r)}</p>
    </div>
  );
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const score = readPicksShare((await params).code);
  if (!score) return { title: 'Pick’em', robots: { index: false } };
  return {
    title: `${record(score.yours)} vs the model's ${record(score.model)} · Pick'em`,
    description: 'Someone picked winners against the ShadowCrypts model on the same games. Can you beat it?',
    // Anyone can make one of these: they're for sharing, not for search results.
    robots: { index: false }
  };
}

/**
 * A pick'em record someone shared, next to the model's on the same games. The
 * numbers are as their browser counted them; the page says so.
 */
export default async function SharedPicksPage({ params }: Props) {
  const score = readPicksShare((await params).code);
  if (!score) {
    return (
      <div className="space-y-8">
        <PageHeader eyebrow="Pick'em" title="Can you beat the model?" />
        <EmptyState>
          This link doesn&apos;t hold a record we can read.{' '}
          <Link href="/picks" className="text-accent-strong underline underline-offset-2">
            Make your own picks →
          </Link>
        </EmptyState>
      </div>
    );
  }
  const games = score.yours.won + score.yours.lost;
  const lead = score.yours.won - score.model.won;
  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Pick'em, shared"
        title={lead > 0 ? 'They beat the model' : lead < 0 ? 'The model won this one' : 'Dead even with the model'}
      >
        <p>
          Someone picked winners on {games} {games === 1 ? 'game' : 'games'} against our forecast on the same games, as counted in their browser.
        </p>
      </PageHeader>
      <section className="card relative overflow-hidden p-6 sm:p-8" aria-label="The scoreboard">
        <span className="pointer-events-none absolute -left-16 -top-20 h-56 w-56 rounded-full bg-accent/20 blur-3xl" aria-hidden />
        <div className="relative grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-4 sm:gap-8">
          <Side name="Them" r={score.yours} games={games} />
          <p className="font-display text-sm font-semibold uppercase tracking-[0.2em] text-ink-3">vs</p>
          <Side name="The model" r={score.model} games={games} />
        </div>
      </section>
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/picks" className="rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-on-accent transition hover:bg-accent-strong">
          Make your own picks →
        </Link>
        <Link href="/record" className="text-sm text-ink-2 underline underline-offset-2 hover:text-ink">
          The model&apos;s full track record
        </Link>
      </div>
    </div>
  );
}
