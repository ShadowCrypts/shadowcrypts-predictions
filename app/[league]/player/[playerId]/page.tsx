import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeftRight, ChevronLeft } from 'lucide-react';
import { pctCapped, shortStatus } from '../../../../lib/format';
import { SPORT } from '../../../../lib/leagueName';
import { isLeagueId, LEAGUES } from '../../../../lib/leagues';
import { siteUrl } from '../../../../lib/site';
import { displayColor } from '../../../../lib/teamColor';
import { getLeagueModel } from '../../../../lib/model';
import { gameLiveProps } from '../../../../lib/model/gameLiveProps';
import { gamePropBoard } from '../../../../lib/model/gamePropBoard';
import { HIT_GAMES } from '../../../../lib/model/hitRateRecord';
import { formatAmerican } from '../../../../lib/model/market';
import { currentTeams } from '../../../../lib/model/playerIndex';
import { liveGameOf, nextGameRow, PlayerGame, playerLog } from '../../../../lib/model/playerLog';
import { propEngine } from '../../../../lib/model/propEngines';
import { playerSplits } from '../../../../lib/model/splits';
import { marketLabel, PropMarket } from '../../../../lib/props';
import { formatShortDate, renderedAt } from '../../../../lib/time';
import { AutoRefresh } from '../../../components/AutoRefresh';
import { FollowPlayerButton } from '../../../components/FollowPlayerButton';
import { GameLogChart } from '../../../components/GameLogChart';
import { JsonLd } from '../../../components/JsonLd';
import { LineLadder } from '../../../components/LineLadder';
import { LocalTime } from '../../../components/LocalTime';
import { PlayerNextGame } from '../../../components/PlayerNextGame';
import { PlayerPhoto } from '../../../components/PlayerPhoto';
import { EmptyState, Section } from '../../../components/Section';
import { TeamLogo } from '../../../components/TeamLogo';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ league: string; playerId: string }> };

/** Games against his next opponent shown at most. */
const VERSUS_GAMES = 6;
/** Games read for his splits: enough for this season and last. */
const SPLIT_GAMES = 200;

/** The injury report's status as a badge: out in red, doubtful or questionable in amber, the rest plain. */
function injuryTone(status: string) {
  const s = status.toLowerCase();
  if (s === 'out' || s.includes('injured reserve') || s.includes('suspension')) return 'bg-bad/15 text-bad';
  if (s.includes('doubtful') || s.includes('questionable') || s.includes('day-to-day')) return 'bg-warn/15 text-warn';
  return 'bg-raised text-ink-2';
}

