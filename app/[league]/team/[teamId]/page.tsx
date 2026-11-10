import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeftRight, ChevronLeft } from 'lucide-react';
import { ordinal, pct, pctCapped, signed } from '../../../../lib/format';
import { SPORT } from '../../../../lib/leagueName';
import { isLeagueId, LEAGUES, seasonLabel } from '../../../../lib/leagues';
import { siteUrl } from '../../../../lib/site';
import { displayColor } from '../../../../lib/teamColor';
import { getLeagueModel, Prediction } from '../../../../lib/model';
import { toCard } from '../../../../lib/model/card';
import { playerDirectory } from '../../../../lib/model/playerIndex';
import { peekSeasonProjection } from '../../../../lib/model/projections';
import { readOddsHistory } from '../../../../lib/model/oddsHistory';
import { scheduleStrength } from '../../../../lib/model/schedule';
import { leagueSheet, neutralGames, overtimeNote, scoreWord, tapeSeason, teamNumbers } from '../../../../lib/model/tape';
import { seasonTeamMetrics } from '../../../../lib/model/teamMetricsLoad';
import { teamTrends, trendSeason } from '../../../../lib/model/trends';
import { formatShortDate } from '../../../../lib/time';
import { ResultBadge } from '../../../components/Badges';
import { CalendarButton } from '../../../components/CalendarButton';
import { FollowButton } from '../../../components/FollowButton';
import { GameCard } from '../../../components/GameCard';
import { InjuryList } from '../../../components/InjuryList';
import { JsonLd } from '../../../components/JsonLd';
import { LocalTime } from '../../../components/LocalTime';
import { PlayerPhoto } from '../../../components/PlayerPhoto';
import { TeamProjection } from '../../../components/Projections';
import { RatingChart } from '../../../components/RatingChart';
import { EmptyState, Section, StatTile } from '../../../components/Section';
import { TeamLogo } from '../../../components/TeamLogo';
import { TeamTrendsPanel } from '../../../components/Trends';
import { OddsChart } from '../../../components/OddsChart';

export const dynamic = 'force-dynamic';

/** Players listed on a team page: a basketball rotation fits easily; football and hockey lists stop at their regulars. */
const ROSTER_MAX = 24;

type Params = { params: Promise<{ league: string; teamId: string }> };

/** "the toughest stretch", "the 4th-toughest stretch", "the 2nd-easiest stretch", "the easiest stretch". */
function stretchLabel(rank: number, of: number) {
  if (rank === 1) return 'the toughest stretch';
  if (rank === of) return 'the easiest stretch';
  return rank <= of / 2 ? `the ${ordinal(rank)}-toughest stretch` : `the ${ordinal(of - rank + 1)}-easiest stretch`;
}

/** Win, loss and tie squares in the form strip. */
const FORM_TONE = { W: 'bg-good/15 text-good ring-good/30', L: 'bg-bad/10 text-bad ring-bad/25', T: 'bg-raised text-ink-3 ring-line' } as const;

async function load({ params }: Params) {
  const { league: id, teamId } = await params;
  if (!isLeagueId(id)) return null;
  const model = await getLeagueModel(id);
  const team = model.teams[teamId];
  return team ? { model, team, league: LEAGUES[id] } : null;
}

export async function generateMetadata(props: Params): Promise<Metadata> {
  const data = await load(props).catch(() => null);
  if (!data) return {};
  return { title: `${data.team.name} predictions`, description: `${data.team.name} forecasts, Elo rating history, injuries and how the model has done on their games.` };
}

