import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { pct, signed } from '../../lib/format';
import { isLeagueId, LEAGUES, seasonLabel } from '../../lib/leagues';
import { getLeagueModel } from '../../lib/model';
import { toCard } from '../../lib/model/card';
import { peekSeasonProjection } from '../../lib/model/projections';
import { propEngine } from '../../lib/model/propEngines';
import { leagueSheet, overtimeNote, tapeSeason } from '../../lib/model/tape';
import { METRICS } from '../../lib/model/teamMetrics';
import { seasonTeamMetrics } from '../../lib/model/teamMetricsLoad';
import { displayColor } from '../../lib/teamColor';
import { formatTime } from '../../lib/time';
import { AutoRefresh } from '../components/AutoRefresh';
import { Board } from '../components/Board';
import { DisagreementList } from '../components/DisagreementList';
import { FollowedStar } from '../components/FollowedStar';
import { GameRow } from '../components/GameCard';
import { StakesList } from '../components/PlayoffStakes';
import { LeagueProjections } from '../components/Projections';
import { RecordPanel } from '../components/RecordPanel';
import { EmptyState, PageHeader, Section } from '../components/Section';
import { Sparkline } from '../components/Sparkline';
import { TeamLogo } from '../components/TeamLogo';
import { TeamStatRow, TeamStatsTable } from '../components/TeamStatsTable';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ league: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { league: id } = await params;
  if (!isLeagueId(id)) return {};
  const league = LEAGUES[id];
  return { title: `${league.name} predictions`, description: `${league.fullName} win probabilities, power rankings and model track record.` };
}

