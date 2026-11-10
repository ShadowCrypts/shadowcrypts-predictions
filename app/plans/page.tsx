import type { Metadata } from 'next';
import Link from 'next/link';
import { Check } from 'lucide-react';
import { PageHeader } from '../components/Section';

export const metadata: Metadata = { title: 'Plans', description: 'ShadowCrypts Predictions plans. Every plan gets the same model.' };

const TIERS = [
  {
    name: 'Bronze',
    metal: '#cd7f32',
    price: '$9.99',
    pitch: 'The daily board.',
    features: [
      'Win probabilities for every NFL, NBA, MLB and NHL game',
      'Confidence bands on every pick',
      'Power rankings for all four leagues',
      'Team pages, follows and the My teams filter'
    ]
  },
  {
    name: 'Silver',
    metal: '#a8b4c4',
    price: '$19.99',
    pitch: 'The why behind each pick.',
    features: ['Everything in Bronze', 'Full game breakdowns: every factor in Elo points', 'Injury-adjusted numbers with player-level impact', 'Rating history charts']
  },
  {
    name: 'Gold',
    metal: '#d4af37',
    price: '$34.99',
    pitch: 'Ratings vs. the market.',
    features: ['Everything in Silver', 'Elo line vs. the posted line on every game', 'Ratings-vs-line board', 'Market-implied power ratings', 'Logged pick record, graded live']
  },
  {
    name: 'Elite',
    metal: '#8b5cf6',
    price: '$59.99',
    pitch: 'Raw data for your own work.',
    features: ['Everything in Gold', 'JSON API: predictions, rankings and track record', 'Calibration and backtest data by league', 'Early access to new leagues']
  }
];

export default function PlansPage() {
  return (
    <div className="space-y-8">
      <PageHeader eyebrow="Plans" title="One model, four levels of depth">
        <p>
          Every plan sees the same forecasts from the same model. Higher tiers add explanation, market comparison and data access, not
          &ldquo;more accurate&rdquo; picks. The{' '}
          <Link href="/record" className="font-medium text-ink underline decoration-accent/60 underline-offset-4">
            track record
          </Link>{' '}
          is public for everyone.
        </p>
      </PageHeader>

      <p className="rounded-xl border border-accent/30 bg-accent/10 px-4 py-3 text-sm text-ink">
        Preview: billing isn&apos;t connected yet, so every feature is open to everyone.
      </p>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {TIERS.map((tier) => (
          <div key={tier.name} className="card relative flex flex-col overflow-hidden p-5 transition hover:border-accent/40">
            {/* Each tier in its own metal: a glow from the top and a thin bar along it. */}
            <span className="pointer-events-none absolute inset-0" style={{ background: `radial-gradient(90% 55% at 50% 0%, ${tier.metal}33, transparent 70%)` }} aria-hidden />
            <span className="pointer-events-none absolute inset-x-0 top-0 h-[3px]" style={{ background: `linear-gradient(90deg, transparent, ${tier.metal}, transparent)` }} aria-hidden />
            <h2 className="relative flex items-center gap-2 font-display text-lg font-semibold text-ink">
              <span
                className="h-3.5 w-3.5 rounded-full ring-1 ring-inset ring-white/30"
                style={{ background: `linear-gradient(135deg, ${tier.metal}, ${tier.metal}88)`, boxShadow: `0 0 12px ${tier.metal}88` }}
                aria-hidden
              />
              {tier.name}
            </h2>
            <p className="relative mt-1 text-sm text-ink-2">{tier.pitch}</p>
            <p className="relative mt-5 font-display text-4xl font-bold tracking-tight text-ink">
              {tier.price}
              <span className="font-sans text-sm font-normal text-ink-3"> /month</span>
            </p>
            <ul className="relative mt-5 flex-1 space-y-2.5 text-sm text-ink-2">
              {tier.features.map((feature) => (
                <li key={feature} className="flex gap-2">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-accent-strong" aria-hidden />
                  {feature}
                </li>
              ))}
            </ul>
            <button
              type="button"
              disabled
              className="relative mt-6 cursor-not-allowed rounded-xl bg-raised px-4 py-2.5 text-sm font-medium text-ink-3 ring-1 ring-line"
              title="Billing isn't connected yet"
            >
              Coming soon
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
