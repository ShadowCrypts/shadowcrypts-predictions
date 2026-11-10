import type { Metadata } from 'next';
import { getAllModels } from '../../lib/model/all';
import { toCard } from '../../lib/model/card';
import { PickCenter } from '../components/PickCenter';
import { PageHeader } from '../components/Section';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Your picks',
  description: 'Pick winners before games start and see your record next to the model on the same games.'
};

export default async function PicksPage() {
  const { models } = await getAllModels();
  const upcoming = models
    .flatMap((m) => m.slate)
    .map(toCard)
    .sort((a, b) => a.date.localeCompare(b.date));
  return (
    <div className="space-y-8">
      <PageHeader eyebrow="Your picks" title="Can you beat the model?">
        <p>
          Pick a side on any upcoming game. Picks lock at the scheduled start and are graded next to the model&apos;s pick on the same
          games. They&apos;re saved in this browser only, so there&apos;s no account to make.
        </p>
      </PageHeader>
      <PickCenter upcoming={upcoming} />
    </div>
  );
}
