'use client';

import { Star } from 'lucide-react';
import { teamKey, useFavorites } from './favorites';

/** Small marker next to a team you follow. */
export function FollowedStar({ league, teamId }: { league: string; teamId: string }) {
  const { favorites } = useFavorites();
  if (!favorites.has(teamKey(league, teamId))) return null;
  return <Star className="h-3.5 w-3.5 shrink-0 fill-warn text-warn" aria-label="Following" />;
}
