import { ArrowRight } from 'lucide-react';
import Link from 'next/link';
import type { FantasyCard } from '../../lib/model/startSitWeek';
import { Section } from './Section';

const signed = (n: number) => `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(1)}`;

/** An NFL player's fantasy week on his page: what he's projected, its likely range, where that ranks, and the start/sit call. */
export function FantasyCardBox({ card }: { card: FantasyCard }) {
  const { row, verdict, gap } = card;
  return (
    <Section
      id="fantasy"
      title={`Fantasy this week${card.week ? `: week ${card.week}` : ''}`}
      subtitle={`PPR points if he plays, ${row.home ? 'vs' : '@'} ${row.opponent}, from the same model as our fantasy rankings.`}
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-xl bg-raised/60 p-4 ring-1 ring-line">
          <p className="text-xs uppercase tracking-wider text-ink-3">Projected</p>
          <p className="mt-1 font-display text-3xl font-bold text-ink tabular">{card.points.toFixed(1)}</p>
          <p className="mt-1 text-xs text-ink-3 tabular">
            likely {card.range[0].toFixed(1)}–{card.range[1].toFixed(1)}
          </p>
        </div>
        <div className="rounded-xl bg-raised/60 p-4 ring-1 ring-line">
          <p className="text-xs uppercase tracking-wider text-ink-3">This week</p>
          <p className="mt-1 font-display text-3xl font-bold text-ink tabular">
            #{card.weekRank} <span className="text-lg font-semibold text-ink-2">{row.position}</span>
          </p>
          <p className="mt-1 text-xs text-ink-3">{card.seasonRank ? `#${card.seasonRank} by season average` : 'Too few games for a season rank'}</p>
        </div>
        <div className="rounded-xl bg-raised/60 p-4 ring-1 ring-line">
          <p className="text-xs uppercase tracking-wider text-ink-3">Usually</p>
          <p className="mt-1 font-display text-3xl font-bold text-ink tabular">{card.average !== null ? card.average.toFixed(1) : '—'}</p>
          <p className="mt-1 text-xs text-ink-3 tabular">
            {card.average !== null ? `a game this season${card.recent !== null ? ` · ${card.recent.toFixed(1)} over his last 3` : ''}` : 'No games this season yet'}
          </p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm">
          {verdict === 'start' ? (
            <span className="font-semibold text-good">On this week&apos;s start list: projected {signed(gap!)} on his usual.</span>
          ) : verdict === 'sit' ? (
            <span className="font-semibold text-bad">On this week&apos;s sit list: projected {signed(gap!)} on his usual.</span>
          ) : (
            <span className="text-ink-2">
              Not on this week&apos;s start or sit list{gap !== null ? ` (projected ${signed(gap)} on his usual)` : ''}.
            </span>
          )}
          {row.status && <span className="ml-2 rounded-md bg-bad/15 px-1.5 py-0.5 text-xs font-semibold text-bad">{row.status}</span>}
        </p>
        <span className="flex flex-wrap gap-2">
          <Link
            href={`/nfl/start-sit?a=${row.id}#picker`}
            rel="nofollow"
            className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-on-accent transition hover:brightness-110"
          >
            Compare him with anyone <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
          <Link href="/nfl/fantasy" className="inline-flex items-center rounded-lg px-3 py-1.5 text-sm font-medium text-ink-2 ring-1 ring-line transition hover:bg-raised hover:text-ink">
            All rankings
          </Link>
        </span>
      </div>
      <p className="mt-3 text-xs text-ink-3">
        Half of real scores land inside the likely range: one game is noisy, so treat this as a tiebreaker, not a verdict. See{' '}
        <Link href="/nfl/start-sit" className="underline underline-offset-2">
          this week&apos;s start &apos;em, sit &apos;em
        </Link>
        .
      </p>
    </Section>
  );
}
