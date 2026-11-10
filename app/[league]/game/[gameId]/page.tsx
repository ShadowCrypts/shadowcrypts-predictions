import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ChevronLeft } from 'lucide-react';
import type { Game, GameSide } from '../../../../lib/espn';
import { pct, pctCapped, signed, spreadLabel } from '../../../../lib/format';
import { isLeagueId, LeagueConfig, LEAGUES, seasonLabel } from '../../../../lib/leagues';
import { getLeagueModel, LeagueModel, Prediction } from '../../../../lib/model';
import { CardSide, toCard } from '../../../../lib/model/card';
import { readEspnLedger } from '../../../../lib/model/espnLedger';
import { whyForecast } from '../../../../lib/model/explain';
import { leagueSheet, scoreWord, tapeNote, tapeRows, tapeSeason } from '../../../../lib/model/tape';
import { seasonTeamMetrics } from '../../../../lib/model/teamMetricsLoad';
import { teamTrends, trendSeason } from '../../../../lib/model/trends';
import { playFlow, turningPoints } from '../../../../lib/model/turningPoints';
import { freshen } from '../../../../lib/model/fresh';
import { gameLiveProps } from '../../../../lib/model/gameLiveProps';
import { recentForm as playersRecentForm, recentGames } from '../../../../lib/model/playerIndex';
import { HIT_GAMES } from '../../../../lib/model/hitRateRecord';
import { gameFlow, LIVE, liveNow, remainingNow } from '../../../../lib/model/live';
import { getGameCenter } from '../../../../lib/gamecenter';
import { readMovement } from '../../../../lib/model/movement';
import { fairAmerican, formatAmerican } from '../../../../lib/model/market';
import { peekSeasonProjection } from '../../../../lib/model/projections';
import type { ProjectedScore } from '../../../../lib/model/scoring';
import type { PropRecord } from '../../../../lib/model/propModel';
import type { PropCell } from '../../../../lib/model/propBoard';
import { gamePropBoard } from '../../../../lib/model/gamePropBoard';
import { hasPropModel, PropMarket } from '../../../../lib/props';
import { SPORT } from '../../../../lib/leagueName';
import { siteUrl } from '../../../../lib/site';
import { formatLongDay, formatShortDate, formatTime, renderedAt } from '../../../../lib/time';
import { AutoRefresh } from '../../../components/AutoRefresh';
import { BandChip, ResultBadge } from '../../../components/Badges';
import { FollowButton } from '../../../components/FollowButton';
import { StatusLine } from '../../../components/GameCard';
import { InjuryList } from '../../../components/InjuryList';
import { JsonLd } from '../../../components/JsonLd';
import { LineupPanel } from '../../../components/LineupPanel';
import { LocalTime } from '../../../components/LocalTime';
import { GameCenter } from '../../../components/GameCenter';
import { MovementChart } from '../../../components/MovementChart';
import { PickButtons } from '../../../components/PickButtons';
import { MoneylineLegs } from '../../../components/MoneylineLegs';
import { PlayerProps } from '../../../components/PlayerProps';
import { WhatIf, WhatIfRow } from '../../../components/WhatIf';
import { GameSeries } from '../../../components/Projections';
import { PlayoffStakes } from '../../../components/PlayoffStakes';
import { WinProbChart } from '../../../components/WinProbChart';
import { PlayFlowChart } from '../../../components/PlayFlowChart';
import { ProbabilityMeter } from '../../../components/ProbabilityMeter';
import { RatingChart } from '../../../components/RatingChart';
import { EmptyState, Section } from '../../../components/Section';
import { ShareButton } from '../../../components/ShareButton';
import { TeamLogo } from '../../../components/TeamLogo';
import { GameTrends } from '../../../components/Trends';
import { TaleOfTheTape } from '../../../components/TaleOfTheTape';
import { TurningPoints } from '../../../components/TurningPoints';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ league: string; gameId: string }> };

async function load({ params }: Params) {
  const { league: id, gameId } = await params;
  if (!isLeagueId(id)) return null;
  const model = await getLeagueModel(id);
  const found = model.predictions[gameId];
  if (!found) return null;
  // The latest score, clock and status while it's on (the model can be a couple of minutes behind).
  const [prediction] = await freshen(id, [found]);
  return { model, prediction, league: LEAGUES[id] };
}

export async function generateMetadata(props: Params): Promise<Metadata> {
  const data = await load(props).catch(() => null);
  if (!data) return {};
  const { game, pick, pickProb, correct } = data.prediction;
  const pickSide = pick === 'home' ? game.home : game.away;
  if (game.completed && game.home.score !== null && game.away.score !== null) {
    // Once it's over, people search for the result: "Thunder 115, Cavaliers 112 (Nov 2)".
    return {
      title: `${game.away.shortName} ${game.away.score}, ${game.home.shortName} ${game.home.score}: result and forecast, ${formatShortDate(game.date)}`,
      description: `${data.league.name} final, ${formatLongDay(game.date)}: ${game.away.name} ${game.away.score}, ${game.home.name} ${game.home.score}. The forecast had ${pickSide.name} at ${pct(pickProb)}${
        correct === null ? '' : correct ? ' and called it' : ' and missed'
      }. With the box score leaders${hasPropModel(data.league) ? ', the turning points and every player prop graded' : ''}.`
    };
  }
  return {
    // Names as people search them: "Nuggets vs Pelicans prediction, Oct 28".
    title: `${game.away.shortName} vs ${game.home.shortName} prediction, ${formatShortDate(game.date)}`,
    description: `${data.league.name}: ${game.away.name} at ${game.home.name}, ${formatLongDay(game.date)}. Forecast: ${pickSide.name} ${pct(pickProb)}.`
  };
}

const sideProb = (homeProb: number, which: 'home' | 'away') => (which === 'home' ? homeProb : 1 - homeProb);

/** The sport, as schema.org's structured data names it. */

