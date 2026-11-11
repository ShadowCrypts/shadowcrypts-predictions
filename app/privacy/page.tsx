import type { Metadata } from 'next';
import Link from 'next/link';
import { PageHeader, Section } from '../components/Section';

export const metadata: Metadata = {
  title: 'Privacy',
  description: 'What ShadowCrypts Predictions keeps about you: no accounts, no cookies, no ads, no trackers. Almost everything stays in your own browser.',
  alternates: { canonical: '/privacy' }
};

/** Last changed: update this date whenever the page's substance changes. */
const UPDATED = 'November 10, 2026';
const SOURCE = 'https://github.com/ShadowCrypts/shadowcrypts-predictions';

const linkClass = 'text-accent-strong underline underline-offset-2';

function Facts({ items }: { items: React.ReactNode[] }) {
  return (
    <ul className="max-w-3xl list-disc space-y-2 pl-5 text-sm leading-relaxed text-ink-2">
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  );
}

export default function PrivacyPage() {
  return (
    <div className="space-y-8">
      <PageHeader eyebrow="Privacy" title="What this site keeps about you">
        <p className="max-w-2xl">
          The short version: no accounts, no cookies, no ads and no trackers. Almost everything you do here stays in your own browser, and the few
          things that don&apos;t are listed below. Last updated {UPDATED}.
        </p>
      </PageHeader>

      <Section title="In your browser, and nowhere else" subtitle="Saved on your device so the site remembers them. We never see them, unless you turn on alerts (next section).">
        <Facts
          items={[
            'The parlays you build and track, and your pick’em picks.',
            'The teams and players you follow.',
            'Your theme, your alert settings, and when you last visited (for “since your last visit”).',
            'Pages you’ve opened, kept so they still open without a connection.',
            'To erase all of it, clear this site’s data in your browser’s settings.'
          ]}
        />
      </Section>

      <Section title="If you turn on alerts" subtitle="Only then does anything about you reach our server.">
        <Facts
          items={[
            'Your browser gives us a delivery address from its own push service (run by Google, Mozilla, Apple or Microsoft, depending on your browser). It doesn’t say who you are.',
            'With it we keep what you asked to hear about: your tracked parlays’ legs, the teams and players you follow, and which alerts you want. That’s how the server knows what to send.',
            'Alerts only ever go through those push services, never anywhere else.',
            'Turning alerts off deletes all of it from the server. A browser that hasn’t visited the site for 30 days is deleted automatically.'
          ]}
        />
      </Section>

      <Section title="Counting visits" subtitle="So we know whether anyone’s using the site, without knowing who.">
        <Facts
          items={[
            'Each day the server adds up how many times someone opened the site, which kind of page they landed on (for example, “an NBA game page”), and the name of the website that sent them (for example, google.com).',
            'That’s all. No IP addresses, no cookies, no browser fingerprints, and no record of anyone visit by visit: only totals for the day.',
            'Moving between pages inside the site isn’t counted. Robots and link previews are kept out of the count, in a daily total of their own (with which kind of page they opened and why they were taken for a robot), so we can tell how many there were.',
            'Telling them apart uses what every browser sends with a page anyway (its name, and headers saying it’s opening a page and which language it reads), checked as the page loads and then forgotten.'
          ]}
        />
      </Section>

      <Section title="Server logs">
        <Facts
          items={[
            'Errors, content your browser blocked for safety and reported to us, and requests turned away for coming too fast are logged one line each, without IP addresses, identifying headers or the details in a page’s address.',
            'To stop floods, the server counts requests per address for a minute (new alert sign-ups for an hour), in memory only, and keeps nothing.',
            'The company that hosts the server may keep its own access logs, under its own policy.'
          ]}
        />
      </Section>

      <Section title="Other companies your browser talks to">
        <Facts
          items={[
            <>
              Team logos and player photos load from ESPN&apos;s image server, so ESPN sees your browser fetch them, as on any site showing its
              images. Scores, schedules and odds come from ESPN&apos;s public feeds through our server, not your browser.
            </>,
            'No one else: the fonts are served from this site, and the site’s security rules stop your browser connecting to anywhere but this site and that image server.'
          ]}
        />
      </Section>

      <Section title="Betting">
        <Facts
          items={[
            'Forecasts, odds and the parlay tools are for insight and entertainment, not betting advice. Nothing here takes bets or sends you to a sportsbook.',
            'If you bet, you must be of legal age where you live, and set limits. Help is available at 1-800-GAMBLER.'
          ]}
        />
      </Section>

      <Section title="Questions">
        <p className="max-w-3xl text-sm leading-relaxed text-ink-2">
          This site&apos;s code is public, so you can check every word of this page against it:{' '}
          <a href={SOURCE} className={linkClass}>
            github.com/ShadowCrypts/shadowcrypts-predictions
          </a>
          . You can ask a question there by opening an issue. To report a security problem privately, see the{' '}
          <a href={`${SOURCE}/security`} className={linkClass}>
            security page
          </a>
          . The data the site publishes is described on the{' '}
          <Link href="/data" className={linkClass}>
            data page
          </Link>
          .
        </p>
      </Section>
    </div>
  );
}