export default async function TeamPage(props: Params) {
  const data = await load(props);
  if (!data) notFound();
  const { model, team, league } = data;
  const projection = await peekSeasonProjection(league.id);
  const ranking = model.rankings.find((r) => r.team.id === team.id);
  const games = (model.teamGames[team.id] ?? []).map((id) => model.predictions[id]).filter(Boolean) as Prediction[];
  const upcoming = games.filter((p) => !p.game.completed && p.game.state !== 'post').slice(0, 6);
  const finished = games.filter((p) => p.game.completed);
  const recent = finished.slice(-10).reverse();
  // Early in a season there's too little to grade, so it falls back to the last two seasons.
  const thisSeason = finished.filter((p) => p.game.seasonYear === model.season.year && p.correct !== null);
  const graded = thisSeason.length >= 5 ? thisSeason : finished.filter((p) => p.correct !== null && p.game.seasonYear >= model.season.year - 1);
  const hits = graded.filter((p) => p.correct).length;
  const nextGame = upcoming[0];
  const nextImpacts = nextGame?.injuries ? (nextGame.game.home.teamId === team.id ? nextGame.injuries.home : nextGame.injuries.away) : null;
  const teamCount = model.rankings.length;
  // Team scoring ratings only exist where they beat the league average (not the NHL).
  const scoring = league.scoring.k > 0 && ranking ? ranking : null;
  const rankBy = (value: (r: (typeof model.rankings)[number]) => number) =>
    scoring ? [...model.rankings].sort((a, b) => value(b) - value(a)).findIndex((r) => r.team.id === team.id) + 1 : 0;
  const unit = league.scoreUnit;
  const teamColor = displayColor(team.color, team.altColor);
  const schedule = scheduleStrength(model, team.id);
  // Daily playoff odds this season, once the simulation has run on two days or more.
  const oddsHistory = projection.status === 'ready' ? ((await readOddsHistory(league.id))[projection.season]?.[team.id] ?? []) : [];
  // Records against the closing lines: this season once there are a few games, else last season.
  const trendYear = trendSeason(games, [team.id], model.season.year);
  const trends = teamTrends(
    games.filter((p) => p.game.seasonYear === trendYear),
    team.id
  );
  // Scoring, records and schedule with league ranks: this season once they've played a few, else last season.
  const allGames = Object.values(model.predictions).map((p) => p.game);
  const today = new Date().toISOString();
  const numbersYear = tapeSeason(allGames, [team.id], model.season.year, today);
  const metrics = await seasonTeamMetrics(league, allGames, numbersYear, today);
  const sheet = numbersYear === null ? null : leagueSheet({ teamIds: model.rankings.map((r) => r.team.id), games: allGames, history: model.history, seasonYear: numbersYear, before: today, metrics, league: league.id });
  const numbers = sheet ? teamNumbers(sheet, team.id, scoreWord(unit)) : [];
  const neutral = sheet?.teams[team.id]?.season ? neutralGames(sheet.teams[team.id].season!) : 0;
  const outcome = (p: Prediction) => {
    const us = p.game.home.teamId === team.id ? p.game.home : p.game.away;
    const them = p.game.home.teamId === team.id ? p.game.away : p.game.home;
    return us.score === them.score ? 'T' : (us.score ?? 0) > (them.score ?? 0) ? 'W' : 'L';
  };
  // The next game's chance, from this team's side, for the hero.
  const nextCard = nextGame ? toCard(nextGame) : null;
  const nextChance = nextCard ? (nextCard.home.teamId === team.id ? nextCard.homeProb : 1 - nextCard.homeProb) : null;
  const nextOpponent = nextCard ? (nextCard.home.teamId === team.id ? nextCard.away : nextCard.home) : null;
  // What the next game means for their playoff chances, from the season simulation (regular season only).
  const nextStakes = nextCard && projection.status === 'ready' ? projection.stakes?.[nextCard.id] : undefined;
  const nextStake = nextStakes && nextCard ? (nextCard.home.teamId === team.id ? nextStakes.home : nextStakes.away) : null;
  // Who's played for them lately (or, between seasons, everyone who last played for them).
  const theirs = (await playerDirectory(league, model)).filter((p) => p.team === team.abbr);
  const roster = (theirs.some((p) => p.usage > 0) ? theirs.filter((p) => p.usage > 0) : theirs).slice(0, ROSTER_MAX);

  const site = siteUrl();
  const structured = {
    '@context': 'https://schema.org',
    '@type': 'SportsTeam',
    name: team.name,
    sport: SPORT[league.id],
    url: `${site}/${league.id}/team/${team.id}`,
    ...(team.logo ? { logo: team.logo } : {}),
    memberOf: { '@type': 'SportsOrganization', name: league.fullName },
    athlete: roster.slice(0, 12).map((p) => ({ '@type': 'Person', name: p.name, url: `${site}/${league.id}/player/${p.id}` }))
  };

  return (
    <div className="space-y-6">
      <JsonLd data={structured} />
      <Link href={`/${league.id}#rankings`} className="inline-flex items-center gap-1 text-sm text-ink-2 hover:text-ink">
        <ChevronLeft className="h-4 w-4" aria-hidden /> {league.name} power rankings
      </Link>

      <section className="card relative overflow-hidden p-5 sm:p-7">
        <div
          className="pointer-events-none absolute inset-0 opacity-40"
          style={{ background: `radial-gradient(60% 130% at 0% 20%, ${teamColor}, transparent 70%), linear-gradient(100deg, ${teamColor}33, transparent 60%)` }}
          aria-hidden
        />
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/25 to-transparent" aria-hidden />
        <div className="relative flex flex-col gap-5 sm:flex-row sm:items-center">
          <span
            className="inline-flex h-[112px] w-[112px] shrink-0 items-center justify-center rounded-full ring-1 ring-inset ring-white/10"
            style={{ background: `radial-gradient(circle at 50% 35%, ${teamColor}66, ${teamColor}1a 70%)`, boxShadow: `0 0 48px -10px ${teamColor}99` }}
          >
            <TeamLogo src={team.logo} abbr={team.abbr} size={80} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="eyebrow">
              {league.name} · {model.season.label}
            </p>
            <h1 className="mt-1 font-display text-3xl font-semibold tracking-tight text-ink sm:text-4xl">{team.name}</h1>
            <p className="mt-1 text-ink-2">
              {ranking?.record ? `${ranking.record}${ranking.recordSeason && ranking.recordSeason !== model.season.label ? ` in ${ranking.recordSeason}` : ''}` : 'No record yet'}
              {ranking && ` · #${ranking.rank} of ${teamCount} by Elo`}
            </p>
          </div>
          <div className="flex flex-col gap-3 sm:items-end">
            {nextCard && nextOpponent && nextChance !== null && (
              <Link
                href={`/${league.id}/game/${nextCard.id}`}
                className="flex items-center gap-3 rounded-2xl bg-bg/40 px-4 py-3 ring-1 ring-line backdrop-blur-sm transition hover:ring-accent/50"
              >
                <span className="text-left">
                  <span className="block text-[11px] font-medium uppercase tracking-wider text-ink-3">Next game</span>
                  <span className="flex items-center gap-1.5 text-sm text-ink-2">
                    {nextCard.home.teamId === team.id ? 'vs' : '@'}
                    <TeamLogo src={nextOpponent.logo} abbr={nextOpponent.abbr} size={18} />
                    <span className="font-medium text-ink">{nextOpponent.abbr}</span>· <LocalTime iso={nextCard.date} />
                  </span>
                  {nextStake && (
                    <span className="mt-0.5 block text-[11px] text-ink-3 tabular">
                      Playoffs: {pctCapped(nextStake.ifWin)} with a win, {pctCapped(nextStake.ifLoss)} with a loss
                    </span>
                  )}
                </span>
                <span className="ml-2 text-right">
                  <span className={`block font-display text-3xl font-bold leading-none tabular ${nextChance >= 0.5 ? 'text-ink' : 'text-ink-2'}`}>{pct(nextChance)}</span>
                  <span className="text-[11px] text-ink-3">to win</span>
                </span>
              </Link>
            )}
            <div className="flex flex-wrap gap-2">
              <FollowButton league={league.id} teamId={team.id} name={team.name} />
              <CalendarButton team={`${league.id}:${team.id}`} />
              <Link
                href={`/matchup?league=${league.id}&a=${team.id}`}
                className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium text-ink-2 ring-1 ring-line transition hover:bg-raised hover:text-ink"
              >
                <ArrowLeftRight className="h-4 w-4" aria-hidden /> Matchup
              </Link>
              {projection.status === 'ready' && (
                <Link
                  href={`/${league.id}/playoffs?team=${team.id}`}
                  className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium text-ink-2 ring-1 ring-line transition hover:bg-raised hover:text-ink"
                >
                  What if they win out?
                </Link>
              )}
            </div>
          </div>
        </div>
      </section>

      <div className={`grid grid-cols-2 gap-3 ${scoring ? 'lg:grid-cols-3' : 'lg:grid-cols-4'}`}>
        <StatTile label="Elo rating" value={ranking ? Math.round(ranking.rating) : '—'} sub={ranking ? `#${ranking.rank} of ${teamCount} · 1500 is average` : undefined} />
        <StatTile
          label="Market rating"
          value={ranking ? Math.round(ranking.marketRating) : '—'}
          sub={ranking ? `#${ranking.marketRank} of ${teamCount} by recent lines` : undefined}
        />
        <StatTile
          label="This season"
          value={ranking && ranking.trend.length > 1 ? signed(ranking.seasonChange) : '—'}
          sub="Elo change since opening night"
        />
        <StatTile
          label="Forecasts on their games"
          value={graded.length ? pct(hits / graded.length, 0) : '—'}
          sub={graded.length ? `${hits}–${graded.length - hits} ${thisSeason.length >= 5 ? 'this season' : 'last two seasons'}` : 'No graded games yet'}
        />
        {scoring && (
          <>
            <StatTile
              label="Offense"
              value={`${signed(scoring.offense, 1)} ${unit}`}
              sub={`#${rankBy((r) => r.offense)} of ${teamCount} · scored a game above average`}
            />
            <StatTile
              label="Defense"
              value={`${signed(-scoring.defense, 1)} ${unit}`}
              sub={`#${rankBy((r) => -r.defense)} of ${teamCount} · allowed a game below average`}
            />
          </>
        )}
      </div>

      {numbers.length > 0 && numbersYear !== null && (
        <Section
          title="By the numbers"
          subtitle={[
            `${numbersYear === model.season.year ? 'This season' : `Last season (${seasonLabel(league, numbersYear)})`}, regular season, each with its league rank. Scoring and margin are a game; opponent Elo is how strong the teams they've played are.`,
            neutral > 0 && `Home and road leave out their ${neutral === 1 ? 'neutral-site game' : `${neutral} neutral-site games`}.`,
            overtimeNote(league.id)
          ]
            .filter(Boolean)
            .join(' ')}
        >
          <dl className="grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-3 xl:grid-cols-7">
            {numbers.map(({ id, label, side }) => (
              <div key={id} className="min-w-0">
                <dt className="text-xs text-ink-3">{label}</dt>
                <dd className="mt-1 font-display text-xl font-semibold text-ink tabular">{side.value}</dd>
                <dd className="text-xs text-ink-3 tabular">
                  {ordinal(side.rank)}
                  {id === 'allowed' ? ' fewest' : id === 'schedule' ? ' toughest' : ''} of {side.of}
                </dd>
              </div>
            ))}
          </dl>
        </Section>
      )}

      <TeamProjection league={league} view={projection} teamId={team.id} teams={model.teams} />

      {oddsHistory.length >= 2 && (
        <Section
          title="Playoff chances this season"
          subtitle={`Their chance to make the playoffs from each day's simulation of the rest of the season, since ${formatShortDate(`${oddsHistory[0].date}T16:00:00Z`)}. Now ${pct(oddsHistory[oddsHistory.length - 1].playoffs)}.`}
        >
          <OddsChart points={oddsHistory} color={teamColor} label={`${team.shortName} playoff chances`} />
        </Section>
      )}

      <Section
        title="Upcoming"
        subtitle={
          upcoming.length
            ? `Forecasts for their next games.${
                schedule && schedule.games >= 2
                  ? ` Their next ${schedule.games} opponents average ${Math.round(schedule.average)} Elo, ${stretchLabel(schedule.rank, schedule.of)} of the league's ${schedule.of}.`
                  : ''
              }`
            : undefined
        }
      >
        {upcoming.length ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {upcoming.map((p) => (
              <GameCard key={p.game.id} card={toCard(p)} />
            ))}
          </div>
        ) : (
          <EmptyState>No games scheduled in the next {league.upcomingDays} days.</EmptyState>
        )}
      </Section>

      {roster.length > 0 && (
        <Section title="Players" subtitle="Who's been playing, busiest first. Each has projections, prop lines and recent games against the line.">
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {roster.map((p) => (
              <li key={p.id}>
                <Link href={`/${league.id}/player/${p.id}`} className="flex items-center gap-3 rounded-xl px-2 py-1.5 ring-1 ring-line transition hover:bg-raised hover:ring-line-strong">
                  <PlayerPhoto league={league.id} id={p.id} name={p.name} size={36} ring={teamColor} />
                  <span className="truncate text-sm font-medium text-ink">{p.name}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="Rating history" subtitle="Elo over the last two seasons. The dashed line is league average.">
        <RatingChart series={[{ label: team.shortName, points: model.history[team.id] ?? [], color: teamColor }]} />
      </Section>

      {trends.ats.w + trends.ats.l + trends.ats.p > 0 && (
        <Section title="Against the line" subtitle={`${trendYear === model.season.year ? 'This season' : `Last season (${seasonLabel(league, trendYear)})`}, against each game's closing spread and total.`}>
          <TeamTrendsPanel league={league.id} trends={trends} />
        </Section>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Section title="Recent results" subtitle="Last ten games and whether the forecast hit.">
          {recent.length ? (
            <>
              {/* Their form at a glance, oldest first, so it reads left to right like a season. */}
              <p className="sr-only">Last {recent.length}, oldest first: {[...recent].reverse().map(outcome).join(' ')}</p>
              <ol className="mb-3 flex gap-1" aria-hidden>
                {[...recent].reverse().map((p) => {
                  const o = outcome(p);
                  return (
                    <li key={p.game.id} className={`flex h-7 flex-1 items-center justify-center rounded-md text-[11px] font-bold ring-1 ${FORM_TONE[o]}`}>
                      {o}
                    </li>
                  );
                })}
              </ol>
              <ul className="divide-y divide-line text-sm">
                {recent.map((p) => {
                  const isHome = p.game.home.teamId === team.id;
                  const us = isHome ? p.game.home : p.game.away;
                  const them = isHome ? p.game.away : p.game.home;
                  const o = outcome(p);
                  const pickedUs = (p.pick === 'home') === isHome;
                  return (
                    <li key={p.game.id}>
                      <Link href={`/${league.id}/game/${p.game.id}`} className="flex items-center gap-3 rounded-lg px-1 py-2 hover:bg-raised">
                        <span className={`w-5 text-center font-semibold ${o === 'T' ? 'text-ink-3' : o === 'W' ? 'text-good' : 'text-bad'}`}>{o}</span>
                        <TeamLogo src={them.logo} abbr={them.abbr} size={20} />
                        <span className="flex-1 truncate text-ink-2">
                          {isHome ? 'vs' : '@'} {them.abbr}{' '}
                          <span className="tabular">
                            {us.score}–{them.score}
                          </span>
                        </span>
                        <span className="hidden text-xs text-ink-3 sm:inline">
                          Picked {pickedUs ? team.abbr : them.abbr} {pct(p.pickProb)}
                        </span>
                        <span className="text-xs text-ink-3">{formatShortDate(p.game.date)}</span>
                        <ResultBadge correct={p.correct} />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </>
          ) : (
            <EmptyState>No games played in the window yet.</EmptyState>
          )}
        </Section>

        <Section title="Injury report" subtitle={nextImpacts ? 'Current ESPN report, with what the model subtracts for their next game.' : 'Current ESPN report.'}>
          <InjuryList report={model.injuries[team.id] ?? []} impacts={nextImpacts} limit={20} />
        </Section>
      </div>
    </div>
  );
}
