import { History, Layers, Scale, ShieldCheck } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { pct } from '../../lib/format';
import { isLeagueId, LEAGUES, LeagueId } from '../../lib/leagues';
import type { LeagueModel } from '../../lib/model';
import { getAllModels } from '../../lib/model/all';
import { formatAmerican } from '../../lib/model/market';
import { hitRate } from '../../lib/model/hitRate';
import { HIT_GAMES, HOT_STREAKS } from '../../lib/model/hitRateRecord';
import { FORM_GAMES, recentGames, RecentGames } from '../../lib/model/playerIndex';
import { marketLabel, PropMarket } from '../../lib/props';
import { displayColor } from '../../lib/teamColor';
import { formatShortDate, renderedAt } from '../../lib/time';
import { AutoRefresh } from '../components/AutoRefresh';
import { CalibrationChart } from '../components/CalibrationChart';
import { PropFinder, PropSpot } from '../components/PropFinder';
import { EmptyState, PageHeader, Section, StatTile } from '../components/Section';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ searchParams }: { searchParams: Promise<{ league?: string }> }): Promise<Metadata> {
  const { league } = await searchParams;
  const name = league && isLeagueId(league) && LEAGUES[league].name;
  return {
    title: name ? `${name} player props` : 'Player props',
    description: `Every posted ${name ? `${name} ` : ''}player prop for the next games, with our projection, each player's last five games, the real chance of the over, and where the model disagrees.`
  };
}

/** One league's boards, flattened into rows the finder can filter (`games` adds each player's last-five average and his hit rate against the line). */
function spotsFor(model: LeagueModel, games: RecentGames | null = null): PropSpot[] {
  const spots: PropSpot[] = [];
  for (const [gameId, board] of Object.entries(model.propBoards)) {
    const game = model.predictions[gameId]?.game;
    if (!game) continue;
    for (const row of board.rows) {
      const log = games?.get(row.id) ?? [];
      for (const [market, cell] of Object.entries(row.cells) as [PropMarket, NonNullable<(typeof row.cells)[PropMarket]>][]) {
        if (!cell.line) continue;
        const values = log.map((g) => g[market]);
        spots.push({
          key: `${gameId}|${row.id}|${market}`,
          league: model.league,
          gameId,
          game: `${game.away.abbr} @ ${game.home.abbr}`,
          start: game.date,
          playerId: row.id,
          name: row.name,
          teamId: row.teamId,
          team: model.teams[row.teamId]?.abbr ?? '',
          detail: row.detail,
          available: row.available,
          market,
          line: cell.line.line,
          openLine: cell.line.openLine ?? null,
          recent: averageOf(values.slice(0, FORM_GAMES)),
          hits: hitRate(values, cell.line.line, HIT_GAMES),
          teamColor: displayColor(model.teams[row.teamId]?.color, model.teams[row.teamId]?.altColor),
          over: cell.line.over,
          under: cell.line.under,
          book: cell.line.book,
          projection: cell.projection,
          forecastOver: cell.line.forecastOver,
          modelOver: cell.line.modelOver,
          edge: cell.line.edge
        });
      }
    }
  }
  return spots;
}

/** The average of the games that logged the stat, to one decimal; null with none. */
function averageOf(values: (number | undefined)[]) {
  const logged = values.filter((v): v is number => v !== undefined);
  return logged.length ? Math.round((logged.reduce((a, b) => a + b, 0) / logged.length) * 10) / 10 : null;
}

const signedPct = (x: number) =>`${x >= 0 ? '+' : '−'}${Math.abs(x * 100).toFixed(1)}%`;

