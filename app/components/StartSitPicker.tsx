'use client';

import Link from 'next/link';
import { useState } from 'react';
import { pct } from '../../lib/format';
import { startSit, type FantasyLine, type FantasyPosition } from '../../lib/model/fantasy';

export type PickerPlayer = { id: string; name: string; position: FantasyPosition; team: string; opponent: string; home: boolean; points: number; available: number; status: string | null; projected: FantasyLine };

const POSITIONS: FantasyPosition[] = ['QB', 'RB', 'WR', 'TE'];
const select = 'w-full rounded-lg bg-surface px-3 py-2 text-sm text-ink ring-1 ring-line focus:outline-none focus:ring-accent';

function PlayerSelect({ id, label, players, value, onChange }: { id: string; label: string; players: PickerPlayer[]; value: string; onChange: (id: string) => void }) {
  return (
    <div>
      <label htmlFor={id} className="text-xs text-ink-3">
        {label}
      </label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)} className={`${select} mt-1`}>
        <option value="">Choose a player…</option>
        {POSITIONS.map((pos) => (
          <optgroup key={pos} label={pos}>
            {players
              .filter((p) => p.position === pos)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.team} {p.home ? 'vs' : '@'} {p.opponent}) {p.points.toFixed(1)}
                </option>
              ))}
          </optgroup>
        ))}
      </select>
    </div>
  );
}

/**
 * Who should I start? Two players this week, and how often the one projected higher outscored the other when
 * they were this far apart (the start/sit backtest: about 890,000 pairs since 2023, both playing).
 */
export function StartSitPicker({ players, initial }: { players: PickerPlayer[]; initial?: string }) {
  const [left, setLeft] = useState(initial ?? '');
  const [right, setRight] = useState('');
  const a = players.find((p) => p.id === left);
  const b = players.find((p) => p.id === right);
  const result = a && b && a.id !== b.id ? startSit(a.projected, a.position, b.projected, b.position) : null;
  const pick = result ? (result.favorite === 'left' ? a! : b!) : null;
  const other = result ? (result.favorite === 'left' ? b! : a!) : null;
  const doubtful = [a, b].filter((p): p is PickerPlayer => !!p && (p.available < 0.75 || !!p.status));
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <PlayerSelect id="start-left" label="Player 1" players={players} value={left} onChange={setLeft} />
        <PlayerSelect id="start-right" label="Player 2" players={players} value={right} onChange={setRight} />
      </div>
      <div className="min-h-16 rounded-xl bg-raised/60 p-4 ring-1 ring-line" role="status" aria-live="polite">
        {pick && other && result ? (
          <div className="space-y-1.5">
            <p className="font-display text-lg font-semibold text-ink">
              Start{' '}
              <Link href={`/nfl/player/${pick.id}`} className="text-accent-strong hover:underline">
                {pick.name}
              </Link>
            </p>
            <p className="text-sm text-ink-2">
              Projected {pick.points.toFixed(1)} PPR points against {other.points.toFixed(1)} for {other.name}: {result.gap.toFixed(1)} apart. When two players&apos;
              projections were that far apart, the higher one scored more <span className="font-semibold text-ink">{pct(result.chance)}</span> of the time.
            </p>
            {result.chance < 0.6 && <p className="text-sm text-ink-3">That&apos;s close to a coin flip: go with your gut, or the better matchup on paper.</p>}
            {doubtful.map((p) => (
              <p key={p.id} className="text-sm text-bad">
                {p.name} is {p.status ? `listed ${p.status.toLowerCase()}` : 'in doubt'} ({pct(p.available)} to play). The comparison assumes both play.
              </p>
            ))}
          </div>
        ) : a && b && a.id === b.id ? (
          <p className="text-sm text-ink-3">Pick two different players.</p>
        ) : (
          <p className="text-sm text-ink-3">Choose two players to see who to start, and how often that call has come out right.</p>
        )}
      </div>
    </div>
  );
}
