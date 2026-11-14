import { ArrowRight, Check } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { pct } from '../../../lib/format';
import { formatAmerican } from '../../../lib/model/market';
import { boutEnding, type UfcBout, type UfcEvent, type UfcFighter } from '../../../lib/ufc/feed';
import { calledIt, cardSpot, shownChance, weightName, type UfcModel } from '../../../lib/ufc/model';
import { LiveDot, ResultBadge } from '../Badges';
import { ChanceBar } from '../ChanceBar';
import { PlayerPhoto } from '../PlayerPhoto';

export const rating = (value: number) => Math.round(value).toLocaleString('en-US');

const yearDate = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', year: 'numeric' });
/** A past fight's date with its year ("Feb 25, 2023"), US Eastern like the rest of the site. */
export const fightDate = (iso: string) => (iso ? yearDate.format(new Date(iso)) : '—');

/** A fighter's country flag from ESPN, with the country named for screen readers and on hover. */
export function Flag({ fighter, size = 16 }: { fighter: Pick<UfcFighter, 'flag' | 'country'>; size?: number }) {
  if (!fighter.flag) return null;
  return <Image src={fighter.flag} alt={fighter.country ?? ''} title={fighter.country ?? undefined} width={size} height={size} className="inline-block shrink-0 rounded-sm object-contain" />;
}

/** "Rating 1,629 · #1 Heavyweight", or "UFC debut". */
export function fighterMeta(model: UfcModel, id: string) {
  const f = model.fighters.get(id);
  if (!f || f.fights === 0) return 'UFC debut';
  const record = `${f.wins}-${f.losses}${f.draws ? `-${f.draws}` : ''} UFC`;
  return [`${record}`, `rating ${rating(f.rating)}`, f.rank && f.division ? `#${f.rank} ${f.division}` : null].filter(Boolean).join(' · ');
}

function FighterLine({ model, bout, side, chance, odds }: { model: UfcModel; bout: UfcBout; side: UfcFighter; chance: number; odds: number | null }) {
  const lost = bout.completed && side.winner === false && (bout.a.winner || bout.b.winner);
  return (
    <div className={`flex items-center gap-3 ${lost ? 'opacity-60' : ''}`}>
      <PlayerPhoto league="mma" id={side.id} name={side.name} size={40} />
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 font-semibold text-ink">
          <Link href={`/ufc/fighter/${side.id}`} className="truncate hover:text-accent-strong">
            {side.name}
          </Link>
          <Flag fighter={side} size={14} />
          {side.winner === true && (
            <span className="inline-flex items-center gap-0.5 rounded-full bg-good/15 px-1.5 text-[11px] font-semibold text-good">
              <Check className="h-3 w-3" aria-hidden />
              Won
            </span>
          )}
        </p>
        <p className="truncate text-xs text-ink-3">{fighterMeta(model, side.id)}</p>
      </div>
      <div className="text-right">
        <p className={`font-display text-lg font-semibold tabular ${chance >= 0.5 ? 'text-ink' : 'text-ink-2'}`}>{pct(chance)}</p>
        <ChanceBar chance={chance} />
        {odds !== null && <p className="mt-0.5 text-[11px] text-ink-3 tabular">{formatAmerican(odds)}</p>}
      </div>
    </div>
  );
}

/** One fight: both fighters with their chance (and the line), the result once it's over, and a way to the full breakdown. */
export function BoutCard({ model, bout, event }: { model: UfcModel; bout: UfcBout; event: UfcEvent }) {
  const { chanceA, fromMarket, locked } = shownChance(model, bout.id);
  const forecast = model.forecasts.get(bout.id);
  const spot = cardSpot(bout, event);
  const ending = boutEnding(bout);
  const correct = calledIt(bout, chanceA);
  return (
    <article className={`card relative overflow-hidden p-4 ${bout.state === 'in' ? 'ring-1 ring-bad/40' : ''}`} aria-label={`${bout.a.name} vs ${bout.b.name}`}>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <p className="flex flex-wrap items-center gap-x-2 text-ink-3">
          {spot && <span className="font-semibold uppercase tracking-wider text-accent-strong">{spot}</span>}
          <span>{weightName(bout.weightClass) ?? 'Fight'}</span>
          <span aria-hidden>·</span>
          <span>{bout.rounds} rounds</span>
        </p>
        {bout.state === 'in' ? <LiveDot label={bout.round ? `Live · round ${bout.round}` : 'Live'} /> : ending ? <span className="text-ink-2">{ending}</span> : null}
      </div>
      <div className="mt-3 space-y-3">
        <FighterLine model={model} bout={bout} side={bout.a} chance={chanceA} odds={forecast?.odds?.aMoneyline ?? null} />
        <FighterLine model={model} bout={bout} side={bout.b} chance={1 - chanceA} odds={forecast?.odds?.bMoneyline ?? null} />
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3 text-xs text-ink-3">
        <span>
          {fromMarket ? 'Betting market, margin removed' : 'Ratings only: no betting line'}
          {locked && bout.state !== 'pre' ? ' · locked before the fight' : ''}
        </span>
        <span className="flex items-center gap-2">
          <ResultBadge correct={correct} />
          <Link href={`/ufc/fight/${bout.id}`} className="inline-flex items-center gap-1 font-semibold text-accent-strong hover:underline">
            Breakdown <ArrowRight className="h-3 w-3" aria-hidden />
          </Link>
        </span>
      </div>
    </article>
  );
}

/** A card's fights, main event first. */
export const mainFirst = (event: UfcEvent) => [...event.bouts].sort((x, y) => y.order - x.order);

/** How the forecasts did on a finished card: "11 of 13 right". */
export function cardRecord(model: UfcModel, event: UfcEvent) {
  let right = 0;
  let graded = 0;
  for (const b of event.bouts) {
    const c = calledIt(b, shownChance(model, b.id).chanceA);
    if (c === null) continue;
    graded += 1;
    if (c) right += 1;
  }
  return { right, graded };
}

/** The main event's two names, for headings: "Gane vs. Hokit". */
export function mainEventName(event: UfcEvent) {
  const main = mainFirst(event)[0];
  return main ? `${main.a.name} vs. ${main.b.name}` : event.name;
}
