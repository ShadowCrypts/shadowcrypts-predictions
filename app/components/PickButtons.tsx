'use client';

import { Check, Lock } from 'lucide-react';
import { counts, pickKey, usePicks } from './picks';
import { TeamLogo } from './TeamLogo';

type Side = { abbr: string; shortName: string; logo: string | null; record?: string | null; color?: string };

/**
 * "Your pick" for one game: two buttons before the start, then your locked
 * pick, and once it's final, whether you and the model called it.
 */
export function PickButtons({
  league,
  gameId,
  start,
  state,
  away,
  home,
  winner,
  modelPick,
  compact = false
}: {
  league: string;
  gameId: string;
  start: string;
  state: 'pre' | 'in' | 'post';
  away: Side;
  home: Side;
  /** Set once the game is final (null for a tie). */
  winner?: 'home' | 'away' | null;
  modelPick: 'home' | 'away';
  compact?: boolean;
}) {
  const { picks, choose } = usePicks();
  const key = pickKey(league, gameId);
  const pick = picks[key];
  const open = state === 'pre' && Date.now() < Date.parse(start);
  const valid = counts(pick, start);

  if (!open) {
    if (!valid) return compact ? null : <p className="text-center text-xs text-ink-3">You didn&apos;t pick this one.</p>;
    const yours = pick!.side === 'home' ? home : away;
    const result = winner === undefined || winner === null ? null : pick!.side === winner;
    return (
      <p className={`flex items-center justify-center gap-1.5 text-xs ${compact ? '' : 'mt-1'}`}>
        <Lock className="h-3 w-3 text-ink-3" aria-hidden />
        <span className="text-ink-2">
          Your pick: <span className="font-semibold text-ink">{yours.abbr}</span>
        </span>
        {result !== null && (
          <span className={`font-semibold ${result ? 'text-good' : 'text-bad'}`}>
            {result ? 'Hit' : 'Miss'}
            {pick!.side !== modelPick && <span className="font-normal text-ink-3"> · you went against the model</span>}
          </span>
        )}
      </p>
    );
  }

  const button = (side: 'home' | 'away', team: Side) => {
    const chosen = pick?.side === side;
    // The chosen side fills with its team's color (text stays the page's ink, so it reads on any team color).
    const tinted = chosen && team.color;
    return (
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          choose(key, side, start);
        }}
        aria-pressed={chosen}
        className={`relative flex min-w-0 flex-1 items-center gap-2.5 rounded-xl px-3 text-left font-semibold transition active:scale-[0.98] ${compact ? 'py-2 text-sm' : 'justify-center py-2.5 text-sm'} ${
          tinted ? 'text-ink' : chosen ? 'bg-accent text-on-accent ring-1 ring-accent' : 'bg-raised text-ink ring-1 ring-line hover:ring-line-strong'
        }`}
        style={tinted ? { background: `linear-gradient(135deg, ${team.color}59, ${team.color}1f)`, boxShadow: `inset 0 0 0 1.5px ${team.color}, 0 8px 24px -12px ${team.color}` } : undefined}
      >
        <TeamLogo src={team.logo} abbr={team.abbr} size={compact ? 28 : 20} />
        <span className="min-w-0">
          <span className="block truncate">{team.shortName}</span>
          {compact && team.record && <span className="block text-[11px] font-normal text-ink-3 tabular">{team.record}</span>}
        </span>
        {chosen && (
          <span
            className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${compact ? 'ml-auto' : ''} ${tinted ? 'bg-ink text-surface' : ''}`}
          >
            <Check className="h-3.5 w-3.5" aria-hidden />
          </span>
        )}
      </button>
    );
  };

  return (
    <div>
      {!compact && <p className="mb-2 text-center text-xs font-medium uppercase tracking-wider text-ink-3">Your pick</p>}
      <div className="flex gap-2" role="group" aria-label={`Your pick: ${away.abbr} or ${home.abbr}`}>
        {button('away', away)}
        {button('home', home)}
      </div>
    </div>
  );
}
