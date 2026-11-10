import type { Metadata } from 'next';
import { liveBoard } from '../../lib/model/liveBoard';
import { LiveMode } from '../components/LiveMode';

export const metadata: Metadata = {
  title: 'Live',
  description: 'Every game on right now with live win chances, and your tracked parlays sweating in real time: each leg filling toward its line and the chance to cash.'
};

export const dynamic = 'force-dynamic';

export default async function LivePage() {
  // Rendered with the board already in it, so nothing jumps when the first refresh lands.
  const initial = await liveBoard().catch(() => null);
  return <LiveMode initial={initial} />;
}
