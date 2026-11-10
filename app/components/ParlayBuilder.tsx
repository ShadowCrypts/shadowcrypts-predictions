'use client';

import { AlertTriangle, BookmarkPlus, Check, Link2, Trash2, Trophy, X } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { pct } from '../../lib/format';
import { legId } from '../../lib/legs';
import { allHitChance } from '../../lib/model/correlation';
import { CORRELATIONS } from '../../lib/model/correlationTable';
import { formatAmerican } from '../../lib/model/market';
import { isAmerican, shareCode, summarize } from '../../lib/parlay';
import { ChanceBar } from './ChanceBar';
import { ChanceRing } from './ChanceRing';
import { LocalTime } from './LocalTime';
import { PlayerPhoto } from './PlayerPhoto';
import { ShareButton } from './ShareButton';
import { ParlayLeg, useParlay } from './parlay';
import { useParlayLog } from './parlayLog';
import { useNow } from './useNow';

function Figure({ label, value, sub, tone, wide = false }: { label: string; value: string; sub?: string; tone?: string; wide?: boolean }) {
  return (
    <div className={`rounded-xl bg-raised p-3 ring-1 ring-line ${wide ? 'col-span-2' : ''}`}>
      <p className="text-xs text-ink-3">{label}</p>
      <p className={`mt-1 font-display text-xl font-semibold tabular ${tone ?? 'text-ink'}`}>{value}</p>
      {sub && <p className="text-xs text-ink-3">{sub}</p>}
    </div>
  );
}

const chanceLabel = (p: number) => pct(p, p < 0.1 ? 1 : 0);

/** How a game's legs relate, told from their chance together against multiplying. */
function together(chance: number, independent: number) {
  const ratio = chance / Math.max(independent, 1e-9);
  if (ratio >= 1.05) return 'they tend to hit together';
  if (ratio <= 0.95) return 'they pull against each other';
  return 'they barely move together';
}

/**
 * Your parlay: every leg must win. Each leg's chance is the book's own number
 * with its margin removed, the most accurate number we have for it. Legs from
 * different games multiply; legs from one game move together, by how such legs
 * have moved together in past games, so their chance is figured jointly.
 */
