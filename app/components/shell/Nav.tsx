'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChartLine, House, Ticket } from 'lucide-react';

// `short` is used on medium screens; `wideOnly` links live in the footer until there's room, and `largeUp` ones
// (live mode) in the ticker's Live button.
const LINKS: { href: string; label: string; short?: string; wideOnly?: boolean; largeUp?: boolean; live?: boolean }[] = [
  { href: '/', label: 'Today' },
  { href: '/live', label: 'Live', largeUp: true, live: true },
  { href: '/nfl', label: 'NFL' },
  { href: '/nba', label: 'NBA' },
  { href: '/mlb', label: 'MLB' },
  { href: '/nhl', label: 'NHL' },
  { href: '/ufc', label: 'UFC' },
  { href: '/props', label: 'Props' },
  { href: '/matchup', label: 'Matchup', wideOnly: true },
  { href: '/record', label: 'Track record', short: 'Record' }
  // Plans is hidden until billing exists: the page still works at /plans, but isn't linked or indexed.
];

function useIsActive() {
  const pathname = usePathname();
  return (href: string) => (href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`));
}

/** Desktop header nav. */
export function Nav() {
  const isActive = useIsActive();
  return (
    <nav aria-label="Main" className="hidden md:block">
      <ul className="flex items-center gap-0.5">
        {LINKS.map((link) => {
          const active = isActive(link.href);
          return (
            <li key={link.href} className={link.wideOnly ? 'hidden xl:block' : link.largeUp ? 'hidden lg:block' : undefined}>
              <Link
                href={link.href}
                aria-current={active ? 'page' : undefined}
                className={`relative block whitespace-nowrap rounded-lg px-2.5 py-2 text-sm font-medium transition lg:px-3 ${
                  active ? 'text-ink' : 'text-ink-2 hover:bg-raised hover:text-ink'
                }`}
              >
                {link.short ? (
                  <>
                    <span className="xl:hidden">{link.short}</span>
                    <span className="hidden xl:inline">{link.label}</span>
                  </>
                ) : link.live ? (
                  <span className="flex items-center gap-1.5">
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-live" aria-hidden />
                    {link.label}
                  </span>
                ) : (
                  link.label
                )}
                {active && <span className="absolute inset-x-2.5 -bottom-[13px] h-0.5 rounded-full bg-accent lg:inset-x-3" aria-hidden />}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

const TABS = [
  { href: '/', label: 'Today', icon: 'home' as const },
  { href: '/nfl', label: 'NFL' },
  { href: '/nba', label: 'NBA' },
  { href: '/mlb', label: 'MLB' },
  { href: '/nhl', label: 'NHL' },
  { href: '/ufc', label: 'UFC' },
  { href: '/props', label: 'Props', icon: 'props' as const },
  { href: '/record', label: 'Record', icon: 'record' as const }
];

/** Phone tab bar, app-style, pinned above the home indicator. */
export function MobileTabs() {
  const isActive = useIsActive();
  return (
    <nav aria-label="Main" className="pb-safe fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/90 backdrop-blur-xl md:hidden">
      <ul className="mx-auto grid max-w-lg grid-cols-8">
        {TABS.map((tab) => {
          const active = isActive(tab.href);
          return (
            <li key={tab.href}>
              <Link
                href={tab.href}
                aria-current={active ? 'page' : undefined}
                className={`flex h-14 flex-col items-center justify-center gap-1 text-[11px] font-medium transition ${active ? 'text-ink' : 'text-ink-3'}`}
              >
                {tab.icon === 'home' ? (
                  <House className={`h-5 w-5 ${active ? 'text-accent-strong' : ''}`} aria-hidden />
                ) : tab.icon === 'record' ? (
                  <ChartLine className={`h-5 w-5 ${active ? 'text-accent-strong' : ''}`} aria-hidden />
                ) : tab.icon === 'props' ? (
                  <Ticket className={`h-5 w-5 ${active ? 'text-accent-strong' : ''}`} aria-hidden />
                ) : (
                  <span
                    className={`flex h-5 min-w-[30px] items-center justify-center rounded-md px-1 text-[10px] font-bold tracking-wide ring-1 ${
                      active ? 'bg-accent text-on-accent ring-accent' : 'ring-line-strong'
                    }`}
                    aria-hidden
                  >
                    {tab.label}
                  </span>
                )}
                <span className={tab.icon ? '' : 'sr-only'}>{tab.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
