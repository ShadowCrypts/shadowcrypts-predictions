import type { Metadata } from 'next';
import Link from 'next/link';
import { feedbackPage } from '../../lib/feedbackRead';
import { FeedbackForm } from '../components/FeedbackForm';
import { PageHeader, Section } from '../components/Section';

export const metadata: Metadata = {
  title: 'Feedback',
  description: 'Send the person who runs ShadowCrypts Predictions an idea, a bug, or a number that looks wrong. No account needed.',
  alternates: { canonical: '/feedback' },
  // A form, with nothing for a search to find.
  robots: { index: false, follow: true }
};

const SOURCE = 'https://github.com/ShadowCrypts/shadowcrypts-predictions';
const linkClass = 'text-accent-strong underline underline-offset-2';

export default async function FeedbackPage({ searchParams }: { searchParams: Promise<{ from?: string }> }) {
  const { from } = await searchParams;
  return (
    <div className="space-y-8">
      <PageHeader eyebrow="Feedback" title="Tell us what you think">
        <p className="max-w-2xl">
          An idea, something that&apos;s broken, a number that looks wrong: it goes straight to the person who runs the site. No account needed, and
          every message gets read.
        </p>
      </PageHeader>

      <Section title="Your message">
        <FeedbackForm from={feedbackPage(from)} />
      </Section>

      <p className="max-w-3xl text-xs leading-relaxed text-ink-3">
        What&apos;s kept: your message, the kind you picked, the page you came from and, only if you give one, a way to reach you. No IP address
        (see{' '}
        <Link href="/privacy" className={linkClass}>
          Privacy
        </Link>
        ). Found a security problem? Please report it privately on{' '}
        <a href={`${SOURCE}/security`} className={linkClass}>
          GitHub
        </a>{' '}
        instead.
      </p>
    </div>
  );
}