export default async function LeaguePage({ params }: Params) {
  const { league: id } = await params;
  if (!isLeagueId(id)) notFound();
  const league = LEAGUES[id];
  const model = await getLeagueModel(league.id);
  // Never holds the page up: a simulation still running shows on a later load.
  const projection = await peekSeasonProjection(league.id);
  const cards = model.slate.map(toCard);
  const live = cards.some((c) => c.state === 'in');
  const previousRecord = model.rankings.find((r) => r.recordSeason && r.recordSeason !== model.season.label)?.recordSeason;
  // Games still to play with the most playoff chance riding on them (both teams' swings added up).
  const swing = (s: { ifWin: number; ifLoss: number }) => s.ifWin - s.ifLoss;
  const bigGames =
    projection.status === 'ready'
      ? cards
          .filter((c) => c.state === 'pre' && projection.stakes?.[c.id])
          .map((c) => ({
            href: `/${league.id}/game/${c.id}`,
            away: c.away,
            home: c.home,
            date: c.date,
            awaySwing: swing(projection.stakes[c.id].away),
            homeSwing: swing(projection.stakes[c.id].home)
          }))
          .filter((g) => g.awaySwing + g.homeSwing >= 0.04)
          .sort((a, b) => b.awaySwing + b.homeSwing - (a.awaySwing + a.homeSwing))
          .slice(0, 5)
      : [];
  // Every team's numbers. Last season's stand in until each has played a few, so one team's two games can't top a column.
  const allGames = Object.values(model.predictions).map((p) => p.game);
  const today = new Date().toISOString();
  const teamIds = model.rankings.map((r) => r.team.id);
  // (A team new to the league has neither season on file: it's left out, and the rest still show.)
  const statsYear = tapeSeason(allGames, teamIds, model.season.year, today) ?? model.season.year;
  const metrics = await seasonTeamMetrics(league, allGames, statsYear, today);
  const statsSheet = leagueSheet({ teamIds, games: allGames, history: model.history, seasonYear: statsYear, before: today, metrics, league: league.id });
  const teamStats: TeamStatRow[] = model.rankings.flatMap((r) => {
    const sheet = statsSheet.teams[r.team.id];
    if (!sheet?.season) return [];
    const { games, scored, allowed, home, road, recent, schedule } = sheet.season;
    return [{ id: r.team.id, abbr: r.team.abbr, shortName: r.team.shortName, logo: r.team.logo, color: displayColor(r.team.color, r.team.altColor), games, scored, allowed, home, road, recent, schedule, metrics: sheet.metrics }];
  });
  const metricGroup = METRICS[league.id];

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow={`${model.season.label} · ${model.season.phase}`}
        title={`${league.name} predictions`}
        aside={<AutoRefresh live={live} at={model.generatedAt} />}
      >
        <p>
          {cards.length} games in the next {league.upcomingDays} days · model updated {formatTime(model.generatedAt)}
        </p>
        <nav className="mt-4 flex flex-wrap gap-2 text-sm" aria-label="Sections">
          {[
            ['#games', 'Games'],
            ['#rankings', 'Power rankings'],
            ...(teamStats.length ? [['#team-stats', 'Team stats']] : []),
            ['#projections', 'Projections'],
            ['#record', 'Track record']
          ].map(([href, label]) => (
            <a key={href} href={href} className="chip chip-idle">
              {label}
            </a>
          ))}
          {projection.status === 'ready' && (
            <Link href={`/${league.id}/playoffs`} className="chip chip-idle">
              Playoff machine
            </Link>
          )}
          <Link href={`/${league.id}/standings`} className="chip chip-idle">
            Standings
          </Link>
          <Link href={`/${league.id}/injuries`} className="chip chip-idle">
            Injury report
          </Link>
          {league.id === 'nfl' && (
            <Link href="/nfl/fantasy" className="chip chip-idle">
              Fantasy rankings
            </Link>
          )}
          {propEngine(league) && (
            <>
              <Link href={`/${league.id}/players`} className="chip chip-idle">
                {league.id === 'nba' ? 'Player ratings' : league.id === 'nfl' ? 'QB ratings' : 'Players'}
              </Link>
              <Link href={`/props?league=${league.id}`} className="chip chip-idle">
                Player props
              </Link>
            </>
          )}
        </nav>
      </PageHeader>

      <Section id="games" title="Games" subtitle="The filled side of each bar is the pick. Tap a game for the full breakdown." bare>
        <Board cards={cards} emptyText={`No ${league.name} games in the next ${league.upcomingDays} days. Ratings and the track record below stay current.`} />
      </Section>

      <div className="grid grid-cols-1 gap-8 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <Section
          id="rankings"
          title="Power rankings"
          subtitle={
            <>
              Elo from results: 1500 is average, and 100 points is about a 64% favorite on a neutral field. Market is the same scale, learned
              from closing lines.
              {previousRecord && ` Records are from ${previousRecord} until games are played.`}
            </>
          }
        >
          <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
            <table className="w-full min-w-[520px] text-sm">
              <thead>
                <tr className="text-left text-xs text-ink-3">
                  <th className="w-8 pb-2 font-medium">#</th>
                  <th className="pb-2 font-medium">Team</th>
                  <th className="pb-2 text-right font-medium">Elo</th>
                  <th className="pb-2 text-right font-medium" title="Change since the season started">
                    Season
                  </th>
                  <th className="pb-2 text-right font-medium" title="Rating implied by recent closing lines, and its rank">
                    Market
                  </th>
                  <th className="pb-2 pl-4 font-medium">Trend</th>
                </tr>
              </thead>
              <tbody className="tabular">
                {model.rankings.map((r) => (
                  <tr key={r.team.id} className="border-t border-line transition hover:bg-raised/60">
                    <td className="py-2 text-ink-3">{r.rank}</td>
                    <td className="py-2">
                      <Link href={`/${league.id}/team/${r.team.id}`} className="flex items-center gap-2 hover:underline">
                        <span className="h-6 w-1 shrink-0 rounded-full" style={{ background: displayColor(r.team.color, r.team.altColor) }} aria-hidden />
                        <TeamLogo src={r.team.logo} abbr={r.team.abbr} size={22} />
                        <span className="font-medium text-ink">{r.team.shortName}</span>
                        <FollowedStar league={league.id} teamId={r.team.id} />
                        {r.record && <span className="text-xs text-ink-3">{r.record}</span>}
                      </Link>
                    </td>
                    <td className="py-2 text-right font-semibold text-ink">{Math.round(r.rating)}</td>
                    <td className={`py-2 text-right ${r.seasonChange > 0.5 ? 'text-good' : r.seasonChange < -0.5 ? 'text-bad' : 'text-ink-2'}`}>
                      {r.trend.length > 1 ? signed(r.seasonChange) : '—'}
                    </td>
                    <td className="py-2 text-right text-ink-2">
                      {Math.round(r.marketRating)} <span className="text-xs text-ink-3">#{r.marketRank}</span>
                    </td>
                    <td className="py-2 pl-4">
                      <Sparkline values={r.trend} label={`${r.team.shortName} rating trend this season`} color={displayColor(r.team.color, r.team.altColor)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>

        <div className="space-y-8">
          {bigGames.length > 0 && (
            <Section title="Biggest games ahead" subtitle="The coming games with the most playoff chance riding on them, from the season simulation.">
              <StakesList games={bigGames} />
            </Section>
          )}
          <Section title="Ratings vs. the line" subtitle="Biggest gaps between our Elo ratings and the market. The market has been the more accurate of the two.">
            <DisagreementList cards={cards} limit={6} showLeague={false} />
          </Section>
          <Section title="Recent results" subtitle="Latest graded picks.">
            {model.recent.length ? (
              <div className="-mx-2">
                {model.recent.slice(0, 12).map((p) => (
                  <GameRow key={p.game.id} card={toCard(p)} />
                ))}
              </div>
            ) : (
              <EmptyState>No graded games yet.</EmptyState>
            )}
          </Section>
        </div>
      </div>

      {teamStats.length > 0 && (
        <Section
          id="team-stats"
          title="Team stats"
          subtitle={[
            `${statsYear === model.season.year ? 'This season' : `Last season (${seasonLabel(league, statsYear)}), until every team has played a few games`}, regular season. Sort by any column. Opp. Elo is how strong the teams each has played are.`,
            'Home and road leave out neutral-site games.',
            overtimeNote(league.id),
            metricGroup?.note
          ]
            .filter(Boolean)
            .join(' ')}
        >
          <TeamStatsTable league={league.id} rows={teamStats} metrics={metricGroup?.list} metricsName={metricGroup?.name} />
        </Section>
      )}

      <LeagueProjections league={league} view={projection} teams={model.teams} />

      <Section
        id="record"
        title="Track record"
        subtitle={`Every ${league.name} game since ${model.record.seasons[0]?.label ?? 'the start'}, graded against the forecast the app would have shown beforehand. ${pct(
          model.record.overall.accuracy,
          1
        )} correct overall.`}
      >
        <RecordPanel league={league} record={model.record} />
      </Section>
    </div>
  );
}
