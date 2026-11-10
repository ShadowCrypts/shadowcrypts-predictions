'use client';

import { Activity, Check, Clock, Minus, X } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { pct } from '../../lib/format';
import { LegResult, legId, LegState } from '../../lib/legs';
import { formatAmerican } from '../../lib/model/market';
import { decimalFromAmerican, liveLegChance, liveParlayChance, settle } from '../../lib/parlay';
import { formatDay } from '../../lib/time';
import { AlertSettings } from './AlertSettings';
import { TrackedParlay, useParlayLog } from './parlayLog';
import { EmptyState, StatTile } from './Section';
import { SweatChart } from './SweatChart';
import { useLiveLegs } from './useLiveLegs';

const units = (x: number) => `${x >= 0 ? '+' : '−'}${Math.abs(x).toFixed(2)}`;

function LegMark({ state, decided }: { state: LegState; decided: 'won' | 'lost' | null }) {
  const icon = 'mt-0.5 h-4 w-4 shrink-0';
  if (state === 'won' || decided === 'won') return <Check className={`${icon} text-good`} aria-label={state === 'won' ? 'Hit' : 'Cleared its line'} />;
  if (state === 'lost' || decided === 'lost') return <X className={`${icon} text-bad`} aria-label={state === 'lost' ? 'Missed' : 'Past its line'} />;
  if (state === 'pending') return <Clock className={`${icon} text-ink-3`} aria-label="Not final yet" />;
  return <Minus className={`${icon} text-ink-3`} aria-label={state === 'push' ? 'Push' : 'Void'} />;
}

const STATE_LABEL: Record<LegState, string> = { won: 'Cashed', lost: 'Lost', pending: 'Open', push: 'Push', void: 'Void' };

/** What a leg in a game that's on shows: the stat so far and its chance to hit now, or a team's live chance, and where the game is. */
function liveNote(r: LegResult, chance: number | null | undefined) {
  if (!r.live) return null;
  const decided = r.live.decided === 'won' ? ' · cleared' : r.live.decided === 'lost' ? ' · past the line' : '';
  if (r.actual === null && r.live.chance !== null) return `${pct(r.live.chance)} to win now · ${r.live.status}`;
  const so = r.actual !== null ? `${r.actual} so far` : 'hasn’t played yet';
  const odds = !r.live.decided && r.actual !== null && chance !== null && chance !== undefined ? ` · ${pct(chance)} to hit` : '';
  return `${so}${decided}${odds} · ${r.live.status}`;
}