export default async function PropsPage({ searchParams }: { searchParams: Promise<{ league?: string }> }) {
  const { league: requestedLeague } = await searchParams;
  const { models } = await getAllModels();
  const withProps = models.filter((m) => LEAGUES[m.league].players || LEAGUES[m.league].nhlPlayers || LEAGUES[m.league].nflPlayers);
  const counts = new Map(withProps.map((m) => [m.league, spotsFor(m).length]));
  const requested = withProps.find((m) => m.league === requestedLeague);
  // Default to the league with lines up soonest.
  const soonest = [...withProps]
    .filter((m) => counts.get(m.league))
    .sort((a, b) => {
      const first = (m: LeagueModel) => Math.min(...Object.keys(m.propBoards).map((id) => Date.parse(m.predictions[id]?.game.date ?? '9999')));
      return first(a) - first(b);
    })[0];
  const model = requested ?? soonest ?? withProps[0];
  if (!model) return <EmptyState>Player props aren&apos;t available right now.</EmptyState>;
  const league = LEAGUES[model.league];
  const spots = spotsFor(model, await recentGames(league, model).catch(() => null));
  const streaks = HOT_STREAKS[model.league];
  const calibrationBuckets = model.record.props?.calibration ?? [];
  const backtest = model.record.props?.betting;
  const live = model.record.propsLive;
  const games = Object.keys(model.propBoards).length;

  return (
    <div className="space-y-8">
      <PageHeader eyebrow="Player props" title="Every prop, one board" aside={<AutoRefresh live={false} at={renderedAt().toISOString()} />}>
        <p>
          Every player prop posted for the next {league.id === 'nfl' ? 'few days' : 'day or so'}, next to our projection. The over chance follows
          the book&apos;s own number with its margin removed, which was the more accurate one in every league; lines where our model disagrees
          by 10+ points are tagged with how such lines have done. Not betting advice.
        </p>
        <nav className="mt-4 flex flex-wrap gap-2" aria-label="League">
          {withProps.map((m) => (
            <Link key={m.league} href={`/props?league=${m.league}`} aria-current={m.league === model.league ? 'page' : undefined} className={`chip ${m.league === model.league ? 'chip-active' : 'chip-idle'}`}>
              {LEAGUES[m.league].name} <span className="tabular opacity-70">{counts.get(m.league as LeagueId) ?? 0}</span>
            </Link>
          ))}
        </nav>
      </PageHeader>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label="Lines posted"
          value={spots.length.toLocaleString()}
          sub={`${games} ${games === 1 ? 'game' : 'games'} · ${spots[0]?.book ?? 'no book yet'}`}
          icon={<Layers className="h-4 w-4" aria-hidden />}
        />
        <StatTile label="Model disagrees" value={spots.filter((s) => s.edge).length} sub="by 10+ points against the price" icon={<Scale className="h-4 w-4" aria-hidden />} />
        <StatTile
          label="Past disagreements"
          value={backtest?.bets ? signedPct(backtest.returnPerBet) : '—'}
          sub={backtest?.bets ? `a bet · ${backtest.bets.toLocaleString()} graded lines, ${pct(backtest.won / backtest.bets)} won` : 'No graded lines yet'}
          icon={<History className="h-4 w-4" aria-hidden />}
        />
        <StatTile
          label="Logged before games"
          value={live?.bets ? `${live.won}–${live.lost}` : '—'}
          sub={live?.bets ? `${signedPct(live.returnPerBet)} a bet${live.pending ? ` · ${live.pending} pending` : ''}` : live?.pending ? `${live.pending} pending, graded when final` : 'Logging starts with the next games'}
          icon={<ShieldCheck className="h-4 w-4" aria-hidden />}
        />
      </div>
      {live?.bets ? (
        <p className="-mt-2 text-xs text-ink-3">
          Every logged pick, graded:{' '}
          <a href={`/api/graded-props?league=${model.league}`} download className="text-accent-strong underline underline-offset-2">
            download the {league.name} picks (CSV)
          </a>
          .
        </p>
      ) : null}

      {spots.length ? (
        <div className="space-y-3">
          <PropFinder spots={spots} record={backtest ? { league: league.name, ...backtest } : null} />
          {streaks && spots.some((s) => s.hits) && (
            <p className="rounded-xl bg-raised/60 px-4 py-3 text-sm text-ink-2 ring-1 ring-line">
              <span className="font-semibold text-ink">About L10.</span> It counts the games he went over this line in his last ten, the number
              prop apps lead with, and it describes the past. On {streaks.lines.toLocaleString()} past {league.name} lines where a player had
              cleared it in 8 or more of his last 10, {pct(streaks.over, 1)} went over next time; the book had them at {pct(streaks.book, 1)}.
              Books move the line to recent form, so the over chance is the number to go by.
            </p>
          )}
        </div>
      ) : (
        <EmptyState>No {league.name} props are posted yet for the next games. Books usually post them the day before.</EmptyState>
      )}

      {calibrationBuckets.length > 2 && (
        <Section
          title="Do these chances hold up?"
          subtitle={`Every graded ${league.name} main line since the tuning season, at the chance this board would have shown for the likelier side: when it said 60%, did that side come in about 60% of the time? ${model.record.props!.lines.toLocaleString()} lines, pushes left out.`}
        >
          <div className="max-w-xl">
            <CalibrationChart
              buckets={calibrationBuckets}
              title={`${league.name} prop chances`}
              words={{ axis: 'Chance shown for the likelier side', units: 'Lines', hit: 'Came in' }}
            />
          </div>
        </Section>
      )}

      <Section
        title="Latest logged picks"
        subtitle={`The model's ${league.name} disagreements, logged before each game at the line and price on offer then, and graded after. A player who doesn't play voids the pick, as the books settle it.`}
      >
        {live?.recent.length ? (
          <ul className="divide-y divide-line">
            {live.recent.map(({ entry, actual, result }) => (
              <li key={`${entry.gameId}|${entry.athleteId}|${entry.market}`} className="flex items-center gap-3 py-2.5 text-sm">
                <span
                  className={`w-12 shrink-0 rounded-full px-2 py-0.5 text-center text-[11px] font-semibold ${
                    result === 'won' ? 'bg-good/15 text-good' : result === 'lost' ? 'bg-bad/15 text-bad' : 'bg-raised text-ink-3'
                  }`}
                >
                  {result === 'won' ? 'Won' : result === 'lost' ? 'Lost' : 'Push'}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-ink">
                    {entry.name} {entry.side} {entry.line} {marketLabel(entry.market).long}
                  </span>
                  <span className="block truncate text-xs text-ink-3">
                    {entry.book} {formatAmerican(entry.side === 'over' ? entry.over : entry.under)} · model {pct(entry.side === 'over' ? entry.model : 1 - entry.model)} ·{' '}
                    {formatShortDate(entry.start)}
                  </span>
                </span>
                <span className="shrink-0 tabular text-ink-2">
                  Had <span className="font-semibold text-ink">{actual}</span>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState>
            {live?.pending
              ? `${live.pending} picks are logged for games still to finish. They show up here, graded, once those games are final.`
              : 'Logging starts as the next games get close. Picks show up here once their games are final.'}
          </EmptyState>
        )}
      </Section>
    </div>
  );
}
