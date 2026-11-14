import Link from 'next/link';
import { BRAND } from '../../../lib/brand';
import { InstallApp } from '../InstallApp';
import { FeedbackButton } from './FeedbackButton';
import { LogoMark } from './Logo';
import { Signature } from './Signature';

const COLUMNS = [
  {
    title: 'Leagues',
    links: [
      { href: '/nfl', label: 'NFL' },
      { href: '/nba', label: 'NBA' },
      { href: '/mlb', label: 'MLB' },
      { href: '/nhl', label: 'NHL' },
      { href: '/ufc', label: 'UFC' }
    ]
  },
  {
    title: 'Model',
    links: [
      { href: '/live', label: 'Live mode' },
      { href: '/record', label: 'Track record' },
      { href: '/results', label: 'Results by date' },
      { href: '/picks', label: 'Your picks' },
      { href: '/matchup', label: 'Matchup machine' },
      { href: '/nba/compare', label: 'Compare players' },
      { href: '/nfl/playoffs', label: 'Playoff machine' },
      { href: '/nfl/fantasy', label: 'Fantasy rankings' },
      { href: '/nba/injuries', label: 'Injury report' },
      { href: '/props', label: 'Player props' },
      { href: '/parlay', label: 'Parlay builder' },
      { href: '/nba/players', label: 'NBA player ratings' },
      { href: '/nfl/players', label: 'NFL quarterback ratings' },
      { href: '/nhl/players', label: 'NHL players' },
      { href: '/record#methodology', label: 'How it works' }
    ]
  },
  {
    title: 'Data',
    links: [
      { href: '/data', label: 'Data and API docs' },
      { href: '/api/predictions', label: 'Predictions API' },
      { href: '/api/rankings', label: 'Rankings API' },
      { href: '/api/record', label: 'Record API' },
      { href: '/api/players', label: 'Players API' }
    ]
  }
];

export function Footer() {
  return (
    <footer className="mt-16 border-t border-line">
      <div className="mx-auto grid max-w-7xl gap-8 px-4 py-10 sm:px-6 md:grid-cols-[minmax(0,1.4fr)_repeat(3,minmax(0,1fr))]">
        <div className="max-w-sm">
          <div className="flex items-center gap-2.5">
            <LogoMark size={26} />
            <span className="font-display font-semibold text-ink">{BRAND.name}</span>
          </div>
          <p className="mt-3 text-sm text-ink-3">
            Forecasts are probabilities, not guarantees. They&apos;re for insight and entertainment, not betting advice. If you bet, set
            limits. Help is available at 1-800-GAMBLER.
          </p>
          <p className="mt-3 text-xs text-ink-3">Schedules, scores, injuries and lines from ESPN&apos;s public feeds. Not affiliated with any league.</p>
          <div className="mt-4 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <FeedbackButton />
              <span className="text-xs text-ink-3">An idea, a bug, a number that looks off? Every message gets read.</span>
            </div>
            <InstallApp />
          </div>
        </div>
        {COLUMNS.map((col) => (
          <div key={col.title}>
            <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-ink-3">{col.title}</h2>
            <ul className="mt-3 space-y-2 text-sm">
              {col.links.map((link) => (
                <li key={link.href}>
                  <Link href={link.href} className="text-ink-2 transition hover:text-ink">
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="border-t border-line">
        <div className="mx-auto flex max-w-7xl items-end justify-between gap-4 px-4 py-4 sm:px-6">
          <p className="text-xs text-ink-3">
            © {new Date().getFullYear()} {BRAND.name} ·{' '}
            <Link href="/privacy" className="underline underline-offset-2 transition hover:text-ink">
              Privacy
            </Link>{' '}
            ·{' '}
            <Link href="/feedback" className="underline underline-offset-2 transition hover:text-ink">
              Feedback
            </Link>
          </p>
          <Signature className="h-auto w-32 shrink-0 rounded-lg ring-1 ring-line sm:w-40" />
        </div>
      </div>
    </footer>
  );
}
