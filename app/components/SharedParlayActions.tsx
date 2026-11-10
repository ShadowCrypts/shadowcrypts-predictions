'use client';

import { Check, ListPlus, Replace } from 'lucide-react';
import { useRouter } from 'next/navigation';
import type { SharedLeg } from '../../lib/model/sharedParlay';
import { useParlay } from './parlay';

/** Puts a shared parlay's legs in your builder: in place of yours, or added to them (a leg on the same bet as one you have replaces it). */
export function SharedParlayActions({ legs }: { legs: SharedLeg[] }) {
  const router = useRouter();
  const { legs: mine, replace } = useParlay();
  const have = new Set(mine.map((l) => l.key));
  const all = legs.every((l) => have.has(l.key));
  const groups = new Set(legs.map((l) => l.group));
  return (
    <div className="flex flex-wrap gap-2">
      <button
        type="button"
        onClick={() => {
          replace(legs);
          router.push('/parlay');
        }}
        className="inline-flex items-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-on-accent transition hover:brightness-110"
      >
        {all ? <Check className="h-4 w-4" aria-hidden /> : <Replace className="h-4 w-4" aria-hidden />}
        {all ? 'In your parlay' : 'Load into my parlay'}
      </button>
      {mine.length > 0 && !all && (
        <button
          type="button"
          onClick={() => {
            replace([...mine.filter((l) => !groups.has(l.group)), ...legs]);
            router.push('/parlay');
          }}
          className="inline-flex items-center gap-2 rounded-xl bg-raised px-4 py-2.5 text-sm font-semibold text-ink ring-1 ring-line transition hover:bg-line"
        >
          <ListPlus className="h-4 w-4" aria-hidden />
          Add to my {mine.length} {mine.length === 1 ? 'leg' : 'legs'}
        </button>
      )}
    </div>
  );
}
