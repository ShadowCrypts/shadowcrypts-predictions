'use client';

import Image from 'next/image';
import { useState } from 'react';
import { headshotUrl, initials } from '../../lib/search';

/**
 * ESPN's headshot in a circle, or the player's initials when ESPN has none;
 * `ring` wraps it in his team's color. Decorative: his name is always beside it.
 * `eager` loads it straight away, for photos at the top of a page.
 */
export function PlayerPhoto({ league, id, name, size = 28, ring, eager = false }: { league: string; id: string; name: string; size?: number; ring?: string; eager?: boolean }) {
  const [missing, setMissing] = useState(false);
  const photo = (
    <span className="relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-raised ring-1 ring-line" style={{ width: size, height: size }} aria-hidden>
      {missing ? (
        <span className="font-semibold text-ink-2" style={{ fontSize: Math.max(10, Math.round(size * 0.36)) }}>
          {initials(name)}
        </span>
      ) : (
        <Image
          src={headshotUrl(league, id)}
          alt=""
          width={size}
          height={size}
          loading={eager ? 'eager' : 'lazy'}
          fetchPriority={eager ? 'high' : 'auto'}
          className="h-full w-full object-cover object-top"
          onError={() => setMissing(true)}
        />
      )}
    </span>
  );
  if (!ring) return photo;
  return (
    <span className="inline-flex shrink-0 rounded-full p-[2px]" style={{ background: `linear-gradient(140deg, ${ring}, ${ring}33 80%)` }} aria-hidden>
      {photo}
    </span>
  );
}
