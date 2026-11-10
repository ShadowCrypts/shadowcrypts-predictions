import type { Metadata } from 'next';
import Link from 'next/link';
import { ChevronLeft, ChevronRight, Target, TrendingUp, Zap } from 'lucide-react';
import { ordinal, pct } from '../../lib/format';
import { LEAGUE_IDS, LeagueId, LEAGUES } from '../../lib/leagues';
import { getAllModels } from '../../lib/model/all';
import type { CardData, CardSide } from '../../lib/model/card';
import { dayComeback, dayHighlights, DayResults, dayResults, gameDates, lastResultsDate } from '../../lib/model/results';
import { propPicksFor } from '../../lib/model/dayProps';
import { standouts } from '../../lib/model/standouts';
import { marketLabel } from '../../lib/props';
import { displayColor } from '../../lib/teamColor';
import { etDateKey, formatLongDay, isDateKey, relativeDayLabel } from '../../lib/time';
import { Board } from '../components/Board';
import { ChanceRing } from '../components/ChanceRing';
import { DatePicker } from '../components/DatePicker';
import { PlayerPhoto } from '../components/PlayerPhoto';
import { RecentDays } from '../components/RecentDays';
import { Standouts } from '../components/Standouts';
import { PageHeader } from '../components/Section';
import { TeamBadge, TeamGlow } from '../components/TeamColors';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Results',
  description: 'Every game on any date, with whether the forecast called it.'
};

const record = (t: { hits: number; misses: number }) => `${t.hits}–${t.misses}`;
const signedPct = (x: number) => `${x >= 0 ? '+' : '−'}${Math.abs(x * 100).toFixed(1)}%`;
/** Graded picks listed per league; the rest are in the tally. */
const PICKS_SHOWN = 8;
/** Game days in the strip of recent results. */
const RECENT_DAYS = 30;

type Describe = (card: CardData, winner: CardSide, loser: CardSide) => string;

function Highlight({ card, icon, tone, title, line, detail }: { card: CardData; icon: React.ReactNode; tone: string; title: string; line: Describe; detail: Describe }) {
  const homeWon = (card.home.score ?? 0) > (card.away.score ?? 0);
  const winner = homeWon ? card.home : card.away;
  const loser = homeWon ? card.away : card.home;
  return (
    <Link href={`/${card.league}/game/${card.id}`} className="card relative flex min-w-0 items-center gap-3 overflow-hidden p-4 pl-5 transition hover:border-accent/50 sm:gap-4">
      <TeamGlow away={winner.color} home={loser.color} strength={1.4} />
      <div className="relative flex shrink-0 items-center">
        <TeamBadge side={winner} size={36} />
        <span className="-ml-3 opacity-70">
          <TeamBadge side={loser} size={26} />
        </span>
      </div>
      <div className="relative min-w-0 flex-1">
        <p className="flex items-center gap-1.5 text-xs text-ink-3">
          <span className={tone}>{icon}</span>
          {title} · {LEAGUES[card.league].name}
        </p>
        <p className="font-display text-base font-semibold leading-snug text-ink sm:truncate sm:text-lg">{line(card, winner, loser)}</p>
        <p className="truncate text-sm text-ink-2 tabular">{detail(card, winner, loser)}</p>
      </div>
    </Link>
  );
}

/** The day at a glance: how many winners the forecast called, as a ring, and each league's share as a bar. */
function DayScore({ day, leagues }: { day: DayResults; leagues: LeagueId[] }) {
  const { total } = day;
  return (
    <div className="card relative shrink-0 overflow-hidden px-6 py-5 lg:min-w-[420px]">
      <span className="pointer-events-none absolute -left-16 -top-16 h-48 w-48 rounded-full bg-accent/20 blur-3xl" aria-hidden />
      <div className="relative flex items-center gap-5">
        <ChanceRing value={total.hits / total.graded} size={120} label="Winners called that day" caption="called" />
        <div className="min-w-0 flex-1">
          <p className="font-display text-3xl font-bold text-ink tabular">{record(total)}</p>
          <p className="text-xs text-ink-3">
            {total.hits} of {total.graded} winners called
            {total.locked ? ` · ${total.locked} locked before the game` : ''}
          </p>
          {leagues.length > 0 && (
            <dl className="mt-3 space-y-1.5 text-xs">
              {leagues.map((id) => {
                const t = day.byLeague[id]!;
                return (
                  <div key={id} className="grid grid-cols-[2.75rem_minmax(0,1fr)] items-center gap-2">
                    <dt className="font-medium text-ink-2">{LEAGUES[id].name}</dt>
                    <dd className="flex items-center gap-2">
                      <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-track" aria-hidden>
                        <span
                          className="block h-full rounded-full bg-gradient-to-r from-accent to-accent-2"
                          style={{ width: `${t.graded ? ((t.hits / t.graded) * 100).toFixed(1) : 0}%` }}
                        />
                      </span>
                      <span className="w-10 text-right text-ink-2 tabular sm:w-20">
                        {t.graded ? (
                          <>
                            {record(t)}
                            <span className="hidden sm:inline"> · {pct(t.hits / t.graded)}</span>
                          </>
                        ) : (
                          '—'
                        )}
                      </span>
                    </dd>
                  </div>
                );
              })}
            </dl>
          )}
        </div>
      </div>
    </div>
  );
}