export function ParlayBuilder() {
  const { legs, remove, clear } = useParlay();
  const { log, save } = useParlayLog();
  const [offeredText, setOfferedText] = useState('');
  const offeredValue = Number(offeredText.trim().replace(/^\+/, ''));
  const offered = offeredText.trim() && isAmerican(offeredValue) ? offeredValue : null;
  const summary = useMemo(() => summarize(legs, offered), [legs, offered]);
  const games = useMemo(() => {
    const byGame = new Map<string, ParlayLeg[]>();
    for (const l of legs) byGame.set(`${l.league}:${l.gameId}`, [...(byGame.get(`${l.league}:${l.gameId}`) ?? []), l]);
    return [...byGame.entries()].map(([key, group]) => ({
      key,
      legs: group,
      chance: group.length > 1 ? allHitChance(group, CORRELATIONS) : group[0].prob,
      independent: group.reduce((p, l) => p * l.prob, 1),
      unlinked: group.length > 1 && group.some((l) => !l.link)
    }));
  }, [legs]);
  const now = useNow();
  const hasStarted = (start: string) => now > 0 && Date.parse(start) <= now;
  const started = legs.filter((l) => hasStarted(l.start));
  const trackable = legs.every((l) => legId(l) !== null);
  const signature = legs.map((l) => l.key).join('|');
  const tracked = log.some((p) => p.legs.map((l) => l.key).join('|') === signature);
  // A link that prices these legs fresh for whoever opens it (only legs that carry an id, as tracking needs).
  const code = trackable ? shareCode(legs, offered) : null;
  const shareLink = code ? `/parlay/s/${code}` : null;

  if (!legs.length || !summary) {
    const steps = [
      { title: 'Add legs', text: 'Player props from the props board, any game page or the search above; a team to win from any game with a line.' },
      { title: 'See the real chance', text: 'Each leg at the book’s number with its margin out, and legs from one game figured together.' },
      { title: 'Track it and sweat it', text: 'Graded from the box score, with a live chance to cash while the games are on.' }
    ];
    return (
      <div className="card relative overflow-hidden p-6 sm:p-8">
        <span className="pointer-events-none absolute -right-20 -top-24 h-64 w-64 rounded-full bg-accent/15 blur-3xl" aria-hidden />
        <div className="relative flex flex-col items-center gap-6 sm:flex-row sm:items-center sm:gap-8">
          <ChanceRing value={null} size={120} label="Chance to cash" />
          <div className="min-w-0 flex-1 text-center sm:text-left">
            <p className="font-display text-xl font-semibold text-ink">Your parlay is empty</p>
            <ol className="mt-4 grid gap-3 text-left sm:grid-cols-3">
              {steps.map((s, i) => (
                <li key={s.title} className="flex gap-3">
                  <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent/15 text-sm font-semibold text-accent-strong ring-1 ring-accent/30">
                    {i + 1}
                  </span>
                  <span>
                    <span className="block text-sm font-semibold text-ink">{s.title}</span>
                    <span className="block text-xs text-ink-2">{s.text}</span>
                  </span>
                </li>
              ))}
            </ol>
            <div className="mt-5 flex flex-wrap justify-center gap-2 sm:justify-start">
              <Link href="/props" className="rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-on-accent transition hover:brightness-110">
                Browse player props
              </Link>
              <Link href="/" className="rounded-xl bg-raised px-4 py-2 text-sm font-semibold text-ink ring-1 ring-line transition hover:bg-line">
                Today&apos;s games
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const loss = summary.expectedReturn;
  const fitted = [...new Set(legs.map((l) => l.league))].map((id) => CORRELATIONS[id]?.meta.games ?? 0).reduce((a, b) => a + b, 0);
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
      <section className="card p-4 sm:p-5" aria-labelledby="legs-title">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 id="legs-title" className="font-display text-lg font-semibold text-ink">
            {legs.length} {legs.length === 1 ? 'leg' : 'legs'}
          </h2>
          <button type="button" onClick={clear} className="inline-flex items-center gap-1.5 text-sm text-ink-3 hover:text-ink">
            <Trash2 className="h-4 w-4" aria-hidden /> Clear all
          </button>
        </div>
        <div className="space-y-4">
          {games.map((g) => (
            <div key={g.key}>
              <p className="text-xs text-ink-3">
                <Link href={`/${g.legs[0].league}/game/${g.legs[0].gameId}`} className="hover:text-ink hover:underline">
                  {g.legs[0].league.toUpperCase()} · {g.legs[0].game}
                </Link>{' '}
                · <LocalTime iso={g.legs[0].start} />
                {hasStarted(g.legs[0].start) && <span className="ml-1 font-semibold text-warn">· started</span>}
              </p>
              <ul className="divide-y divide-line">
                {g.legs.map((l) => (
                  <li key={l.key} className="flex items-center gap-3 py-2.5">
                    {l.link?.kind === 'prop' ? (
                      <PlayerPhoto league={l.league} id={l.link.playerId} name={l.label.split(/ (?:over|under) /)[0]} size={34} />
                    ) : (
                      <span className="inline-flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent-strong ring-1 ring-accent/30" aria-hidden>
                        <Trophy className="h-4 w-4" />
                      </span>
                    )}
                    <p className="min-w-0 flex-1 font-medium text-ink">{l.label}</p>
                    <div className="flex shrink-0 flex-col items-end tabular">
                      <p className="font-semibold text-ink">{pct(l.prob)}</p>
                      <ChanceBar chance={l.prob} />
                      <p className="mt-1 text-xs text-ink-3">{l.price !== null ? `${l.book ?? 'Book'} ${formatAmerican(l.price)}` : 'no price'}</p>
                    </div>
                    <button type="button" onClick={() => remove(l.key)} className="shrink-0 rounded-lg p-1 text-ink-3 hover:bg-raised hover:text-ink" aria-label={`Remove ${l.label}`}>
                      <X className="h-4 w-4" aria-hidden />
                    </button>
                  </li>
                ))}
              </ul>
              {g.legs.length > 1 && (
                <p className="mt-1 flex items-start gap-1.5 rounded-lg bg-raised px-2.5 py-1.5 text-xs text-ink-2 ring-1 ring-line">
                  <Link2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent-strong" aria-hidden />
                  <span>
                    Together <span className="font-semibold tabular text-ink">{chanceLabel(g.chance)}</span>, against{' '}
                    <span className="tabular">{chanceLabel(g.independent)}</span> from multiplying: {together(g.chance, g.independent)}.
                    {g.unlinked && ' Some of these legs were added before same-game math existed and count as independent; add them again to include them.'}
                  </span>
                </p>
              )}
            </div>
          ))}
        </div>
      </section>

      <aside className="space-y-4" aria-label="What this parlay is worth">
        <div className="card relative overflow-hidden p-4 sm:p-5">
          <span className="pointer-events-none absolute -left-16 -top-20 h-56 w-56 rounded-full bg-accent/15 blur-3xl" aria-hidden />
          <div className="relative space-y-3">
            <div className="flex items-center gap-4">
              <ChanceRing value={summary.chance} size={124} label="Chance every leg hits" decimals={summary.chance < 0.1 ? 1 : 0} />
              <div className="min-w-0">
                <p className="text-sm font-medium text-ink">Chance every leg hits</p>
                <p className="mt-0.5 text-xs text-ink-3">
                  {summary.sameGame && Math.abs(summary.chance - summary.independent) >= 0.001
                    ? `${chanceLabel(summary.independent)} if multiplied; same-game legs move together`
                    : `About 1 in ${Math.max(1, Math.round(1 / summary.chance))}`}
                </p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Figure label="Fair odds" value={formatAmerican(summary.fair)} sub="a break-even price" />
              <Figure
                label={summary.sameGame && offered === null ? 'Legs multiplied' : 'Book pays'}
                value={summary.price !== null ? formatAmerican(summary.price) : summary.multiplied ? formatAmerican(summary.multiplied.american) : '—'}
                sub={
                  offered !== null
                    ? 'the price you entered'
                    : summary.sameGame
                      ? 'not what books pay on same-game legs'
                      : summary.multiplied
                        ? 'each leg’s price multiplied'
                        : 'a leg has no price'
                }
              />
              <Figure
                label="Expected return"
                value={loss !== null ? `${loss >= 0 ? '+' : '−'}${Math.abs(loss * 100).toFixed(1)}%` : '—'}
                sub={loss !== null ? 'per $1 staked, on average' : 'enter the book’s price below'}
                tone={loss === null ? undefined : loss >= 0 ? 'text-good' : 'text-bad'}
                wide
              />
            </div>
            <label className="block text-sm text-ink-2">
              <span id="parlay-price-label" className="text-xs text-ink-3">
                {summary.sameGame ? 'The price your book offers for this same-game parlay' : 'A different price than the legs multiplied? (optional)'}
              </span>
              <input
                id="parlay-price"
                aria-labelledby="parlay-price-label"
                inputMode="numeric"
                value={offeredText}
                onChange={(e) => setOfferedText(e.target.value)}
                placeholder={summary.multiplied && !summary.sameGame ? formatAmerican(summary.multiplied.american) : 'e.g. +450'}
                className="mt-1 w-full rounded-lg bg-surface px-3 py-2 text-sm text-ink ring-1 ring-line placeholder:text-ink-3 focus:outline-none focus:ring-accent"
              />
              {offeredText.trim() && offered === null && <span className="mt-1 block text-xs text-bad">American odds, like +450 or −120.</span>}
            </label>
            <div className="flex items-stretch gap-2">
              <button
                type="button"
                disabled={!trackable || tracked}
                onClick={() => save({ legs, chance: summary.chance, independent: summary.independent, price: summary.price })}
                className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-on-accent transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {tracked ? <Check className="h-4 w-4" aria-hidden /> : <BookmarkPlus className="h-4 w-4" aria-hidden />}
                {tracked ? 'Tracking it below' : 'Track this parlay'}
              </button>
              {shareLink && <ShareButton title="My parlay" text={`${legs.length}-leg parlay, ${chanceLabel(summary.chance)} to cash`} url={shareLink} />}
            </div>
            {!trackable && <p className="text-xs text-ink-3">Some legs were added before tracking existed. Add them again to track this parlay.</p>}
            <p className="text-sm text-ink-2">
              Every leg&apos;s price carries the book&apos;s margin, and a parlay multiplies them: the more legs, the more you give up. Each
              leg&apos;s chance is the book&apos;s own number with that margin taken out, which beat our player model on every graded season.
            </p>
          </div>
        </div>
        {summary.sameGame && (
          <p className="flex gap-2 rounded-xl border border-warn/40 bg-warn/10 p-3 text-sm text-ink">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warn" aria-hidden />
            <span>
              Some legs share a game, and those move together: a big scoring night shows up in points and in points + rebounds + assists,
              and usually in a win. The chance above accounts for it from how such legs went in {fitted.toLocaleString()} past games, which
              was much closer to what happened on later games than multiplying. Books price same-game parlays themselves, usually with a
              bigger margin, so enter the price they offer.
            </span>
          </p>
        )}
        {started.length > 0 && (
          <p className="flex gap-2 rounded-xl border border-line p-3 text-sm text-ink-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-ink-3" aria-hidden />
            {started.length === 1 ? 'One leg is' : `${started.length} legs are`} from games that have started, so those prices are gone.
          </p>
        )}
        <p className="text-xs text-ink-3">Your parlay is saved in this browser only. For insight and fun, not betting advice.</p>
      </aside>
    </div>
  );
}
