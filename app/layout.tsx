import type { Metadata, Viewport } from 'next';
import { Inter, Sora } from 'next/font/google';
import { headers } from 'next/headers';
import { Suspense } from 'react';
import { BRAND } from '../lib/brand';
import { historyNow } from '../lib/model/history';
import { themeScript } from '../lib/theme';
import { siteUrl } from '../lib/site';
import { JsonLd } from './components/JsonLd';
import { ParlayDock } from './components/ParlayDock';
import { Footer } from './components/shell/Footer';
import { LiveTicker } from './components/shell/LiveTicker';
import { NavProgress } from './components/shell/NavProgress';
import { Logo } from './components/shell/Logo';
import { MobileTabs, Nav } from './components/shell/Nav';
import { OfflineSupport } from './components/shell/Offline';
import { PageTransition } from './components/shell/PageTransition';
import { PushSync } from './components/shell/PushSync';
import { Search } from './components/shell/Search';
import { ThemeToggle } from './components/shell/ThemeToggle';
import './styles/globals.css';

const sans = Inter({ subsets: ['latin'], variable: '--font-sans', display: 'swap' });
const display = Sora({ subsets: ['latin'], variable: '--font-display', weight: ['500', '600', '700'], display: 'swap' });

export const metadata: Metadata = {
  // Set SITE_URL in production so shared links get absolute preview-image URLs.
  metadataBase: new URL(process.env.SITE_URL ?? 'http://localhost:3000'),
  title: { default: `${BRAND.name} · NFL, NBA, MLB & NHL forecasts`, template: `%s · ${BRAND.shortName}` },
  description: BRAND.description,
  applicationName: BRAND.name,
  appleWebApp: { capable: true, title: BRAND.shortName, statusBarStyle: 'black-translucent' },
  formatDetection: { telephone: false },
  openGraph: { siteName: BRAND.name, type: 'website' }
};

export const viewport: Viewport = {
  themeColor: BRAND.themeColor,
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover'
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // proxy.ts makes a nonce for each page; the Content Security Policy lets only scripts that carry it run inline.
  const nonce = (await headers()).get('x-nonce') ?? undefined;
  const history = await historyNow();
  return (
    <html lang="en" data-theme="dark" className={`${sans.variable} ${display.variable}`} suppressHydrationWarning>
      <head>
        {/* Team logos and player photos come from ESPN's image server: open the connection before the first one is found. */}
        {/* No crossOrigin: images load without CORS, and a CORS connection wouldn't be reused for them. */}
        <link rel="preconnect" href="https://a.espncdn.com" />
        <link rel="dns-prefetch" href="https://a.espncdn.com" />
        {/* Browsers hide a nonce from the page once it's checked, so it never matches on hydration. */}
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: themeScript }} suppressHydrationWarning />
      </head>
      <body className="min-h-screen bg-bg font-sans text-ink">
        <div className="site-backdrop" aria-hidden />
        <a href="#main" className="sr-only z-50 rounded-lg bg-accent px-3 py-2 text-on-accent focus:not-sr-only focus:fixed focus:left-4 focus:top-4">
          Skip to content
        </a>
        <Suspense fallback={null}>
          <NavProgress />
        </Suspense>
        <header className="sticky top-0 z-40 border-b border-line bg-bg/75 backdrop-blur-xl">
          <div className="mx-auto flex h-16 max-w-7xl items-center gap-4 px-4 sm:px-6">
            <Logo />
            <div className="ml-auto flex items-center gap-1 md:ml-6 md:mr-auto">
              <Nav />
            </div>
            <div className="flex items-center gap-2">
              <Search />
              <ThemeToggle />
            </div>
          </div>
        </header>
        <LiveTicker />
        <OfflineSupport />
        {history.loading && (
          <p role="status" className="border-b border-line bg-raised/60 px-4 py-2 text-center text-xs text-ink-2">
            This site is still downloading its history{history.share > 0 && ` (${Math.round(history.share * 100)}% so far)`}.{history.forecastsSettled ? 'Game forecasts are within about a point or two of final;' : 'For the next few minutes game forecasts can be several points off;'} player numbers, prop records and fantasy rankings are thinner until it finishes.
          </p>
        )}
        <main id="main" className="mx-auto max-w-7xl px-4 pb-28 pt-6 sm:px-6 sm:pt-8 md:pb-10">
          <PageTransition>{children}</PageTransition>
        </main>
        <div className="pb-20 md:pb-0">
          <Footer />
        </div>
        <ParlayDock />
        <MobileTabs />
        <PushSync />
        <JsonLd
          data={{
            '@context': 'https://schema.org',
            '@graph': [
              { '@type': 'WebSite', name: BRAND.name, url: siteUrl(), description: BRAND.description, inLanguage: 'en-US' },
              { '@type': 'Organization', name: BRAND.name, url: siteUrl(), logo: `${siteUrl()}/brand-icon/512` }
            ]
          }}
        />
      </body>
    </html>
  );
}