export default async function ResultsPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const { date: requestedDate } = await searchParams;
  const { models } = await getAllModels();
  const today = etDateKey(new Date());
  const dates = gameDates(models);
  const todayHasFinals = dayResults(models, today).total.graded > 0;
  const requested = isDateKey(requestedDate) ? requestedDate : null;
  const date = requested ?? (todayHasFinals ? today : lastResultsDate(models, today) ?? today);
  const day = dayResults(models, date);
  const previous = [...dates].reverse().find((d) => d < date);
  const next = dates.find((d) => d > date);
  const leagues = LEAGUE_IDS.filter((id) => day.byLeague[id]);
  // The last few weeks of days with graded games, oldest first, ending at the newest (not the one shown).
  const recentDays = dates
    .filter((d) => d <= today)
    .slice(-60)
    .map((d) => ({ date: d, ...dayResults(models, d).total }))
    .filter((d) => d.graded > 0)
    .slice(-RECENT_DAYS);
  const highlights = dayHighlights(day.cards);
  const comeback = dayComeback(models, day.cards);
  const finishedOn = (m: (typeof models)[number]) =>
    day.cards.filter((c) => c.league === m.league && c.completed).flatMap((c) => (m.predictions[c.id] ? [m.predictions[c.id].game] : []));
  // The model's logged prop disagreements for that day's games, graded (the forward test).
  const picks = (
    await Promise.all(
      models.map(async (m) => ({
        league: m.league,
        overall: m.record.propsLive,
        colorOf: (teamId: string) => displayColor(m.teams[teamId]?.color, m.teams[teamId]?.altColor),
        day: await propPicksFor(LEAGUES[m.league], finishedOn(m)).catch(() => null)
      }))
    )
  ).filter((p) => p.day && (p.day.bets || p.day.pushes));
  // The day's best lines, from each league's finished games that date.
  const best = (await Promise.all(models.map((m) => standouts(LEAGUES[m.league], finishedOn(m)).catch(() => [])))).flat();

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Results"
        title={relativeDayLabel(date) === formatLongDay(`${date}T16:00:00Z`) ? formatLongDay(`${date}T16:00:00Z`) : `${relativeDayLabel(date)}, ${formatLongDay(`${date}T16:00:00Z`)}`}
        aside={day.total.graded > 0 && <DayScore day={day} leagues={leagues} />}
      >
        <p>Every game that day, with the forecast and whether it called the winner.</p>
        <nav className="mt-4 flex flex-wrap items-center gap-2" aria-label="Dates">
          {previous ? (
            <Link href={`/results?date=${previous}`} className="chip chip-idle">
              <ChevronLeft className="h-4 w-4" aria-hidden /> {relativeDayLabel(previous)}
            </Link>
          ) : null}
          <DatePicker value={date} min={dates[0] ?? date} max={dates[dates.length - 1] ?? date} />
          {next ? (
            <Link href={`/results?date=${next}`} className="chip chip-idle">
              {relativeDayLabel(next)} <ChevronRight className="h-4 w-4" aria-hidden />
            </Link>
          ) : null}
        </nav>
      </PageHeader>

      {recentDays.length > 1 && <RecentDays days={recentDays} current={date} />}

      {(highlights.upset || highlights.surest || comeback) && (
        <div className={`grid gap-3 md:grid-cols-2 ${[highlights.upset, highlights.surest, comeback].filter(Boolean).length === 3 ? 'xl:grid-cols-3' : ''}`}>
          {highlights.upset && (
            <Highlight
              card={highlights.upset}
              icon={<Zap className="h-4 w-4" aria-hidden />}
              tone="text-warn"
              title="Biggest upset"
              line={(c, winner, loser) => `${winner.shortName} beat ${loser.shortName} ${winner.score}–${loser.score}`}
              detail={(c, winner) => `The forecast gave ${winner.abbr} ${pct(1 - c.pickProb)}`}
            />
          )}
          {highlights.surest && (
            <Highlight
              card={highlights.surest}
              icon={<Target className="h-4 w-4" aria-hidden />}
              tone="text-accent-strong"
              title="Most confident call"
              line={(c) => `${(c.pick === 'home' ? c.home : c.away).shortName} at ${pct(c.pickProb)}`}
              detail={(c, winner, loser) => `${c.correct ? 'Called it' : 'Missed'}: ${winner.abbr} ${winner.score}, ${loser.abbr} ${loser.score}`}
            />
          )}
          {comeback && (
            <Highlight
              card={comeback.card}
              icon={<TrendingUp className="h-4 w-4" aria-hidden />}
              tone="text-good"
              title="Comeback of the day"
              line={(c, winner) => `${winner.shortName} came back`}
              detail={(c, winner, loser) =>
                `Down to ${pct(comeback.low)} after ${/^\d+$/.test(comeback.at) ? `the ${ordinal(Number(comeback.at))}` : comeback.at}, beat ${loser.abbr} ${winner.score}–${loser.score}`
              }
            />
          )}
        </div>
      )}
      {best.length > 0 && (
        <section aria-labelledby="results-standouts" className="space-y-3">
          <h2 id="results-standouts" className="font-display text-lg font-semibold text-ink">
            Standouts
          </h2>
          <Standouts items={best} />
        </section>
      )}

      {picks.length > 0 && (
        <section aria-labelledby="results-picks" className="space-y-3">
          <h2 id="results-picks" className="font-display text-lg font-semibold text-ink">
            The model&apos;s prop picks
          </h2>
          <p className="max-w-3xl text-sm text-ink-2">
            Lines where our player model disagreed with the book by 10+ points, logged before each game and graded from the box score: the
            forward test of the props model. Overall they&apos;re{' '}
            {picks
              .map((p) => `${p.overall ? `${p.overall.won}–${p.overall.lost} (${signedPct(p.overall.returnPerBet)} a bet)` : 'new'} in the ${LEAGUES[p.league].name}`)
              .join(', ')}
            . A record, not tips.{' '}
            <Link href="/record" className="text-accent-strong underline underline-offset-2">
              Full record →
            </Link>
          </p>
          <div className="grid gap-3 lg:grid-cols-2">
            {picks.map(({ league, colorOf, day: d }) => (
              <div key={league} className="card min-w-0 p-4">
                <p className="flex items-baseline justify-between gap-3">
                  <span className="font-semibold text-ink">{LEAGUES[league].name}</span>
                  <span className="text-sm text-ink-2 tabular">
                    <span className={`font-display text-lg font-bold ${d!.returnPerBet >= 0 ? 'text-good' : 'text-ink'}`}>
                      {d!.won}–{d!.lost}
                      {d!.pushes ? `–${d!.pushes}` : ''}
                    </span>{' '}
                    · {signedPct(d!.returnPerBet)} a bet
                  </span>
                </p>
                <ul className="mt-2 divide-y divide-line/60 text-sm">
                  {[...d!.recent]
                    .sort((a, b) => b.entry.edge - a.entry.edge)
                    .slice(0, PICKS_SHOWN)
                    .map((g) => (
                      <li key={`${g.entry.gameId}-${g.entry.athleteId}-${g.entry.market}`} className="flex items-center gap-2.5 py-1.5">
                        <PlayerPhoto league={league} id={g.entry.athleteId} name={g.entry.name} size={26} ring={colorOf(g.entry.teamId)} />
                        <Link href={`/${league}/player/${g.entry.athleteId}`} className="min-w-0 flex-1 truncate text-ink-2 hover:text-ink hover:underline">
                          {g.entry.name} {g.entry.side} {g.entry.line} {marketLabel(g.entry.market).long}
                        </Link>
                        <span className="text-ink-3 tabular" title="What he finished with">
                          {g.actual}
                        </span>
                        <span
                          className={`w-12 rounded-full py-0.5 text-center text-[11px] font-semibold ring-1 ${
                            g.result === 'won' ? 'bg-good/10 text-good ring-good/30' : g.result === 'lost' ? 'bg-bad/10 text-bad ring-bad/30' : 'bg-raised text-ink-3 ring-line'
                          }`}
                        >
                          {g.result === 'won' ? 'Hit' : g.result === 'lost' ? 'Miss' : 'Push'}
                        </span>
                      </li>
                    ))}
                </ul>
                {d!.recent.length > PICKS_SHOWN && <p className="mt-2 text-xs text-ink-3">The {PICKS_SHOWN} biggest disagreements of {d!.won + d!.lost + d!.pushes} graded.</p>}
              </div>
            ))}
          </div>
        </section>
      )}

      {day.total.graded > 0 && day.total.locked < day.total.graded && (
        <p className="text-xs text-ink-3">
          Games without a locked forecast are graded on what the model would have said beforehand, the same way as the backtest on the
          track record page.
        </p>
      )}

      <section aria-labelledby="results-games" className="space-y-3">
        <h2 id="results-games" className="font-display text-lg font-semibold text-ink">
          Every game
        </h2>
        <Board cards={day.cards} leagues={leagues.length > 1 ? leagues : undefined} emptyText="No games on this date." />
      </section>
    </div>
  );
}