/** Games as rows, each stat next to that game's line (green over, red under), with average rows under them. */
function GamesTable({ league, games, columns, averages }: { league: string; games: PlayerGame[]; columns: PropMarket[]; averages: { label: string; games: PlayerGame[] }[] }) {
  return (
    <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <table className="w-full min-w-[520px] text-left text-sm tabular">
        <thead>
          <tr className="border-b border-line text-xs text-ink-3">
            <th className="py-2 pr-3 font-medium">Game</th>
            <th className="py-2 pr-3 font-medium">Role</th>
            {columns.map((m) => (
              <th key={m} className="py-2 pr-3 text-right font-medium">
                {marketLabel(m).short}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {games.map((g) => (
            <tr key={g.gameId} className="border-b border-line/60 last:border-0">
              <td className="whitespace-nowrap py-2 pr-3">
                <Link href={`/${league}/game/${g.gameId}`} className="text-ink hover:underline">
                  {formatShortDate(g.date)} {g.home ? 'vs' : '@'} {g.opponent}
                </Link>
              </td>
              <td className="whitespace-nowrap py-2 pr-3 text-xs text-ink-3">{g.detail ?? '—'}</td>
              {columns.map((m) => {
                const value = g.stats[m];
                const line = g.lines[m];
                const tone = line && value !== undefined && value !== line.line ? (value > line.line ? 'text-good' : 'text-bad') : 'text-ink';
                return (
                  <td key={m} className="py-2 pr-3 text-right">
                    <span className={`font-semibold ${tone}`}>{value ?? '—'}</span>
                    {line && (
                      <span className="ml-1 text-xs text-ink-3" title={`${line.book}: over ${formatAmerican(line.over)}, under ${formatAmerican(line.under)}`}>
                        / {line.line}
                      </span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
        {averages.length > 0 && (
          <tfoot>
            {averages.map((row, i) => (
              <tr key={row.label} className={`text-xs text-ink-2 ${i === 0 ? 'border-t border-line-strong' : ''}`}>
                <th scope="row" colSpan={2} className="py-2 pr-3 text-left font-medium">
                  {row.label}
                </th>
                {columns.map((m) => {
                  const values = row.games.map((g) => g.stats[m]).filter((v): v is number => v !== undefined);
                  return (
                    <td key={m} className="py-2 pr-3 text-right font-semibold text-ink">
                      {values.length ? (values.reduce((a, b) => a + b, 0) / values.length).toFixed(1) : '—'}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tfoot>
        )}
      </table>
    </div>
  );
}

async function load({ params }: Params) {
  const { league: id, playerId } = await params;
  if (!isLeagueId(id)) return null;
  const league = LEAGUES[id];
  if (!propEngine(league)) return null;
  const model = await getLeagueModel(league.id);
  const log = await playerLog(league, model, playerId);
  return log ? { league, model, log } : null;
}

export async function generateMetadata(props: Params): Promise<Metadata> {
  const data = await load(props);
  if (!data) return { title: 'Player not found' };
  const next = nextGameRow(data.model, data.log.id);
  const engine = propEngine(data.league)!;
  // The next game and his headline lines, as people search for them ("Nikola Jokic props, Nuggets vs Pelicans, Oct 28").
  const lines = next
    ? engine.markets
        .flatMap((m) => (next.row.cells[m]?.line ? [`${marketLabel(m).long} ${next.row.cells[m]!.line!.line}`] : []))
        .slice(0, 3)
        .join(', ')
    : '';
  return {
    title: next ? `${data.log.name} props, ${next.game.away.shortName} vs ${next.game.home.shortName}, ${formatShortDate(next.game.date)}` : `${data.log.name} props`,
    description: next && lines
      ? `${data.log.name}'s lines for ${next.game.away.abbr} @ ${next.game.home.abbr}: ${lines}, with our projection, the real chance of each over and his recent games against the line.`
      : `${data.log.name}'s projections, prop lines and recent games against the line.`
  };
}

export default async function PlayerPage(props: Params) {
  const data = await load(props);
  if (!data) notFound();
  const { league, model, log } = data;
  const engine = propEngine(league)!;

  // His next game on the board: projections next to the book's lines, or our projections alone until lines go up.
  const next = nextGameRow(model, log.id);
  const nextGame = next?.game;
  const lined = !!next && Object.values(next.row.cells).some((c) => c?.line);
  // His current team: the roster he's on today, else the one he's lined up with next, else the one he last played for.
  const team = model.teams[(await currentTeams(league, model)).get(log.id) ?? next?.row?.teamId ?? log.teamId];
  // His team's game in progress, if any: the game page tracks his stats live.
  const liveGame = team ? await liveGameOf(league.id, model, team.id).catch(() => null) : null;
  // While it's on: his stat so far against each of that game's lines, and the live chance of each over (the game page's numbers).
  const liveBoard = liveGame ? await gamePropBoard(league, model, liveGame).catch(() => null) : null;
  const liveRow = liveBoard?.rows.find((r) => r.id === log.id) ?? null;
  const liveCells = liveGame && liveBoard && liveRow ? ((await gameLiveProps(league, liveGame, liveBoard).catch(() => null))?.cells[log.id] ?? null) : null;
  const liveLines = liveRow ? engine.markets.flatMap((m) => (liveRow.cells[m]?.line ? [{ market: m, line: liveRow.cells[m]!.line!, now: liveCells?.[m] ?? null }] : [])) : [];
  // On the current injury report? Books void a player who doesn't play, but a limited one still counts.
  const injury = team ? (model.injuries[team.id] ?? []).find((i) => i.athleteId === log.id) : undefined;
  const ruledOut = injury?.status.toLowerCase() === 'out' || next?.row.available === 0;
  const teamColor = displayColor(team?.color, team?.altColor);
  // His last few games against his next opponent, from every stored season.
  const opponent = nextGame && team ? (nextGame.home.teamId === team.id ? nextGame.away : nextGame.home) : null;
  const versus = opponent ? await playerLog(league, model, log.id, VERSUS_GAMES, (g) => g.opponent === opponent.abbr).catch(() => null) : null;

  // Columns: the markets he actually logs, in the league's order.
  const columns = engine.markets.filter((m) => log.games.some((g) => g.stats[m] !== undefined && (g.stats[m] ?? 0) > 0 || g.lines[m])).slice(0, 5);
  // Everything on file for the splits: a full season and more, beyond the recent games listed here.
  const splits = playerSplits((await playerLog(league, model, log.id, SPLIT_GAMES).catch(() => null))?.games ?? log.games, columns, model.season.year);
  // Averages over the games shown, and over this season's alone when they span two.
  const thisSeason = log.games.filter((g) => g.seasonYear === model.season.year);
  const averageRows = [
    ...(thisSeason.length && thisSeason.length < log.games.length
      ? [{ label: `This season, ${thisSeason.length} ${thisSeason.length === 1 ? 'game' : 'games'}`, games: thisSeason }]
      : []),
    { label: `Average, these ${log.games.length} games`, games: log.games }
  ];
  const vsLine = columns
    .map((m) => {
      const lined = log.games.filter((g) => g.lines[m] && g.stats[m] !== undefined && g.stats[m] !== g.lines[m]!.line);
      return { market: m, n: lined.length, overs: lined.filter((g) => g.stats[m]! > g.lines[m]!.line).length };
    })
    .filter((x) => x.n >= 3);

  const site = siteUrl();
  const structured = {
    '@context': 'https://schema.org',
    '@type': 'Person',
    name: log.name,
    url: `${site}/${league.id}/player/${log.id}`,
    ...(team ? { memberOf: { '@type': 'SportsTeam', name: team.name, sport: SPORT[league.id], url: `${site}/${league.id}/team/${team.id}` } } : {})
  };

  return (
    <div className="space-y-6">
      <JsonLd data={structured} />
      <Link href="/props" className="inline-flex items-center gap-1 text-sm text-ink-2 hover:text-ink">
        <ChevronLeft className="h-4 w-4" aria-hidden /> All player props
      </Link>

      <section className="card relative flex flex-col gap-4 overflow-hidden p-5 sm:flex-row sm:items-center sm:p-7">
        <span
          className="pointer-events-none absolute inset-0 opacity-40"
          style={{ background: `radial-gradient(55% 140% at 0% 20%, ${teamColor}, transparent 70%), linear-gradient(100deg, ${teamColor}2e, transparent 55%)` }}
          aria-hidden
        />
        <span className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/25 to-transparent" aria-hidden />
        <span className="relative inline-flex shrink-0 self-start sm:self-auto">
          <span className="rounded-full p-1" style={{ background: `linear-gradient(140deg, ${teamColor}, transparent 75%)`, boxShadow: `0 0 40px -10px ${teamColor}aa` }}>
            <PlayerPhoto league={league.id} id={log.id} name={log.name} size={88} eager />
          </span>
          {team && (
            <span className="absolute -bottom-1 -right-1 rounded-full bg-surface p-0.5 ring-1 ring-line">
              <TeamLogo src={team.logo} abbr={team.abbr} size={24} />
            </span>
          )}
        </span>
        <div className="relative min-w-0">
          <p className="eyebrow">
            {league.name} · {team ? <Link href={`/${league.id}/team/${team.id}`} className="hover:underline">{team.name}</Link> : 'Player'}
          </p>
          <h1 className="mt-1 font-display text-3xl font-semibold tracking-tight text-ink sm:text-4xl">{log.name}</h1>
          <p className="mt-1 text-ink-2">{next?.row?.detail ?? log.games[0]?.detail ?? ''}</p>
          {injury && (
            <p className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm">
              <span className={`rounded-md px-1.5 py-0.5 text-xs font-semibold ${injuryTone(injury.status)}`}>{injury.status}</span>
              {injury.comment && <span className="text-xs text-ink-3">{injury.comment}</span>}
            </p>
          )}
        </div>
        <div className="relative flex flex-wrap gap-2 sm:ml-auto">
          <FollowPlayerButton league={league.id} playerId={log.id} name={log.name} />
          <Link
            href={`/${league.id}/compare?a=${log.id}`}
            className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium text-ink-2 ring-1 ring-line transition hover:bg-raised hover:text-ink"
          >
            <ArrowLeftRight className="h-4 w-4" aria-hidden /> Compare
          </Link>
        </div>
      </section>

      {liveGame && (
        <section aria-labelledby="live-title" className="card relative overflow-hidden p-4 ring-1 ring-live/30 sm:p-5">
          <span className="pointer-events-none absolute inset-0" style={{ background: `radial-gradient(70% 120% at 0% 0%, ${teamColor}26, transparent 60%)` }} aria-hidden />
          <div className="relative flex flex-wrap items-center gap-x-3 gap-y-1">
            <h2 id="live-title" className="inline-flex items-center gap-1.5 text-sm font-semibold text-live">
              <span className="h-2 w-2 animate-pulse rounded-full bg-live" aria-hidden />
              Live: this game so far
            </h2>
            <span className="text-sm text-ink tabular">
              {liveGame.away.abbr} {liveGame.away.score ?? 0} @ {liveGame.home.abbr} {liveGame.home.score ?? 0} · {shortStatus(liveGame.statusDetail)}
            </span>
            <span className="flex items-center gap-3 sm:ml-auto">
              <AutoRefresh live at={renderedAt().toISOString()} everyMs={30_000} />
              <Link href={`/${league.id}/game/${liveGame.id}#props`} className="text-sm text-accent-strong hover:underline">
                Everyone in this game →
              </Link>
            </span>
          </div>
          {liveLines.length ? (
            <ul className="relative mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
              {liveLines.map(({ market, line, now }) => {
                const current = now?.current ?? null;
                const hit = now?.over === 1;
                const progress = current === null ? 0 : Math.min(1, current / Math.max(line.line, 0.5));
                return (
                  <li key={market} className={`rounded-xl p-3 ring-1 ${hit ? 'bg-good/10 ring-good/40' : 'bg-surface/70 ring-line'}`}>
                    <p className="flex items-baseline justify-between gap-2 text-xs text-ink-3">
                      <span className="truncate">{marketLabel(market).short}</span>
                      <span className="tabular">line {line.line}</span>
                    </p>
                    <p className="mt-1 font-display text-3xl font-bold leading-none text-ink tabular">{current ?? '—'}</p>
                    {/* How far to the line, in his team's color (green once it's cleared). */}
                    <span className="mt-2 block h-1.5 overflow-hidden rounded-full bg-track" aria-hidden>
                      <span className={`block h-full rounded-full ${hit ? 'bg-good' : ''}`} style={{ width: `${(progress * 100).toFixed(1)}%`, background: hit ? undefined : teamColor }} />
                    </span>
                    <p className="mt-1.5 text-xs">
                      {current === null ? (
                        <span className="text-ink-3">Hasn&apos;t played yet</span>
                      ) : hit ? (
                        <span className="font-semibold text-good">Over hit</span>
                      ) : now?.over !== null && now?.over !== undefined ? (
                        <span className="text-ink-2">
                          <span className="font-semibold text-ink tabular">{pctCapped(now.over)}</span> over from here
                        </span>
                      ) : (
                        <span className="text-ink-3">Live chance not available</span>
                      )}
                    </p>
                    <p className="text-[11px] text-ink-3 tabular">Pregame {pctCapped(line.forecastOver)}</p>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="relative mt-3 text-sm text-ink-3">
              {liveRow ? 'No lines were posted for him in this game.' : 'He isn’t on this game’s prop board.'} The game page tracks everyone who is.
            </p>
          )}
        </section>
      )}

      <Section
        title={nextGame ? `Next: ${nextGame.away.abbr} @ ${nextGame.home.abbr}` : 'Next game'}
        subtitle={
          nextGame ? (
            lined ? (
              <>
                <LocalTime iso={nextGame.date} />. Over chances follow the book&apos;s number with its margin removed; our projection and model chance sit
                beside it.
              </>
            ) : (
              <>
                <LocalTime iso={nextGame.date} />. Our projections if he plays. No lines yet: books usually post them the day before, and the over
                chances show up here when they do.
              </>
            )
          ) : undefined
        }
      >
        {next?.row && nextGame && (lined || !ruledOut) ? (
          <PlayerNextGame
            row={next.row}
            game={{ league: league.id, id: nextGame.id, label: `${nextGame.away.abbr} @ ${nextGame.home.abbr}`, start: nextGame.date, state: nextGame.state }}
            record={model.record.props ? { league: league.name, ...model.record.props.betting } : null}
            history={log.games.slice(0, HIT_GAMES).map((g) => g.stats)}
          />
        ) : (
          <EmptyState>
            {ruledOut
              ? 'He’s out, per the injury report, and books don’t post lines for a player ruled out.'
              : liveGame
                ? 'Lines for his next game go up after this one, usually the day before it.'
                : 'No lines are posted for his next game yet. Books usually post them the day before.'}
          </EmptyState>
        )}
      </Section>

      {next?.row && nextGame && lined && (
        <Section title="Any line" subtitle="The chance he clears other lines next game, like the alternate lines books sell (25+ points and so on).">
          <LineLadder
            row={next.row}
            game={{ league: league.id, id: nextGame.id, label: `${nextGame.away.abbr} @ ${nextGame.home.abbr}`, start: nextGame.date, state: nextGame.state }}
            spread={{ dispersion: engine.params.dispersion, lineSpread: engine.params.lineSpread }}
          />
        </Section>
      )}

      <Section title="Recent games" subtitle="Newest first. Each stat next to the book's main line that game, where one is on file: green went over, red went under.">
        {log.games.length > 1 && (
          <div className="mb-6">
            <GameLogChart
              games={log.games.map((g) => ({
                gameId: g.gameId,
                date: formatShortDate(g.date),
                opponent: `${g.home ? 'vs' : '@'} ${g.opponent}`,
                stats: g.stats,
                line: Object.fromEntries(Object.entries(g.lines).map(([m, l]) => [m, l!.line]))
              }))}
              markets={columns}
              next={Object.fromEntries(Object.entries(next?.row.cells ?? {}).flatMap(([m, c]) => (c?.line ? [[m, c.line.line]] : [])))}
            />
          </div>
        )}
        {log.games.length ? (
          <GamesTable league={league.id} games={log.games} columns={columns} averages={log.games.length > 1 ? averageRows : []} />
        ) : (
          <EmptyState>No recent games on file.</EmptyState>
        )}
        {vsLine.length > 0 && (
          <p className="mt-4 text-sm text-ink-2">
            Against the line in these games:{' '}
            {vsLine.map((v, i) => (
              <span key={v.market}>
                {i > 0 && ' · '}
                {marketLabel(v.market as PropMarket).short} over {v.overs} of {v.n}
              </span>
            ))}
            . A handful of games says little: books move the line to his recent form, which is why streaks like these rarely carry on.
          </p>
        )}
      </Section>

      {splits.rows.length > 1 && columns.length > 0 && (
        <Section
          title="Splits"
          subtitle={`What he's averaged, cut a few ways: a description of past games, not a forecast. Home and road cover ${splits.scope}, leaving out neutral sites.`}
        >
          <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
            <table className="w-full min-w-[480px] text-left text-sm tabular">
              <thead>
                <tr className="border-b border-line text-xs text-ink-3">
                  <th scope="col" className="py-2 pr-3 font-medium">
                    Split
                  </th>
                  <th scope="col" className="py-2 pr-3 text-right font-medium">
                    Games
                  </th>
                  {columns.map((m) => (
                    <th key={m} scope="col" className="py-2 pr-3 text-right font-medium">
                      {marketLabel(m).short}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {splits.rows.map((row) => (
                  <tr key={row.id} className="border-b border-line/60 last:border-0">
                    <th scope="row" className="whitespace-nowrap py-2 pr-3 font-medium text-ink-2">
                      {row.label}
                    </th>
                    <td className="py-2 pr-3 text-right text-ink-3">{row.games}</td>
                    {columns.map((m) => (
                      <td key={m} className="py-2 pr-3 text-right font-semibold text-ink">
                        {row.averages[m]?.toFixed(1) ?? '—'}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      {opponent && versus && versus.games.length > 0 && (
        <Section
          title={`Against ${opponent.shortName}`}
          subtitle={`His last ${versus.games.length === 1 ? 'game' : `${versus.games.length} games`} against his next opponent, newest first, back through the seasons on file. A few games against one team is a small sample, and rosters change between seasons.`}
        >
          <GamesTable
            league={league.id}
            games={versus.games}
            columns={columns}
            averages={versus.games.length > 1 ? [{ label: `Average, these ${versus.games.length} games`, games: versus.games }] : []}
          />
        </Section>
      )}
    </div>
  );
}