function ParlayCard({ parlay, live, started, onRemove }: { parlay: TrackedParlay; live: Record<string, LegResult>; started: boolean; onRemove: () => void }) {
  const [sweat, setSweat] = useState(false);
  const results: Record<string, LegResult | undefined> = parlay.results;
  const finals = Object.fromEntries(parlay.legs.map((l) => [l.key, results[l.key]?.state]));
  const { state, profit } = settle(parlay.legs, parlay.price, finals);
  // While games are on: legs already decided, from the box score so far, and the chance to cash now.
  const current = Object.fromEntries(parlay.legs.map((l) => [l.key, results[l.key] ? undefined : live[legId(l) ?? '']]));
  const now = parlay.legs.map((l) => current[l.key]?.live ?? null);
  const cashChance = state === 'pending' ? liveParlayChance(parlay.legs, finals, current) : null;
  const busted = state === 'pending' && now.some((x) => x?.decided === 'lost');
  const playing = state === 'pending' && now.some((x) => x !== null);
  const cleared = parlay.legs.filter((l, i) => results[l.key]?.state === 'won' || now[i]?.decided === 'won').length;
  const label = busted ? 'Busted' : playing ? `Live · ${cleared} of ${parlay.legs.length} in` : STATE_LABEL[state];
  const tone =
    state === 'won' ? 'bg-good/15 text-good' : state === 'lost' || busted ? 'bg-bad/15 text-bad' : playing ? 'bg-accent/15 text-accent-strong' : 'bg-raised text-ink-3 ring-1 ring-line';
  return (
    <li className="card p-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-3">
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${tone}`} title={busted ? 'A leg is already past its line; graded for good once the game is final' : undefined}>
          {label}
        </span>
        <span>Saved {formatDay(parlay.savedAt)}</span>
        <span className="tabular">
          {parlay.legs.length} legs · {pct(parlay.chance, parlay.chance < 0.1 ? 1 : 0)} to hit
          {parlay.price !== null && ` · ${formatAmerican(parlay.price)}`}
        </span>
        {profit !== null && (
          <span className={`font-semibold tabular ${profit > 0 ? 'text-good' : profit < 0 ? 'text-bad' : 'text-ink-3'}`}>{units(profit)} units</span>
        )}
        <button type="button" onClick={onRemove} className="ml-auto rounded-lg p-1 hover:bg-raised hover:text-ink" aria-label="Stop tracking this parlay">
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>
      {playing && !busted && (
        <p className="mt-2 rounded-lg bg-raised px-3 py-2 text-sm text-ink-2 ring-1 ring-line">
          {cashChance !== null ? (
            <>
              Chance to cash now <span className="font-semibold tabular text-ink">{pct(cashChance, cashChance < 0.1 ? 1 : 0)}</span>
              {parlay.price !== null && (
                <>
                  {' '}
                  · worth about <span className="font-semibold tabular text-ink">${(cashChance * decimalFromAmerican(parlay.price)).toFixed(2)}</span> per $1 staked
                  at {formatAmerican(parlay.price)}. Cash-out offers usually come in below this; the gap is the book&apos;s cut, or a
                  different read on the game.
                </>
              )}
            </>
          ) : (
            'A live chance can’t be worked out for one of these legs yet, so for now it’s the stats so far.'
          )}
        </p>
      )}
      <ul className="mt-2 space-y-1.5">
        {parlay.legs.map((l) => {
          const r = results[l.key];
          const running = r ? null : live[legId(l) ?? ''];
          const note = running ? liveNote(running, liveLegChance(l, running)) : null;
          return (
            <li key={l.key} className="flex items-start gap-2 text-sm">
              <LegMark state={r?.state ?? 'pending'} decided={running?.live?.decided ?? null} />
              <span className="min-w-0 flex-1 text-ink-2">
                {l.label}{' '}
                <Link href={`/${l.league}/game/${l.gameId}`} className="text-xs text-ink-3 hover:text-ink hover:underline">
                  {l.game}
                </Link>
                {note && <span className="block text-xs font-medium tabular text-accent-strong">{note}</span>}
              </span>
              {r?.actual !== null && r?.actual !== undefined && <span className="shrink-0 text-xs font-semibold tabular text-ink">{r.actual}</span>}
              {r && (r.state === 'push' || r.state === 'void') && <span className="shrink-0 text-xs text-ink-3">{r.state === 'push' ? 'push' : 'didn’t play'}</span>}
            </li>
          );
        })}
      </ul>
      {started && (
        <div className="mt-3 border-t border-line/60 pt-2">
          <button
            type="button"
            onClick={() => setSweat((s) => !s)}
            aria-expanded={sweat}
            className="inline-flex items-center gap-1 text-xs font-semibold text-accent-strong hover:underline"
          >
            <Activity className="h-3.5 w-3.5" aria-hidden />
            {sweat ? 'Hide the sweat' : state === 'pending' ? 'Show the sweat' : 'Replay the sweat'}
          </button>
          {sweat && (
            <div className="mt-2">
              <SweatChart parlay={parlay} />
            </div>
          )}
        </div>
      )}
    </li>
  );
}

/**
 * Parlays you saved, graded as their games end: each leg from the final box
 * score, and your record next to what the chances said to expect.
 */
export function TrackedParlays() {
  const { log, remove, record } = useParlayLog();
  // The latest answer for legs still open, by leg id: what games in progress show.
  const { live, now } = useLiveLegs(log, record);

  const settled = log
    .map((p) => ({ p, ...settle(p.legs, p.price, Object.fromEntries(p.legs.map((l) => [l.key, p.results[l.key]?.state]))) }))
    .filter((x) => x.state === 'won' || x.state === 'lost');
  const cashed = settled.filter((x) => x.state === 'won').length;
  const expected = settled.reduce((s, x) => s + x.p.chance, 0);
  const expectedIndependent = settled.reduce((s, x) => s + x.p.independent, 0);
  const priced = settled.filter((x) => x.profit !== null);
  const profit = priced.reduce((s, x) => s + x.profit!, 0);
  const open = log.length - settled.length;

  return (
    <section aria-labelledby="tracked-title" className="space-y-4">
      <div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="tracked-title" className="font-display text-lg font-semibold text-ink sm:text-xl">
            Your tracked parlays
          </h2>
          <AlertSettings compact />
        </div>
        <p className="mt-1 text-sm text-ink-2">
          While a game is on, each leg shows its stat so far and its chance to hit, updated every minute; once it&apos;s final, the leg is
          graded from the box score. Open the sweat to replay a parlay&apos;s chance to cash play by play. Saved in this browser only.
        </p>
      </div>
      {log.length ? (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile label="Cashed" value={settled.length ? `${cashed} of ${settled.length}` : '—'} sub={open ? `${open} still open` : 'All settled'} />
            <StatTile
              label="Chances said"
              value={settled.length ? expected.toFixed(1) : '—'}
              sub={settled.length ? `${expectedIndependent.toFixed(1)} if every leg were independent` : 'Expected cashes, once settled'}
            />
            <StatTile label="Units" value={priced.length ? units(profit) : '—'} sub={priced.length ? `1 unit a parlay, ${priced.length} with a price` : 'At the saved prices'} />
            <StatTile label="Hit rate" value={settled.length ? pct(cashed / settled.length) : '—'} sub={settled.length ? `${pct(expected / settled.length)} expected` : 'Once settled'} />
          </div>
          <ul className="space-y-3">
            {log.map((p) => (
              <ParlayCard key={p.id} parlay={p} live={live} started={now > 0 && p.legs.some((l) => Date.parse(l.start) <= now)} onRemove={() => remove(p.id)} />
            ))}
          </ul>
        </>
      ) : (
        <EmptyState>Track a parlay above and it&apos;s graded here once its games end, next to the chance it had.</EmptyState>
      )}
    </section>
  );
}
