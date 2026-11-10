'use client';

import { Check, Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { pct } from '../../lib/format';
import type { PropRow } from '../../lib/model/propBoard';
import { chanceAt, ladder, PropModelParams } from '../../lib/model/propModel';
import { marketLabel, PropMarket } from '../../lib/props';
import { ParlayLeg, useParlay } from './parlay';

type GameInfo = { league: string; id: string; label: string; start: string; state: 'pre' | 'in' | 'post' };

/** "25+" for the over at 24.5; "over 25" for a whole-number line, which can push. */
const overName = (at: number) => (Number.isInteger(at) ? `over ${at}` : `${at + 0.5}+`);

/**
 * Chances at any line for one player's next game: his main line and its
 * chance read as a whole distribution, the way alternate lines are priced.
 */
export function LineLadder({ row, game, spread }: { row: PropRow; game: GameInfo; spread: Pick<PropModelParams, 'dispersion' | 'lineSpread'> }) {
  const markets = (Object.keys(row.cells) as PropMarket[]).filter((m) => row.cells[m]?.line);
  const [market, setMarket] = useState<PropMarket | undefined>(markets[0]);
  const [custom, setCustom] = useState('');
  const { legs, toggle } = useParlay();
  const line = market ? row.cells[market]?.line : null;
  const chance = useMemo(() => (market && line ? chanceAt(spread, market, line.line, line.forecastOver) : null), [spread, market, line]);
  if (!market || !line || !chance) return null;

  const chosen = new Set(legs.map((l) => l.key));
  const open = game.state === 'pre';
  const long = marketLabel(market).long;
  const legFor = (at: number, side: 'over' | 'under'): ParlayLeg => {
    const group = `${game.league}:${game.id}:${row.id}:${market}`;
    const main = at === line.line;
    const p = chance(at);
    return {
      key: main ? `${group}:${side}` : `${group}:${side}@${at}`,
      group,
      league: game.league,
      gameId: game.id,
      game: game.label,
      start: game.start,
      label: `${row.name} ${side === 'over' ? (main ? `over ${at}` : overName(at)) : `under ${at}`} ${long}`,
      prob: side === 'over' ? p : 1 - p,
      price: main ? (side === 'over' ? line.over : line.under) : null,
      book: main ? line.book : null,
      link: { kind: 'prop', playerId: row.id, teamId: row.teamId, market, side },
      line: at
    };
  };
  const button = (at: number, side: 'over' | 'under') => {
    const leg = legFor(at, side);
    const active = chosen.has(leg.key);
    return (
      <button
        type="button"
        onClick={() => toggle(leg)}
        disabled={!open && !active}
        aria-pressed={active}
        title={active ? 'Remove from your parlay' : `Add ${side === 'over' ? overName(at) : `under ${at}`} to your parlay`}
        className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium tabular ring-1 transition disabled:cursor-not-allowed disabled:opacity-40 ${
          active ? 'bg-accent/15 text-ink ring-accent/60' : 'text-ink-2 ring-line hover:text-ink hover:ring-line-strong'
        }`}
      >
        {active ? <Check className="h-3 w-3" aria-hidden /> : <Plus className="h-3 w-3" aria-hidden />}
        {side === 'over' ? 'O' : 'U'}
      </button>
    );
  };

  const rows = [...new Set([...ladder(chance, line.line).map((k) => k - 0.5), line.line])].sort((a, b) => a - b);
  const customValue = Number(custom.trim());
  const customAt = custom.trim() && Number.isFinite(customValue) && customValue >= 0 && customValue <= line.line * 5 + 50 ? customValue : null;

  return (
    <div className="space-y-4">
      <div className="scrollbar-none -mx-1 flex gap-1.5 overflow-x-auto px-1" role="group" aria-label="Stat">
        {markets.map((m) => (
          <button key={m} type="button" onClick={() => setMarket(m)} aria-pressed={m === market} className={`chip shrink-0 ${m === market ? 'chip-active' : 'chip-idle'}`}>
            {marketLabel(m).short}
          </button>
        ))}
      </div>
      <ul className="space-y-1.5">
        {rows.map((at) => {
          const p = chance(at);
          const main = at === line.line;
          return (
            <li key={at} className={`flex items-center gap-3 rounded-lg px-2 py-1.5 ${main ? 'bg-raised ring-1 ring-line' : ''}`}>
              <span className="w-24 shrink-0 text-sm font-medium tabular text-ink">
                {main ? `Over ${at}` : overName(at)}
                {main && <span className="block text-[10px] font-normal text-ink-3">{line.book} line</span>}
              </span>
              <span className="relative h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-raised ring-1 ring-line" aria-hidden>
                <span className="absolute inset-y-0 left-0 rounded-full bg-accent" style={{ width: `${(p * 100).toFixed(1)}%` }} />
              </span>
              <span className="w-12 shrink-0 text-right text-sm font-semibold tabular text-ink">{pct(p)}</span>
              <span className="inline-flex shrink-0 gap-1">
                {button(at, 'over')}
                {button(at, 'under')}
              </span>
            </li>
          );
        })}
      </ul>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <label className="inline-flex items-center gap-2 text-ink-2">
          <span id="ladder-custom-label">Any line</span>
          <input
            id="ladder-custom"
            aria-labelledby="ladder-custom-label"
            inputMode="decimal"
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            placeholder={String(line.line + 5)}
            className="w-24 rounded-lg bg-surface px-3 py-1.5 text-sm text-ink ring-1 ring-line placeholder:text-ink-3 focus:outline-none focus:ring-accent"
          />
        </label>
        {customAt !== null && (
          <span className="inline-flex items-center gap-2 tabular text-ink-2">
            over <span className="font-semibold text-ink">{pct(chance(customAt))}</span> · under <span className="font-semibold text-ink">{pct(1 - chance(customAt))}</span>
            {button(customAt, 'over')}
            {button(customAt, 'under')}
          </span>
        )}
      </div>
      <p className="text-xs text-ink-3">
        Read off the book&apos;s line and its chance, with how much this stat usually spreads around it. Checked on later games the fit
        never saw: lines put at about 17% went over 15% of the time in the NBA, 16% in the NHL and 14% in the NFL (overs ran a little
        short in that stretch, main lines included), and where the book posted alternate lines of its own, its prices and these chances
        were about even. Alternate lines carry no price here: enter your book&apos;s price on the parlay page.
        {Number.isInteger(customAt ?? 0.5) && customAt !== null && ' A whole-number line can push; the chances leave pushes out.'}
      </p>
    </div>
  );
}
