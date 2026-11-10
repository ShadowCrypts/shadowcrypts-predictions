'use client';

import { Star } from 'lucide-react';
import { playerKey, useFollowedPlayers } from './favorites';

/** Follow a player: his next game's lines show on the home page under Your players. */
export function FollowPlayerButton({ league, playerId, name }: { league: string; playerId: string; name: string }) {
  const { players, toggle } = useFollowedPlayers();
  const key = playerKey(league, playerId);
  const following = players.has(key);
  return (
    <button
      type="button"
      onClick={() => toggle(key)}
      aria-pressed={following}
      aria-label={following ? `Unfollow ${name}` : `Follow ${name}`}
      title={
        following
          ? 'Following: his next lines show on the home page, and with alerts on you hear when they post'
          : 'Follow to see his next lines on the home page (and, with alerts on, hear when they post)'
      }
      className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium ring-1 transition ${
        following ? 'bg-warn/10 text-ink ring-warn/40' : 'text-ink-2 ring-line hover:bg-raised hover:text-ink'
      }`}
    >
      <Star className={`h-4 w-4 ${following ? 'fill-warn text-warn' : ''}`} aria-hidden />
      {following ? 'Following' : 'Follow'}
    </button>
  );
}