function TeamBlock({
  side,
  label,
  align,
  league,
  color,
  chance
}: {
  side: GameSide;
  label: string;
  align: 'left' | 'right';
  league: string;
  color: string;
  /** Its win chance, the headline number (null once the game's final). */
  chance: { value: number; picked: boolean; live: boolean } | null;
}) {
  // "Oklahoma City Thunder" minus "Thunder": the city sits above the nickname.
  const place = side.name.endsWith(side.shortName) ? side.name.slice(0, -side.shortName.length).trim() : '';
  return (
    <div className={`flex min-w-0 flex-1 flex-col items-center gap-3 text-center sm:flex-row sm:gap-5 ${align === 'right' ? 'sm:flex-row-reverse sm:text-right' : 'sm:text-left'}`}>
      <span
        className="inline-flex shrink-0 items-center justify-center rounded-full ring-1 ring-inset ring-white/10 sm:h-[104px] sm:w-[104px]"
        style={{ width: 76, height: 76, background: `radial-gradient(circle at 50% 35%, ${color}55, ${color}18 70%)`, boxShadow: `0 0 40px -8px ${color}66` }}
      >
        <span className="sm:hidden">
          <TeamLogo src={side.logo} abbr={side.abbr} size={52} />
        </span>
        <span className="hidden sm:inline-flex">
          <TeamLogo src={side.logo} abbr={side.abbr} size={72} />
        </span>
      </span>
      <div className="min-w-0 max-w-full">
        <p className="truncate text-xs uppercase tracking-wider text-ink-3">
          {label}
          {place && <span className="hidden sm:inline"> · {place}</span>}
        </p>
        <Link
          href={`/${league}/team/${side.teamId}`}
          className="line-clamp-2 block break-words font-display text-base font-semibold leading-tight text-ink hover:underline sm:truncate sm:text-2xl lg:text-3xl"
        >
          {side.shortName}
        </Link>
        {side.record && <p className="text-sm text-ink-3 tabular">{side.record}</p>}
        {chance && (
          <p
            className={`mt-1 font-display font-bold leading-none tabular ${chance.picked ? 'text-4xl text-ink sm:text-6xl' : 'text-3xl text-ink-3 sm:text-5xl'}`}
            title={chance.live ? 'Live win chance' : 'Chance to win'}
          >
            {pctCapped(chance.value)}
          </p>
        )}
      </div>
    </div>
  );
}

/** One of the hero's key numbers. */
function KeyNumber({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="rounded-xl bg-bg/40 px-3 py-2.5 text-center ring-1 ring-line backdrop-blur-sm" title={hint}>
      <dt className="text-[11px] font-medium uppercase tracking-wider text-ink-3">{label}</dt>
      <dd className="mt-0.5 font-display text-base font-semibold text-ink tabular sm:text-lg">{value}</dd>
    </div>
  );
}

function sourceNote(prediction: Prediction) {
  const basis =
    prediction.basis === 'market'
      ? 'Anchored on the betting line, which beat every rating model in testing.'
      : 'No line is posted yet, so this is the pre-line forecast: Elo blended with ratings learned from past lines. It switches to the line once one is posted.';
  switch (prediction.source) {
    case 'logged':
      return `Locked forecast: logged before the game started and graded as-is. ${basis}`;
    case 'live':
      return `Live forecast: refreshes with lines and injury news until the game starts, then locks. ${basis}`;
    default:
      return prediction.game.completed
        ? `Reconstructed from what was known before the game: the ratings at that point${prediction.market ? ' and the closing line' : ''}.`
        : basis;
  }
}

