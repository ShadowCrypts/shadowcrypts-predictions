'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { pct } from '../../lib/format';
import { CORRELATIONS } from '../../lib/model/correlationTable';
import { Outcome, Shift, shiftsGiven } from '../../lib/model/whatIf';
import { marketLabel, PropMarket } from '../../lib/props';

type Team = { id: string; abbr: string; name: string };
export type WhatIfRow = { id: string; name: string; teamId: string; lines: Partial<Record<PropMarket, { line: number; over: number }>> };

/** Shifts shown at once. */
const SHOWN = 10;

function ShiftList({ label, shifts }: { label: string; shifts: Shift[] }) {
  return (
    <ul className="divide-y divide-line/60" aria-label={label}>
      {shifts.map((s) => {
        const up = s.after > s.before;
        return (
          <li key={s.key} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
            <span className="min-w-0 flex-1 text-ink-2">{s.label}</span>
            <span className="tabular text-ink-3">{pct(s.before)}</span>
            <span className="text-ink-3" aria-hidden>
              →
            </span>
            <span className={`w-12 text-right font-semibold tabular ${up ? 'text-good' : 'text-bad'}`}>{pct(s.after)}</span>
            <span className="relative hidden h-1.5 w-24 overflow-hidden rounded-full bg-track sm:block" aria-hidden>
              <span
                className={`absolute top-0 h-full rounded-full ${up ? 'bg-good' : 'bg-bad'}`}
                style={{ left: `${(Math.min(s.before, s.after) * 100).toFixed(1)}%`, width: `${(Math.abs(s.after - s.before) * 100).toFixed(1)}%` }}
              />
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Pick something that might happen in this game (a player's over, a team
 * winning) and see how every other line's chance moves if it does, from the
 * correlations fitted on past games.
 */
export function WhatIf({ league, gameId, home, away, homeProb, rows }: { league: string; gameId: string; home: Team; away: Team; homeProb: number; rows: WhatIfRow[] }) {
  const outcomes = useMemo(() => {
    const teamOf = (teamId: string) => (teamId === home.id ? home : away);
    const wins: Outcome[] = [
      { key: `win:${away.id}`, label: `${away.name} win`, prob: 1 - homeProb, link: { kind: 'win', teamId: away.id } },
      { key: `win:${home.id}`, label: `${home.name} win`, prob: homeProb, link: { kind: 'win', teamId: home.id } }
    ];
    const props: Outcome[] = rows.flatMap((r) =>
      (Object.entries(r.lines) as [PropMarket, { line: number; over: number }][]).map(([market, l]) => ({
        key: `${r.id}:${market}`,
        label: `${r.name} (${teamOf(r.teamId).abbr}) over ${l.line} ${marketLabel(market).long}`,
        prob: l.over,
        link: { kind: 'prop' as const, playerId: r.id, teamId: r.teamId, market, side: 'over' as const }
      }))
    );
    return { wins, props, all: [...wins, ...props] };
  }, [rows, home, away, homeProb]);
  // Start from the first row's headline stat (the rows come busiest first): usually the game's star.
  const [chosen, setChosen] = useState(() => outcomes.props[0]?.key ?? outcomes.wins[1].key);
  const given = outcomes.all.find((o) => o.key === chosen) ?? outcomes.wins[1];
  const shifts = useMemo(() => shiftsGiven(league, gameId, given, outcomes.all, CORRELATIONS), [league, gameId, given, outcomes.all]);
  // His own other lines move with it almost by definition (points within points + assists); the rest of the game is the news.
  const self = given.link.kind === 'prop' ? given.link.playerId : null;
  const ownKey = (key: string) => self !== null && key.startsWith(`${self}:`);
  const moving = shifts.filter((s) => Math.abs(s.after - s.before) >= 0.005);
  const others = moving.filter((s) => !ownKey(s.key));
  const own = moving.filter((s) => ownKey(s.key));
  const fit = CORRELATIONS[league]?.meta;

  return (
    <div className="space-y-4">
      <label className="flex flex-col gap-1.5 text-sm text-ink-2 sm:flex-row sm:items-center sm:gap-3">
        <span className="shrink-0 font-medium text-ink">If this happens</span>
        <select
          value={given.key}
          onChange={(e) => setChosen(e.target.value)}
          className="min-w-0 flex-1 rounded-lg bg-surface px-3 py-2 text-sm text-ink ring-1 ring-line focus:outline-none focus:ring-accent"
        >
          <optgroup label="Result">
            {outcomes.wins.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label} ({pct(o.prob)})
              </option>
            ))}
          </optgroup>
          {rows.map((r) => (
            <optgroup key={r.id} label={r.name}>
              {outcomes.props
                .filter((o) => o.link.kind === 'prop' && o.link.playerId === r.id)
                .map((o) => (
                  <option key={o.key} value={o.key}>
                    {o.label} ({pct(o.prob)})
                  </option>
                ))}
            </optgroup>
          ))}
        </select>
      </label>

      {others.length ? (
        <ShiftList label={`What moves in the rest of the game if ${given.label}`} shifts={others.slice(0, SHOWN)} />
      ) : (
        <p className="text-sm text-ink-3">Nothing else in the game moves with that one.</p>
      )}
      {own.length > 0 && (
        <details className="group">
          <summary className="cursor-pointer text-sm font-medium text-ink-2 hover:text-ink">His other lines ({own.length})</summary>
          <div className="mt-2">
            <ShiftList label={`His other lines if ${given.label}`} shifts={own} />
          </div>
        </details>
      )}

      <p className="text-xs text-ink-3">
        What each chance becomes if it happens, from how players&apos; stats and results moved together
        {fit ? ` in ${fit.games.toLocaleString()} past games` : ' in past games'}, the same numbers behind same-game parlays (
        <Link href="/parlay" className="underline hover:text-ink">
          tested on games the fit never saw
        </Link>
        ). It says how things are linked, not that any of it will happen.
      </p>
    </div>
  );
}
