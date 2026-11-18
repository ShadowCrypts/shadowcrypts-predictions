import { ArrowRight } from 'lucide-react';
import Link from 'next/link';
import type { NbaFantasyCard } from '../../lib/model/nbaFantasyBoard';
import { formatDay } from '../../lib/time';
import { Section } from './Section';

const one = (n: number) => n.toFixed(1);

/** An NBA player's next game for fantasy on his page: the projection and its likely range, where it ranks, and his week. */
export function NbaFantasyCardBox({ card }: { card: NbaFantasyCard }) {
  const { row } = card;
  const p = row.projected;
  return (
    <Section id="fantasy" title="Fantasy outlook" subtitle={`Fantasy points if he plays, ${row.home ? 'vs' : '@'} ${row.opponent} on ${formatDay(row.start)}, from the same model as our fantasy rankings.`}>
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-xl bg-raised/60 p-4 ring-1 ring-line">
          <p className="text-xs uppercase tracking-wider text-ink-3">Projected</p>
          <p className="mt-1 font-display text-3xl font-bold text-ink tabular">{one(card.points)}</p>
          <p className="mt-1 text-xs text-ink-3 tabular">
            likely {one(card.range[0])}–{one(card.range[1])} · {one(p.pts)} pts, {one(p.reb)} reb, {one(p.ast)} ast
          </p>
        </div>
        <div className="rounded-xl bg-raised/60 p-4 ring-1 ring-line">
          <p className="text-xs uppercase tracking-wider text-ink-3">That night</p>
          <p className="mt-1 font-display text-3xl font-bold text-ink tabular">
            #{card.dayRank} <span className="text-lg font-semibold text-ink-2">of {card.dayPlayers}</span>
          </p>
          <p className="mt-1 text-xs text-ink-3">{card.seasonRank ? `#${card.seasonRank} in the league by season average` : 'Too few games for a season rank'}</p>
        </div>
        <div className="rounded-xl bg-raised/60 p-4 ring-1 ring-line">
          <p className="text-xs uppercase tracking-wider text-ink-3">Usually</p>
          <p className="mt-1 font-display text-3xl font-bold text-ink tabular">{card.average !== null ? one(card.average) : '—'}</p>
          <p className="mt-1 text-xs text-ink-3 tabular">
            {card.average !== null ? `a game this season${card.recent !== null ? ` · ${one(card.recent)} over his last 5` : ''}` : 'No games this season yet'}
          </p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-2">
          {row.weekLeft > 0 ? (
            <>
              <span className="font-semibold text-ink">{row.weekLeft}</span> {row.weekLeft === 1 ? 'game' : 'games'} left this week
            </>
          ) : (
            'No games left this week'
          )}
          , {row.nextWeek} next week.
          {row.status && <span className="ml-2 rounded-md bg-bad/15 px-1.5 py-0.5 text-xs font-semibold text-bad">{row.status}</span>}
        </p>
        <span className="flex flex-wrap gap-2">
          <Link href="/nba/fantasy" className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-on-accent transition hover:brightness-110">
            All fantasy rankings <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
          <Link href="/nba/fantasy#schedule" className="inline-flex items-center rounded-lg px-3 py-1.5 text-sm font-medium text-ink-2 ring-1 ring-line transition hover:bg-raised hover:text-ink">
            Games this week
          </Link>
        </span>
      </div>
      <p className="mt-3 text-xs text-ink-3">Scored the NBA&apos;s own way (FanDuel&apos;s too). Half of real scores land inside the likely range: one night is noisy, so treat this as a tiebreaker, not a verdict.</p>
    </Section>
  );
}