function FactorTable({ prediction }: { prediction: Prediction }) {
  const { game, factors } = prediction;
  const league = LEAGUES[game.league];
  const fmt = (value: number, kind: 'rating' | 'adjustment') => (kind === 'rating' ? Math.round(value).toString() : value === 0 ? '—' : signed(value));
  const favored = prediction.netElo >= 0 ? game.home : game.away;
  const favoriteOf = (homeProb: number) => `${(homeProb >= 0.5 ? game.home : game.away).abbr} ${pct(Math.max(homeProb, 1 - homeProb), 1)}`;
  const pickSide = prediction.pick === 'home' ? game.home : game.away;
  return (
    <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <table className="w-full min-w-[480px] text-sm">
        <thead>
          <tr className="text-left text-xs text-ink-3">
            <th className="pb-2 font-medium">Factor</th>
            <th className="pb-2 text-right font-medium">{game.away.abbr}</th>
            <th className="pb-2 text-right font-medium">{game.home.abbr}</th>
            <th className="pb-2 pl-6 font-medium">Why</th>
          </tr>
        </thead>
        <tbody className="tabular">
          {factors.map((f) => (
            <tr key={f.label} className="border-t border-line align-top">
              <td className="py-2.5 font-medium text-ink">{f.label}</td>
              <td className="py-2.5 text-right text-ink-2">{fmt(f.away, f.kind)}</td>
              <td className="py-2.5 text-right text-ink-2">{fmt(f.home, f.kind)}</td>
              <td className="py-2.5 pl-6 text-xs text-ink-3">{f.detail}</td>
            </tr>
          ))}
          <tr className="border-t border-line-strong">
            <td className="py-2.5 font-semibold text-ink">Elo ratings</td>
            <td colSpan={2} className="whitespace-nowrap py-2.5 text-right font-semibold text-ink">
              {favored.abbr} {signed(Math.abs(prediction.netElo))} Elo
            </td>
            <td className="py-2.5 pl-6 text-xs text-ink-2">{favoriteOf(prediction.modelHomeProb)}</td>
          </tr>
          <tr className="border-t border-line">
            <td className="py-2.5 font-semibold text-ink">Market-implied ratings</td>
            <td colSpan={2} className="whitespace-nowrap py-2.5 text-right font-semibold text-ink">
              {favoriteOf(prediction.marketRatingHomeProb)}
            </td>
            <td className="py-2.5 pl-6 text-xs text-ink-2">Team strength as past closing lines priced it, same game context</td>
          </tr>
          <tr className="border-t border-line">
            <td className="py-2.5 font-semibold text-ink">Pre-line forecast</td>
            <td colSpan={2} className="whitespace-nowrap py-2.5 text-right font-semibold text-ink">
              {favoriteOf(prediction.preLineHomeProb)}
            </td>
            <td className="py-2.5 pl-6 text-xs text-ink-2">
              {Math.round(league.preLine.ratingsShare * 100)}% Elo, {Math.round((1 - league.preLine.ratingsShare) * 100)}% market-implied (log-odds blend)
            </td>
          </tr>
          {prediction.market && (
            <tr className="border-t border-line bg-accent/5">
              <td className="py-2.5 font-semibold text-ink">Forecast</td>
              <td colSpan={2} className="whitespace-nowrap py-2.5 text-right font-semibold text-accent-strong">
                {pickSide.abbr} {pct(prediction.pickProb, 1)}
              </td>
              <td className="py-2.5 pl-6 text-xs text-ink-2">
                {league.modelShare > 0
                  ? `${Math.round((1 - league.modelShare) * 100)}% market, ${Math.round(league.modelShare * 100)}% Elo`
                  : 'Follows the market (vig removed): in testing, adding the ratings made it less accurate'}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function recentForm(model: LeagueModel, teamId: string, before: string) {
  return (model.teamGames[teamId] ?? [])
    .map((id) => model.predictions[id])
    .filter((p) => p && p.game.completed && p.game.date < before)
    .slice(-5)
    .reverse();
}

function FormList({ model, side, before }: { model: LeagueModel; side: GameSide; before: string }) {
  const games = recentForm(model, side.teamId, before);
  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <TeamLogo src={side.logo} abbr={side.abbr} size={22} />
        <h3 className="font-semibold text-ink">
          {side.shortName}
          <span className="font-normal text-ink-3">: last {games.length}</span>
        </h3>
        <span className="ml-auto flex gap-1" aria-hidden>
          {[...games].reverse().map((p) => {
            const us = p.game.home.teamId === side.teamId ? p.game.home : p.game.away;
            const them = p.game.home.teamId === side.teamId ? p.game.away : p.game.home;
            const won = (us.score ?? 0) > (them.score ?? 0);
            return <span key={p.game.id} className={`h-2 w-2 rounded-full ${won ? 'bg-good' : 'bg-bad'}`} />;
          })}
        </span>
      </div>
      <ul className="divide-y divide-line text-sm">
        {games.map((p) => {
          const isHome = p.game.home.teamId === side.teamId;
          const us = isHome ? p.game.home : p.game.away;
          const them = isHome ? p.game.away : p.game.home;
          const won = (us.score ?? 0) > (them.score ?? 0);
          const tie = us.score === them.score;
          return (
            <li key={p.game.id}>
              <Link href={`/${p.game.league}/game/${p.game.id}`} className="flex items-center gap-3 rounded-lg px-1 py-2 hover:bg-raised">
                <span className={`w-5 text-center font-semibold ${tie ? 'text-ink-3' : won ? 'text-good' : 'text-bad'}`}>{tie ? 'T' : won ? 'W' : 'L'}</span>
                <span className="flex-1 text-ink-2">
                  {isHome ? 'vs' : '@'} {them.abbr}{' '}
                  <span className="tabular">
                    {us.score}–{them.score}
                  </span>
                </span>
                <span className="text-xs text-ink-3">{formatShortDate(p.game.date)}</span>
                <ResultBadge correct={p.correct} />
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Player projections next to the books' props for this game; null where there's no player model. */
async function playerPropsFor(league: LeagueConfig, model: LeagueModel, game: Game) {
  const board = await gamePropBoard(league, model, game);
  if (!board) return null;
  // Each player's average over his last few games and his last ten for hit rates, beside the projection (before the game; afterwards they'd include this one).
  const [form, games] = game.state === 'pre' ? await Promise.all([playersRecentForm(league, model).catch(() => null), recentGames(league, model).catch(() => null)]) : [null, null];
  const recent = form ? Object.fromEntries(board.rows.flatMap((r) => (form.has(r.id) ? [[r.id, form.get(r.id)!]] : []))) : null;
  const logs = games ? Object.fromEntries(board.rows.flatMap((r) => (games.has(r.id) ? [[r.id, games.get(r.id)!.slice(0, HIT_GAMES)]] : []))) : null;
  // While it's on: every player's stat so far and the live chance of each over.
  return { board, recent, logs, live: game.state === 'in' ? await gameLiveProps(league, game, board) : null };
}

function propsNote(league: LeagueConfig, book: string | null, record: PropRecord | null) {
  const source = book ? `${book} lines` : 'sportsbook lines once they post';
  const how =
    league.id === 'nba'
      ? 'Projected from minutes and per-minute production'
      : league.id === 'nhl'
        ? "Projected from ice time and per-minute production, and each goalie's expected shots against"
        : "Projected from each player's share of his team's targets, carries and passes";
  if (!record?.lines) return `${how}, next to ${source}. Not betting advice.`;
  const b = record.betting;
  const disagree = b.bets
    ? ` Where our model disagreed with the price by 10+ points (tagged "model"), bets won ${pct(b.won / b.bets)} and returned ${b.returnPerBet >= 0 ? '+' : '−'}${Math.abs(b.returnPerBet * 100).toFixed(1)}% a bet over ${b.bets.toLocaleString()} graded lines.`
    : '';
  return `${how}, next to ${source}. Over chances follow the book's own number with its margin removed, which was the more accurate of the two on ${record.lines.toLocaleString()} graded ${league.name} lines (log loss ${record.logLoss.book.toFixed(3)} vs our model's ${record.logLoss.model.toFixed(3)}).${disagree} Not betting advice.`;
}

function projectionNote(projected: ProjectedScore, total: number | null) {
  const totalPart = projected.totalFrom === 'market' ? `posted total ${total}` : 'total from team scoring ratings';
  return projected.marginFrom === 'spread' ? `Posted spread, ${totalPart}` : `Margin from the forecast, ${totalPart}`;
}

function Stat({ label, value, sub, highlight }: { label: string; value: React.ReactNode; sub?: React.ReactNode; highlight?: boolean }) {
  return (
    <div className={`rounded-xl p-3 ring-1 ${highlight ? 'bg-accent/10 ring-accent/40' : 'bg-raised ring-line'}`}>
      <dt className="text-xs text-ink-3">{label}</dt>
      <dd className="mt-1 font-semibold text-ink tabular">{value}</dd>
      {sub && <dd className="text-xs text-ink-3 tabular">{sub}</dd>}
    </div>
  );
}

export default async function GamePage(props: Params) {
  const data = await load(props);
  if (!data) notFound();
  const { model, prediction, league } = data;
  const { game, market } = prediction;
  const card = toCard(prediction);
  const pickSide = prediction.pick === 'home' ? game.home : game.away;
  const showSpread = league.elo.eloPerPoint !== null;
  const pickOf = (homeProb: number) => sideProb(homeProb, prediction.pick);
  const live = liveNow(league.id, game, prediction.homeProb);
  // The hero's headline numbers: the live chance while it's on, the forecast before.
  const heroHomeProb = live?.homeProb ?? prediction.homeProb;
  const heroPick: 'home' | 'away' = live ? (live.homeProb >= 0.5 ? 'home' : 'away') : prediction.pick;
  // The track record at this pick's confidence: how often favorites at this number have won (given enough games to say).
  const sameConfidence =
    model.record.calibration.find((b) => prediction.pickProb >= b.lo && (prediction.pickProb < b.hi || b.hi === 1) && b.games >= 30) ?? null;
  const flow = game.state === 'pre' ? [] : gameFlow(league.id, game, prediction.homeProb);
  // Playoff games show their series from the bracket simulation; regular-season games still to play, their playoff stakes. Both only when it's this season's and on hand.
  const projection = game.seasonType === 3 || game.state === 'pre' ? await peekSeasonProjection(league.id) : null;
  const thisSeason = projection && 'season' in projection && projection.season === seasonLabel(league, game.seasonYear) ? projection : null;
  const series = game.seasonType === 3 ? thisSeason : null;
  const stakes = game.seasonType === 2 && game.state === 'pre' && thisSeason?.status === 'ready' ? (thisSeason.stakes?.[game.id] ?? null) : null;
  const playoffOdds = (teamId: string) => (thisSeason?.status === 'ready' ? (thisSeason.teams.find((t) => t.id === teamId)?.playoffs ?? null) : null);
  // Box-score leaders and plays, only once there's something to show; a feed hiccup just hides the section.
  const center = game.state === 'pre' ? null : await getGameCenter(league, game.id, game.completed).catch(() => null);
  // The scoring plays that swung the win chance most, from the pregame forecast.
  const swings = center ? turningPoints(league.id, prediction.homeProb, center.scoring) : [];
  // The same plays as a win-probability line (clock sports): finer than a point per period.
  const playPoints = center ? playFlow(league.id, prediction.homeProb, center.scoring) : [];
  const liveSpec = LIVE[league.id];
  const clockSpec = liveSpec.kind === 'clock' ? liveSpec : null;
  const movement = (await readMovement(league.id))[game.id] ?? [];
  const firstLine = movement.find((s) => s.line !== null);
  const espnForecast = (await readEspnLedger(league.id))[game.id]?.homeProb ?? null;
  // A coming game's forecast in plain words; once it's on, the score and the live chance say more.
  const why = game.state === 'pre' ? whyForecast(prediction, { showSpread, movement }) : [];
  const playerProps = await playerPropsFor(league, model, game);
  // Every posted line for the what-if explorer, busiest first by the headline stat's projection.
  const headline = playerProps?.board.markets[0];
  const whatIfRows: WhatIfRow[] = (playerProps?.board.rows ?? [])
    .map((r) => ({
      id: r.id,
      name: r.name,
      teamId: r.teamId,
      projection: headline ? (r.cells[headline]?.projection ?? 0) : 0,
      lines: Object.fromEntries(
        (Object.entries(r.cells) as [PropMarket, PropCell | undefined][]).flatMap(([m, c]) => (c?.line ? [[m, { line: c.line.line, over: c.line.forecastOver }]] : []))
      )
    }))
    .filter((r) => Object.keys(r.lines).length)
    .sort((a, b) => b.projection - a.projection)
    .map(({ projection: _, ...r }) => r);
  const site = siteUrl();
  const team = (side: GameSide) => ({ '@type': 'SportsTeam', name: side.name, url: `${site}/${league.id}/team/${side.teamId}` });
  const event = {
    '@context': 'https://schema.org',
    '@type': 'SportsEvent',
    name: `${game.away.name} at ${game.home.name}`,
    sport: SPORT[league.id],
    startDate: game.date,
    eventStatus: game.state === 'post' && !game.completed ? 'https://schema.org/EventPostponed' : 'https://schema.org/EventScheduled',
    eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
    ...(game.venue ? { location: { '@type': 'Place', name: game.venue } } : {}),
    homeTeam: team(game.home),
    awayTeam: team(game.away),
    competitor: [team(game.home), team(game.away)],
    description: `${league.name} forecast: ${pickSide.name} ${pct(prediction.pickProb)} to win.`,
    url: `${site}/${league.id}/game/${game.id}`
  };

  return (
    <div className="space-y-6">
      <JsonLd data={event} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link href={`/${league.id}`} className="inline-flex items-center gap-1 text-sm text-ink-2 hover:text-ink">
          <ChevronLeft className="h-4 w-4" aria-hidden /> {league.name} games
        </Link>
        <div className="flex items-center gap-2">
          {/* Scores here are read again at most every 15 seconds, so a live page re-checks every 30. */}
          <AutoRefresh live={game.state === 'in'} at={renderedAt().toISOString()} everyMs={30_000} />
          <ShareButton title={`${game.away.abbr} @ ${game.home.abbr}`} text={`${pickSide.name} ${pct(prediction.pickProb)} to win (${league.name}) on ShadowCrypts Predictions:`} />
        </div>
      </div>

      <section aria-labelledby="game-title" className="card relative overflow-hidden p-4 sm:p-6">
        {/* The matchup below says it visually; this names the page for screen readers and outlines. */}
        <h1 id="game-title" className="sr-only">
          {game.away.name} at {game.home.name}, {league.name} forecast
        </h1>
        {/* Each half in its team's color, meeting on a slant, and a soft glow behind each logo. */}
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.22]"
          style={{ background: `linear-gradient(105deg, ${card.away.color} 0%, transparent 48%, transparent 52%, ${card.home.color} 100%)` }}
          aria-hidden
        />
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.3]"
          style={{
            background: `radial-gradient(45% 90% at 8% 40%, ${card.away.color}, transparent 70%), radial-gradient(45% 90% at 92% 40%, ${card.home.color}, transparent 70%)`
          }}
          aria-hidden
        />
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/25 to-transparent" aria-hidden />
        <div className="relative">
          <StatusLine card={card} />
          <div className="mt-6 flex items-center gap-2 sm:gap-6">
            <TeamBlock
              side={game.away}
              label="Away"
              align="left"
              league={league.id}
              color={card.away.color}
              chance={game.completed ? null : { value: 1 - heroHomeProb, picked: heroPick === 'away', live: !!live }}
            />
            <div className="shrink-0 text-center">
              {game.state === 'pre' ? (
                <>
                  <p className="font-display text-xl font-semibold text-ink sm:text-2xl">
                    <LocalTime iso={game.date} show="time" />
                  </p>
                  <p className="text-xs text-ink-3">
                    <LocalTime iso={game.date} show="long-day" />
                  </p>
                </>
              ) : (
                <p className="whitespace-nowrap font-display text-3xl font-semibold text-ink tabular sm:text-5xl">
                  {game.away.score}
                  <span className="mx-1 text-ink-3 sm:mx-2">–</span>
                  {game.home.score}
                </p>
              )}
              <p className="mt-2 inline-flex h-7 min-w-7 items-center justify-center rounded-full bg-raised px-2 text-[11px] font-semibold uppercase tracking-wider text-ink-3 ring-1 ring-line">
                {game.neutral ? 'Neutral' : 'at'}
              </p>
            </div>
            <TeamBlock
              side={game.home}
              label="Home"
              align="right"
              league={league.id}
              color={card.home.color}
              chance={game.completed ? null : { value: heroHomeProb, picked: heroPick === 'home', live: !!live }}
            />
          </div>
          <div className="mt-6">
            {live && <p className="mb-1.5 text-center text-xs font-semibold uppercase tracking-wider text-bad">Live win probability</p>}
            <ProbabilityMeter
              awayAbbr={game.away.abbr}
              homeAbbr={game.home.abbr}
              homeProb={heroHomeProb}
              pick={heroPick}
              size="xl"
              bare={!game.completed}
              colors={{ away: card.away.color, home: card.home.color }}
            />
          </div>
          {game.state === 'pre' && (
            <dl className="mx-auto mt-5 grid max-w-2xl grid-cols-2 gap-2 sm:grid-cols-4">
              <KeyNumber label="The pick" value={`${pickSide.abbr} · ${prediction.band}`} hint={sourceNote(prediction)} />
              <KeyNumber label="Line" value={card.line ?? 'Not yet'} hint={card.line ? 'The posted line (DraftKings via ESPN)' : 'No line posted yet: this is the pre-line forecast'} />
              <KeyNumber
                label="Projected"
                value={card.projected ? `${Math.round(card.projected.away)}–${Math.round(card.projected.home)}` : '—'}
                hint="Projected final score, away–home, consistent with the forecast"
              />
              <KeyNumber
                label="Fair odds"
                value={formatAmerican(fairAmerican(prediction.pickProb))}
                hint={`What ${pickSide.abbr} would pay at a ${pct(prediction.pickProb)} chance with no bookmaker margin`}
              />
            </dl>
          )}
          <div className="mx-auto mt-5 max-w-md">
            <PickButtons
              league={league.id}
              gameId={game.id}
              start={game.date}
              state={game.state}
              away={card.away}
              home={card.home}
              winner={game.completed ? (game.home.score === game.away.score ? null : (game.home.score ?? 0) > (game.away.score ?? 0) ? 'home' : 'away') : undefined}
              modelPick={prediction.pick}
            />
          </div>
          <div className="mt-5 flex flex-wrap items-center justify-center gap-2 text-xs text-ink-3">
            <FollowButton league={league.id} teamId={game.away.teamId} name={game.away.name} />
            <FollowButton league={league.id} teamId={game.home.teamId} name={game.home.name} />
            {(game.venue || game.broadcast || game.weather) && (
              <span className="w-full text-center sm:ml-3 sm:w-auto" title={game.weather ? "Forecast for the game's start, from ESPN's feed" : undefined}>
                {[game.venue, game.broadcast, game.state === 'pre' && game.weather ? `${game.weather.text}, ${game.weather.temperature}°F` : null].filter(Boolean).join(' · ')}
              </span>
            )}
          </div>
        </div>
      </section>

      {why.length > 0 && (
        <Section title="The short version">
          <ul className="max-w-3xl space-y-2 text-sm leading-relaxed text-ink-2">
            {why.map((sentence, i) => (
              <li key={sentence} className={i === 0 ? 'font-medium text-ink' : ''}>
                {sentence}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {series && <GameSeries league={league} view={series} homeId={game.home.teamId} awayId={game.away.teamId} teams={model.teams} />}

      {stakes && thisSeason?.status === 'ready' && playoffOdds(game.away.teamId) !== null && playoffOdds(game.home.teamId) !== null && (
        <PlayoffStakes
          away={card.away}
          home={card.home}
          stakes={stakes}
          now={{ away: playoffOdds(game.away.teamId)!, home: playoffOdds(game.home.teamId)! }}
          sims={thisSeason.sims}
        />
      )}

      {playPoints.length >= 3 && clockSpec ? (
        <Section
          title="Win probability"
          subtitle={`${live ? 'Updating as the game goes. ' : ''}Starts from the pregame forecast, then moves with every score and the time left. Above the line favors ${
            game.home.abbr
          }; hover for each play.`}
        >
          <PlayFlowChart
            points={playPoints}
            end={game.state === 'in' ? Math.max(playPoints[playPoints.length - 1].x, 1 - (remainingNow(league.id, game) ?? 0)) : Math.max(1, playPoints[playPoints.length - 1].x)}
            periods={clockSpec.periods}
            periodName={clockSpec.periodName}
            homeAbbr={game.home.abbr}
            awayAbbr={game.away.abbr}
            colors={{ home: card.home.color, away: card.away.color }}
          />
        </Section>
      ) : (
        flow.length > 2 && (
          <Section
            title="Win probability"
            subtitle={`${
              live ? 'Updating as the game goes. ' : ''
            }Starts from the pregame forecast, then moves with the score and the time left after each ${
              league.id === 'mlb' ? 'inning' : league.id === 'nhl' ? 'period' : 'quarter'
            }. Above the line favors ${game.home.abbr}.`}
          >
            <WinProbChart points={flow} homeAbbr={game.home.abbr} awayAbbr={game.away.abbr} />
          </Section>
        )
      )}

      {movement.length >= 2 && (
        <Section
          title="How the forecast moved"
          subtitle={`${game.home.abbr} went from ${pct(movement[0].p)} to ${pct(movement[movement.length - 1].p)} over ${movement.length} updates${
            firstLine ? `; the betting line was first on file ${formatLongDay(firstLine.t)} at ${formatTime(firstLine.t)}` : ', with no betting line yet'
          }. Updates come from lines, injury news and results elsewhere in the league.`}
        >
          <MovementChart snapshots={movement} start={game.date} asOf={new Date().toISOString()} homeAbbr={game.home.abbr} awayAbbr={game.away.abbr} />
        </Section>
      )}

      {center && (center.leaders.length > 0 || center.recent.length > 0) && (
        <Section title="Game center" subtitle={game.state === 'in' ? 'Live from the ESPN feed, updating with the page.' : 'From the ESPN box score.'}>
          <GameCenter
            center={center}
            away={game.away}
            home={game.home}
            live={game.state === 'in'}
            league={league.id}
            colors={{ away: card.away.color, home: card.home.color }}
          />
        </Section>
      )}

      {swings.length > 0 && (
        <Section
          title="Turning points"
          subtitle={`The ${swings.length === 1 ? 'play' : `${swings.length} plays`} that swung the win chance most${game.state === 'in' ? ' so far' : ''}, each judged at its own moment: the chance with the score just before it against just after.`}
        >
          <TurningPoints points={swings} away={card.away} home={card.home} />
        </Section>
      )}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <Section title="The pick" subtitle={sourceNote(prediction)}>
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-3">
              <TeamLogo src={pickSide.logo} abbr={pickSide.abbr} size={44} />
              <div>
                <p className="font-display text-2xl font-semibold text-ink">
                  {pickSide.shortName} <span className="text-accent-strong tabular">{pct(prediction.pickProb)}</span>
                </p>
                <div className="mt-1 flex items-center gap-2">
                  <BandChip band={prediction.band} />
                  {game.completed && <ResultBadge correct={prediction.correct} />}
                </div>
              </div>
            </div>
            <div>
              <ProbabilityMeter
                awayAbbr={game.away.abbr}
                homeAbbr={game.home.abbr}
                homeProb={prediction.homeProb}
                pick={prediction.pick}
                marker={{ homeProb: prediction.modelHomeProb, label: 'Elo ratings' }}
                size="lg"
              />
              <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-3">
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-4 rounded-full bg-accent" aria-hidden /> Forecast
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-3 w-[3px] rounded-full bg-ink" aria-hidden /> Elo ratings alone
                </span>
              </p>
              {sameConfidence && (
                <p className="mt-3 rounded-lg bg-raised/60 px-3 py-2 text-xs text-ink-2 ring-1 ring-line">
                  <span className="font-semibold text-ink">How often that comes true:</span> {league.name} favorites the forecast gave{' '}
                  {Math.round(sameConfidence.lo * 100)}–{Math.round(sameConfidence.hi * 100)}% have won{' '}
                  <span className="font-semibold text-ink tabular">{pct(sameConfidence.actual, 1)}</span> of {sameConfidence.games.toLocaleString()} graded games.
                </p>
              )}
            </div>
            <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
              <Stat
                label="Market"
                highlight={prediction.basis === 'market'}
                value={
                  market
                    ? showSpread && market.homeSpread !== null
                      ? spreadLabel(game.home.abbr, game.away.abbr, market.homeSpread)
                      : `${pickSide.abbr} ${pct(pickOf(market.homeProb))}`
                    : 'No line yet'
                }
                sub={market ? `ML ${game.away.abbr} ${formatAmerican(market.awayMoneyline)} / ${game.home.abbr} ${formatAmerican(market.homeMoneyline)}` : null}
              />
              <Stat
                label="Pre-line forecast"
                highlight={prediction.basis === 'model'}
                value={`${pickSide.abbr} ${pct(pickOf(prediction.preLineHomeProb))}`}
                sub="Elo + market-implied"
              />
              <Stat
                label="Elo ratings"
                value={showSpread ? spreadLabel(game.home.abbr, game.away.abbr, prediction.modelSpread) : `${pickSide.abbr} ${pct(pickOf(prediction.modelHomeProb))}`}
                sub={showSpread ? `${pickSide.abbr} ${pct(pickOf(prediction.modelHomeProb))}` : null}
              />
              {market && (
                <Stat
                  label="Ratings vs. market"
                  value={`${signed((pickOf(prediction.modelHomeProb) - pickOf(market.homeProb)) * 100, 1)} pts`}
                  sub={`${pickSide.abbr}: Elo ${pct(pickOf(prediction.modelHomeProb), 1)}, market ${pct(pickOf(market.homeProb), 1)}`}
                />
              )}
              <Stat
                label="Fair odds"
                value={`${pickSide.abbr} ${formatAmerican(fairAmerican(prediction.pickProb))}`}
                sub={`${(prediction.pick === 'home' ? game.away : game.home).abbr} ${formatAmerican(fairAmerican(1 - prediction.pickProb))} · the forecast as odds, no margin`}
              />
              {espnForecast !== null && (
                <Stat
                  label="ESPN's forecast"
                  value={`${pickSide.abbr} ${pct(pickOf(espnForecast))}`}
                  sub={
                    <>
                      Their last number before the game.{' '}
                      <Link href="/record#espn" className="underline underline-offset-2 hover:text-ink">
                        Head-to-head
                      </Link>
                    </>
                  }
                />
              )}
              {prediction.projected && (
                <Stat
                  label={game.state === 'pre' ? 'Projected score' : 'Pregame projection'}
                  value={`${game.away.abbr} ${prediction.projected.away.toFixed(1)} – ${prediction.projected.home.toFixed(1)} ${game.home.abbr}`}
                  sub={projectionNote(prediction.projected, market?.overUnder ?? null)}
                />
              )}
            </dl>
            {game.state === 'pre' && market && market.homeMoneyline !== null && market.awayMoneyline !== null && (
              <MoneylineLegs
                league={league.id}
                gameId={game.id}
                game={`${game.away.abbr} @ ${game.home.abbr}`}
                start={game.date}
                book={market.provider}
                sides={[
                  { teamId: game.away.teamId, abbr: game.away.abbr, name: game.away.shortName, prob: 1 - prediction.homeProb, price: market.awayMoneyline },
                  { teamId: game.home.teamId, abbr: game.home.abbr, name: game.home.shortName, prob: prediction.homeProb, price: market.homeMoneyline }
                ]}
              />
            )}
          </div>
        </Section>

        <Section
          title="How the number is built"
          subtitle="Elo inputs in rating points (higher favors that team; 25–28 Elo is about a point of spread in football and basketball), then how the pieces combine."
        >
          <FactorTable prediction={prediction} />
        </Section>
      </div>

      <TapeSection model={model} game={game} league={league} away={card.away} home={card.home} />

      {playerProps && (
        <Section
          id="props"
          title="Player props"
          subtitle={propsNote(league, playerProps.board.book, model.record.props)}
          action={
            <Link href="/parlay" className="text-sm text-ink-2 hover:text-ink hover:underline">
              Your parlay →
            </Link>
          }
        >
          <PlayerProps
            board={playerProps.board}
            teams={{
              home: { id: game.home.teamId, abbr: game.home.abbr, color: card.home.color },
              away: { id: game.away.teamId, abbr: game.away.abbr, color: card.away.color }
            }}
            game={{ league: league.id, id: game.id, label: `${game.away.abbr} @ ${game.home.abbr}`, start: game.date, state: game.state }}
            record={model.record.props ? { league: league.name, ...model.record.props.betting } : null}
            live={playerProps.live}
            recent={playerProps.recent}
            logs={playerProps.logs}
          />
        </Section>
      )}

      {whatIfRows.length > 0 && game.state === 'pre' && (
        <Section title="What if…" subtitle="Pick something that might happen in this game and see how every other line's chance moves if it does.">
          <WhatIf
            league={league.id}
            gameId={game.id}
            home={{ id: game.home.teamId, abbr: game.home.abbr, name: game.home.shortName }}
            away={{ id: game.away.teamId, abbr: game.away.abbr, name: game.away.shortName }}
            homeProb={prediction.homeProb}
            rows={whatIfRows}
          />
        </Section>
      )}

      {prediction.lineups && (
        <Section
          title="Who's playing"
          action={
            <Link href={`/${league.id}/players`} className="text-sm text-ink-2 hover:text-ink hover:underline">
              All player ratings →
            </Link>
          }
          subtitle={
            prediction.lineups.source === 'injury report'
              ? "Each team's projected rotation from its current roster and the latest injury report. Minutes follow each player's usual role, with absent players' minutes handed to the rest. The Elo badge compares tonight's lineup with the team's recent ones."
              : 'Who sat out, from the box score, and what each absence cost against the lineups the team had been playing.'
          }
        >
          <div className="grid gap-6 md:grid-cols-2">
            <LineupPanel league={league.id} side={game.away} team={prediction.lineups.away} color={card.away.color} />
            <LineupPanel league={league.id} side={game.home} team={prediction.lineups.home} color={card.home.color} />
          </div>
        </Section>
      )}

      <Section title="Rating history" subtitle="Each team's Elo over the last two seasons. Hover or drag to compare on any date.">
        <RatingChart
          series={[
            { label: game.away.shortName, points: model.history[game.away.teamId] ?? [], color: card.away.color },
            { label: game.home.shortName, points: model.history[game.home.teamId] ?? [], color: card.home.color }
          ]}
        />
      </Section>

      <div className={`grid grid-cols-1 gap-6 ${game.completed ? '' : 'lg:grid-cols-2'}`}>
        {/* ESPN only publishes the current report, so it would be misleading next to a finished game. */}
        {!game.completed && (
          <Section title="Injury report" subtitle="Current ESPN report. Elo values show what the model subtracts.">
            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
              <InjuryList team={game.away} report={model.injuries[game.away.teamId] ?? []} impacts={prediction.injuries?.away ?? null} />
              <InjuryList team={game.home} report={model.injuries[game.home.teamId] ?? []} impacts={prediction.injuries?.home ?? null} />
            </div>
          </Section>
        )}
        <Section title="Recent form" subtitle="Last five results, and whether the forecast hit.">
          {recentForm(model, game.away.teamId, game.date).length + recentForm(model, game.home.teamId, game.date).length ? (
            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
              <FormList model={model} side={game.away} before={game.date} />
              <FormList model={model} side={game.home} before={game.date} />
            </div>
          ) : (
            <EmptyState>No earlier games in the window.</EmptyState>
          )}
        </Section>
      </div>

      <LineTrends model={model} game={game} away={card.away} home={card.home} />
      <HeadToHead model={model} game={game} />
    </div>
  );
}

/** Both teams side by side coming into the game, every number with its league rank. */
async function TapeSection({ model, game, league, away, home }: { model: LeagueModel; game: Game; league: LeagueConfig; away: CardSide; home: CardSide }) {
  // The scoring model's ratings are as of now, so they only stand next to a game still to finish (and only where they're used: not the NHL).
  const adjusted = !game.completed && league.scoring.k > 0 ? model.scoring.teams : undefined;
  const games = Object.values(model.predictions).map((p) => p.game);
  const seasonYear = tapeSeason(games, [game.away.teamId, game.home.teamId], game.seasonYear, game.date);
  const metrics = await seasonTeamMetrics(league, games, seasonYear, game.date);
  const sheet = leagueSheet({ teamIds: model.rankings.map((r) => r.team.id), games, history: model.history, seasonYear, before: game.date, adjusted, metrics, league: league.id });
  const rows = tapeRows(sheet, game.away.teamId, game.home.teamId, { host: game.neutral ? null : 'right', unit: scoreWord(league.scoreUnit) });
  if (rows.length < 2) return null;
  const when = seasonYear === null || seasonYear === game.seasonYear ? 'This season' : `Last season (${seasonLabel(league, seasonYear)})`;
  return (
    <Section
      title="Tale of the tape"
      subtitle={tapeNote(rows, `${when} coming into the game`, league.id)}
      action={
        <Link
          href={`/matchup?league=${league.id}&a=${game.away.teamId}&b=${game.home.teamId}&venue=${game.neutral ? 'neutral' : 'b'}`}
          className="text-sm text-ink-2 hover:text-ink hover:underline"
        >
          Try another venue →
        </Link>
      }
    >
      <TaleOfTheTape rows={rows} left={away} right={home} />
    </Section>
  );
}

/** Both teams' records against the closing lines coming into this game: this season once each has a few, else last season. */
function LineTrends({ model, game, away, home }: { model: LeagueModel; game: Prediction['game']; away: CardSide; home: CardSide }) {
  const before = Object.values(model.predictions).filter((p) => p.game.date < game.date);
  const year = trendSeason(before, [game.away.teamId, game.home.teamId], game.seasonYear);
  const season = before.filter((p) => p.game.seasonYear === year);
  const awayTrends = teamTrends(season, game.away.teamId);
  const homeTrends = teamTrends(season, game.home.teamId);
  if (awayTrends.ats.w + awayTrends.ats.l + homeTrends.ats.w + homeTrends.ats.l === 0) return null;
  const league = LEAGUES[game.league];
  return (
    <Section title="Against the line" subtitle="How each team has done against the closing spread and total, coming into this game.">
      <GameTrends
        league={game.league}
        away={away}
        home={home}
        awayTrends={awayTrends}
        homeTrends={homeTrends}
        season={year === game.seasonYear ? 'This season' : `Last season (${seasonLabel(league, year)})`}
      />
    </Section>
  );
}

/** Earlier meetings between the two teams in the seasons the model replays, newest first. */
function HeadToHead({ model, game }: { model: LeagueModel; game: Prediction['game'] }) {
  const meetings = (model.teamGames[game.home.teamId] ?? [])
    .map((id) => model.predictions[id])
    .filter((p) => p && p.game.completed && p.game.date < game.date && [p.game.home.teamId, p.game.away.teamId].includes(game.away.teamId))
    .reverse();
  if (!meetings.length) return null;
  const wins = (teamId: string) =>
    meetings.filter((p) => {
      const side = p.game.home.teamId === teamId ? p.game.home : p.game.away;
      const other = p.game.home.teamId === teamId ? p.game.away : p.game.home;
      return (side.score ?? 0) > (other.score ?? 0);
    }).length;
  const hits = meetings.filter((p) => p.correct).length;
  const graded = meetings.filter((p) => p.correct !== null).length;
  return (
    <Section
      title="Head to head"
      subtitle={`${game.away.abbr} ${wins(game.away.teamId)}–${wins(game.home.teamId)} ${game.home.abbr} in their last ${meetings.length} meeting${
        meetings.length === 1 ? '' : 's'
      }${graded ? `; the forecast called ${hits} of ${graded}` : ''}.`}
    >
      <ul className="divide-y divide-line text-sm">
        {meetings.slice(0, 8).map((p) => {
          const winner = (p.game.home.score ?? 0) > (p.game.away.score ?? 0) ? p.game.home : p.game.away;
          return (
            <li key={p.game.id}>
              <Link href={`/${p.game.league}/game/${p.game.id}`} className="flex items-center gap-3 rounded-lg px-1 py-2 hover:bg-raised">
                <span className="w-16 shrink-0 text-xs text-ink-3">{formatShortDate(p.game.date)}</span>
                <TeamLogo src={winner.logo} abbr={winner.abbr} size={20} />
                <span className="flex-1 truncate text-ink-2">
                  {p.game.away.abbr} <span className="tabular">{p.game.away.score}</span> @ {p.game.home.abbr}{' '}
                  <span className="tabular">{p.game.home.score}</span>
                  {p.game.seasonType === 3 && <span className="ml-2 text-xs text-ink-3">Playoffs</span>}
                </span>
                <span className="hidden text-xs text-ink-3 sm:inline">
                  Picked {(p.pick === 'home' ? p.game.home : p.game.away).abbr} {pct(p.pickProb)}
                </span>
                <ResultBadge correct={p.correct} />
              </Link>
            </li>
          );
        })}
      </ul>
    </Section>
  );
}
