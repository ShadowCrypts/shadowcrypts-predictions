import { Activity, Flame, ShieldCheck, Target } from 'lucide-react';
import Link from 'next/link';
import { pct } from '../lib/format';
import { LEAGUE_IDS, LEAGUES } from '../lib/leagues';
import { getAllModels } from '../lib/model/all';
import { CardData, toCard } from '../lib/model/card';
import { dailyBrief } from '../lib/model/brief';
import { freshen } from '../lib/model/fresh';
import { biggestMovers, readMovement } from '../lib/model/movement';
import { peekSeasonProjection } from '../lib/model/projections';
import { dayResults, lastResultsDate } from '../lib/model/results';
import { standouts } from '../lib/model/standouts';
import { etDateKey, formatLongDay, relativeDayLabel, renderedAt } from '../lib/time';
import { AutoRefresh } from './components/AutoRefresh';
import { Board } from './components/Board';
import { ChanceBar } from './components/ChanceBar';
import { GameRow } from './components/GameCard';
import { DisagreementList } from './components/DisagreementList';
import { FeaturedGame } from './components/FeaturedGame';
import { Movers } from './components/Movers';
import { EmptyState, PageHeader, Section, StatTile } from './components/Section';
import { Standouts } from './components/Standouts';
import { TodaysBrief } from './components/TodaysBrief';
import { YourPlayers } from './components/YourPlayers';
import { CompactHistory, YourTeams } from './components/YourTeams';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const { models, failed } = await getAllModels();
  // Games on now get the latest scores and clocks (each league's scoreboard is read again at most every 15 seconds).
  const slates = await Promise.all(models.map((m) => freshen(m.league, m.slate)));
  const cards: CardData[] = slates
    .flat()
    .map(toCard)
    .sort((a, b) => a.date.localeCompare(b.date));
  const upcoming = cards.filter((c) => c.state === 'pre');
  const live = cards.filter((c) => c.state === 'in');
  const strongest = [...upcoming].sort((a, b) => b.pickProb - a.pickProb).slice(0, 5);
  const strongCount = upcoming.filter((c) => c.band === 'Strong').length;

  const graded = models.reduce((s, m) => s + m.record.overall.games, 0);
  const correct = models.reduce((s, m) => s + m.record.overall.correct, 0);
  const liveGames = models.reduce((s, m) => s + m.record.live.metrics.games, 0);
  const liveCorrect = models.reduce((s, m) => s + m.record.live.metrics.correct, 0);
  const now = renderedAt();
  const lastDate = lastResultsDate(models, etDateKey(now));
  const lastNight = lastDate ? dayResults(models, lastDate) : null;
  // Each league's playoff stakes for its coming games, from the season simulation when it's on hand (never waited on).
  const projections = await Promise.all(models.map((m) => peekSeasonProjection(m.league)));
  const stakes = Object.fromEntries(projections.flatMap((p) => (p.status === 'ready' ? [[p.league, p.stakes]] : [])));
  // The same, keyed for Your teams: playoff odds by "league:teamId", stakes by "league:gameId" (only games on the board).
  const onBoard = new Set(cards.map((c) => `${c.league}:${c.id}`));
  const playoffOdds = Object.fromEntries(projections.flatMap((p) => (p.status === 'ready' ? p.teams.map((t) => [`${p.league}:${t.id}`, t.playoffs] as const) : [])));
  const gameStakes = Object.fromEntries(
    projections.flatMap((p) => (p.status === 'ready' ? Object.entries(p.stakes ?? {}).map(([id, s]) => [`${p.league}:${id}`, s] as const) : [])).filter(([key]) => onBoard.has(key))
  );
  const brief = dailyBrief(models, now, stakes);
  // The spotlight: the closest game on now; else the brief's game to watch; else the next game to start.
  const closestLive = [...live].sort((a, b) => Math.abs((a.liveHomeProb ?? a.homeProb) - 0.5) - Math.abs((b.liveHomeProb ?? b.homeProb) - 0.5))[0];
  const watchHref = brief.find((b) => b.kind === 'watch')?.href;
  const watched = watchHref ? cards.find((c) => `/${c.league}/game/${c.id}` === watchHref) : undefined;
  const featured = closestLive
    ? { card: closestLive, reason: 'Closest game on now' }
    : watched
      ? { card: watched, reason: 'Game to watch' }
      : upcoming[0]
        ? { card: upcoming[0], reason: 'Up next' }
        : null;
  // Last night's best line in each league's headline stat (one per league, so it stays short).
  const lastNightBest = lastNight
    ? (
        await Promise.all(
          models.map((m) =>
            standouts(
              LEAGUES[m.league],
              lastNight.cards.filter((c) => c.league === m.league && c.completed).flatMap((c) => (m.predictions[c.id] ? [m.predictions[c.id].game] : []))
            )
              .then((list) => list.slice(0, 1))
              .catch(() => [])
          )
        )
      ).flat()
    : [];

  // Forecast history: the day's biggest moves, and what "Your teams" needs for "since your last visit".
  const movements = await Promise.all(models.map((m) => readMovement(m.league)));
  const dayAgo = now.getTime() - 86_400_000;
  const movers = models
    .flatMap((m, i) => biggestMovers(movements[i], m.slate.filter((p) => p.game.state === 'pre'), dayAgo))
    .sort((a, b) => Math.abs(b.to.p - b.from.p) - Math.abs(a.to.p - a.from.p))
    .slice(0, 5);
  const cardByKey = new Map(cards.map((c) => [`${c.league}:${c.id}`, c]));
  const history: CompactHistory = {};
  models.forEach((m, i) => {
    for (const p of m.slate) {
      const snapshots = movements[i][p.game.id];
      if (p.game.state === 'pre' && snapshots?.length) history[`${m.league}:${p.game.id}`] = snapshots.map((s) => [Date.parse(s.t), s.p]);
    }
  });

  return (
    <div className="space-y-8">
      <div className={`grid items-center gap-6 ${featured ? 'lg:grid-cols-[minmax(0,1fr)_minmax(0,500px)] lg:gap-10' : ''}`}>
        <PageHeader
          eyebrow={formatLongDay(now)}
          title={
            <>
              Today&apos;s <span className="text-gradient">board</span>
            </>
          }
        >
          <p>
            {cards.length} games across the NFL, NBA, MLB and NHL. Forecasts follow the betting line once it&apos;s posted and our ratings
            before that, and every pick is graded in public.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-3">
            {lastNight && lastNight.total.graded > 0 && (
              <Link
                href={`/results?date=${lastNight.date}`}
                className="inline-flex flex-wrap items-center gap-x-2 gap-y-1 rounded-full bg-surface px-4 py-1.5 text-sm ring-1 ring-line transition hover:ring-accent/50"
              >
                <span className="text-ink-3">{relativeDayLabel(lastNight.date)}</span>
                <span className="font-semibold text-ink tabular">
                  {lastNight.total.hits}–{lastNight.total.misses}
                </span>
                <span className="text-ink-3 tabular">({pct(lastNight.total.hits / lastNight.total.graded)} correct)</span>
                <span className="text-accent-strong">See results →</span>
              </Link>
            )}
            <AutoRefresh live={live.length > 0} at={now.toISOString()} />
          </div>
        </PageHeader>
        {featured && <FeaturedGame card={featured.card} reason={featured.reason} />}
      </div>

      {live.length > 0 && (
        <Link
          href="/live"
          className="group flex flex-col gap-3 rounded-2xl border border-live/30 bg-live/10 px-5 py-4 transition hover:border-live/60 hover:bg-live/15 sm:flex-row sm:items-center sm:justify-between"
        >
          <span className="flex items-center gap-3">
            <span className="relative flex h-3 w-3 shrink-0" aria-hidden>
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-live opacity-70" />
              <span className="relative inline-flex h-3 w-3 rounded-full bg-live" />
            </span>
            <span>
              <span className="block font-display text-lg font-semibold text-ink">
                {live.length} {live.length === 1 ? 'game' : 'games'} live now
              </span>
              <span className="block text-sm text-ink-2">Win chances moving play by play, and your tracked parlays sweating in real time.</span>
            </span>
          </span>
          <span className="shrink-0 self-start rounded-xl bg-live-solid px-4 py-2 text-sm font-semibold text-white transition group-hover:brightness-110 sm:self-auto">
            Open live mode →
          </span>
        </Link>
      )}

      {failed.length > 0 && (
        <p className="rounded-xl border border-warn/40 bg-warn/10 px-4 py-3 text-sm text-ink">
          {failed.map((id) => LEAGUES[id].name).join(', ')} data didn&apos;t load this time. The rest of the board is current; refresh to retry.
        </p>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="On the board" value={cards.length} sub={live.length ? `${live.length} live now` : `${upcoming.length} still to play`} icon={<Activity className="h-4 w-4" />} />
        <StatTile label="Strong forecasts" value={strongCount} sub="70%+ win probability" icon={<Flame className="h-4 w-4" />} />
        <StatTile
          label="Backtest accuracy"
          value={graded ? pct(correct / graded, 1) : '—'}
          sub={
            <Link href="/record" className="hover:text-ink">
              {graded.toLocaleString()} graded games →
            </Link>
          }
          icon={<Target className="h-4 w-4" />}
        />
        <StatTile
          label="Logged picks"
          value={liveGames ? `${liveCorrect}–${liveGames - liveCorrect}` : '—'}
          sub={liveGames ? `${pct(liveCorrect / liveGames, 1)} · locked before each game` : 'Locked before games start'}
          icon={<ShieldCheck className="h-4 w-4" />}
        />
      </div>

      <YourTeams cards={cards} history={history} playoffs={playoffOdds} stakes={gameStakes} />
      <YourPlayers />

      <div className="grid grid-cols-1 gap-8 xl:grid-cols-[minmax(0,1fr)_340px] xl:grid-rows-[auto_1fr]">
        <div className="space-y-8 xl:col-start-2 xl:row-start-1">
          <Section title="Today's brief" subtitle="The headlines from the next day of games.">
            <TodaysBrief items={brief} />
          </Section>
          {lastNightBest.length > 0 && lastNight && (
            <Section
              title={`${relativeDayLabel(lastNight.date)}'s standouts`}
              subtitle="The best line in each headline stat."
              action={
                <Link href={`/results?date=${lastNight.date}`} className="text-sm text-ink-2 hover:text-ink hover:underline">
                  All results →
                </Link>
              }
            >
              <Standouts items={lastNightBest} compact />
            </Section>
          )}
          <Section title="Strongest forecasts" subtitle="The most confident calls still to play. Confidence isn't value: these are mostly heavy favorites.">
            {strongest.length ? (
              <div className="-mx-2">
                {strongest.map((c) => (
                  <GameRow key={c.id} card={c} showLeague />
                ))}
              </div>
            ) : (
              <EmptyState>Nothing left to play in this window.</EmptyState>
            )}
          </Section>
        </div>

        <section className="min-w-0 xl:col-start-1 xl:row-span-2 xl:row-start-1" aria-labelledby="board-title">
          <h2 id="board-title" className="mb-4 font-display text-lg font-semibold tracking-tight text-ink sm:text-xl">
            Every game
          </h2>
          <Board cards={cards} leagues={LEAGUE_IDS} emptyText="No games are scheduled in the current windows." />
        </section>

        <div className="space-y-8 xl:col-start-2 xl:row-start-2">
          <Section title="Biggest moves" subtitle="Forecasts that moved most in the last 24 hours, and what moved them.">
            <Movers movers={movers} cards={cardByKey} />
          </Section>
          <Section
            title="Ratings vs. the line"
            subtitle="Where our Elo ratings and the betting market disagree most. The market has been more accurate in every league, so read these as questions, not bets."
          >
            <DisagreementList cards={upcoming} limit={5} />
          </Section>
          <Section title="Track record" subtitle="Forecast accuracy on every graded game.">
            <ul className="divide-y divide-line">
              {models.map((m) => (
                <li key={m.league}>
                  <Link href={`/${m.league}#record`} className="block py-2.5 text-sm transition hover:text-ink">
                    <span className="flex items-center justify-between gap-3">
                      <span className="font-medium text-ink">{LEAGUES[m.league].name}</span>
                      <span className="flex items-baseline gap-2">
                        <span className="text-xs text-ink-3 tabular">{m.record.overall.games.toLocaleString()} games</span>
                        <span className="w-14 text-right font-display font-bold text-ink tabular">{pct(m.record.overall.accuracy, 1)}</span>
                      </span>
                    </span>
                    <ChanceBar chance={m.record.overall.accuracy} width="w-full" />
                  </Link>
                </li>
              ))}
            </ul>
          </Section>
        </div>
      </div>
    </div>
  );
}
