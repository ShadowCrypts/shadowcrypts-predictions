'use client';

import { Star } from 'lucide-react';
import { teamKey, useFavorites } from './favorites';

export function FollowButton({ league, teamId, name, compact = false }: { league: string; teamId: string; name: string; compact?: boolean }) {
  const { favorites, toggle } = useFavorites();
  const following = favorites.has(teamKey(league, teamId));
  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        toggle(teamKey(league, teamId));
      }}
      aria-pressed={following}
      aria-label={following ? `Unfollow ${name}` : `Follow ${name}`}
      title={following ? 'Following: their games show under My teams' : 'Follow to filter the board to your teams'}
      className={
        compact
          ? `rounded-md p-1 transition ${following ? 'text-warn' : 'text-ink-3 hover:text-ink'}`
          : `inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium ring-1 transition ${
              following ? 'bg-warn/10 text-ink ring-warn/40' : 'text-ink-2 ring-line hover:bg-raised hover:text-ink'
            }`
      }
    >
      <Star className={`h-4 w-4 ${following ? 'fill-warn text-warn' : ''}`} aria-hidden />
      {!compact && (following ? 'Following' : 'Follow')}
    </button>
  );
}
