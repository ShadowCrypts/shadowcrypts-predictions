import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ChevronLeft } from 'lucide-react';
import { pct } from '../../../lib/format';
import { isLeagueId, LEAGUE_IDS, LeagueConfig, LEAGUES } from '../../../lib/leagues';
import { getLeagueModel, LeagueModel } from '../../../lib/model';
import { COMPARE_RECENT, compareMarkets, compareRows, meetings, mostAlike, statLine } from '../../../lib/model/compare';
import { fantasyCompareRows, startSit } from '../../../lib/model/fantasy';
import { fantasyBoard } from '../../../lib/model/fantasyBoard';
import { currentTeams } from '../../../lib/model/playerIndex';
import { nextGameRow, PlayerGame, playerLog } from '../../../lib/model/playerLog';
import { propEngine } from '../../../lib/model/propEngines';
import { marketLabel } from '../../../lib/props';
import { matchupColors } from '../../../lib/teamColor';
import { formatShortDate } from '../../../lib/time';
import { CompareChart, CompareGame } from '../../components/CompareChart';
import { ComparePicker } from '../../components/ComparePicker';
import { LocalTime } from '../../components/LocalTime';
import { PlayerPhoto } from '../../components/PlayerPhoto';
import { EmptyState, PageHeader, Section } from '../../components/Section';
import { ShareButton } from '../../components/ShareButton';
import { TaleOfTheTape } from '../../components/TaleOfTheTape';
import { TeamLogo } from '../../components/TeamLogo';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ league: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

const ID = /^\d{1,15}$/;
/** Games read per player: enough for a full season's average. */
const LOG_GAMES = 120;
/** Meetings between the two shown at most. */
const FACED_GAMES = 6;

async function player(league: LeagueConfig, model: LeagueModel, id: string | null) {
  if (!id) return null;
  const log = await playerLog(league, model, id, LOG_GAMES).catch(() => null);
  if (!log) return null;
  const next = nextGameRow(model, id);
  const team = model.teams[(await currentTeams(league, model)).get(id) ?? next?.row.teamId ?? log.teamId] ?? null;
  const injury = team ? ((model.injuries[team.id] ?? []).find((i) => i.athleteId === id) ?? null) : null;
  // Ruled out: no projection for a game he won't play.
  const out = injury?.status.toLowerCase() === 'out' || next?.row.available === 0;
  return { log, next, team, injury, row: out ? null : (next?.row ?? null) };
}

async function load({ params, searchParams }: Params) {
  const { league: id } = await params;
  if (!isLeagueId(id)) return null;
  const league = LEAGUES[id];
  if (!propEngine(league)) return null;
  const query = await searchParams;
  const ids = [query.a, query.b].map((x) => (typeof x === 'string' && ID.test(x) ? x : null));
  const model = await getLeagueModel(league.id);
  const [a, b] = await Promise.all(ids.map((x) => player(league, model, x)));
  return { league, model, a, b, asked: ids };
}

export async function generateMetadata(props: Params): Promise<Metadata> {
  const data = await load(props);
  if (!data) return {};
  const { league, a, b } = data;
  if (a && b) {
    // Either order is the same comparison: one address for search engines.
    const [first, second] = [a.log.id, b.log.id].sort((x, y) => Number(x) - Number(y));
    return {
      title: `${a.log.name} vs ${b.log.name}: stats and props compared`,
      description: `${a.log.name} and ${b.log.name} side by side: next game projections against the ${league.name} prop lines, the last ${COMPARE_RECENT} games, this season, and how often each has cleared his line.`,
      alternates: { canonical: `/${league.id}/compare?a=${first}&b=${second}` }
    };
  }
  return {
    title: `Compare ${league.name} players`,
    description: `Any two ${league.name} players side by side: projections, prop lines, recent form and how often each clears his line.`,
    alternates: { canonical: `/${league.id}/compare` }
  };
}

const lastName = (name: string) => name.split(' ').slice(1).join(' ') || name;

/** The newest games, as much as the chart needs in the browser. */
const chartGames = (games: PlayerGame[]): CompareGame[] =>
  games.slice(0, COMPARE_RECENT).map((g) => ({ gameId: g.gameId, date: formatShortDate(g.date), opponent: `${g.home ? 'vs' : '@'} ${g.opponent}`, stats: g.stats }));

type Loaded = NonNullable<Awaited<ReturnType<typeof player>>>;

function PlayerHead({ p, league, color, align }: { p: Loaded; league: string; color: string; align: 'left' | 'right' }) {
  const next = p.next?.game;
  const home = next && p.team ? next.home.teamId === p.team.id : null;
  const opponent = next ? (home ? next.away : next.home) : null;
  return (
    <div className={`flex min-w-0 flex-1 flex-col items-center gap-3 text-center sm:flex-row sm:gap-4 ${align === 'right' ? 'sm:flex-row-reverse sm:text-right' : 'sm:text-left'}`}>
      <span className="relative inline-flex shrink-0">
        <span className="rounded-full p-1" style={{ background: `linear-gradient(140deg, ${color}, transparent 75%)`, boxShadow: `0 0 40px -10px ${color}aa` }}>
          <PlayerPhoto league={league} id={p.log.id} name={p.log.name} size={72} eager />
        </span>
        {p.team && (
          <span className="absolute -bottom-1 -right-1 rounded-full bg-surface p-0.5 ring-1 ring-line">
            <TeamLogo src={p.team.logo} abbr={p.team.abbr} size={20} />
          </span>
        )}
      </span>
      <div className="min-w-0 max-w-full">
        <Link href={`/${league}/player/${p.log.id}`} className="line-clamp-2 break-words font-display text-lg font-semibold leading-tight text-ink hover:underline sm:text-2xl">
          {p.log.name}
        </Link>
        <p className="truncate text-xs text-ink-3">{p.team?.name ?? 'No team on file'}</p>
        {next && opponent ? (
          <p className="mt-1 text-xs text-ink-2">
            Next: {home ? 'vs' : '@'} {opponent.abbr} · <LocalTime iso={next.date} />
          </p>
        ) : (
          <p className="mt-1 text-xs text-ink-3">No game on the board</p>
        )}
        {p.injury && <p className="mt-1 text-xs font-semibold text-warn">{p.injury.status}</p>}
      </div>
    </div>
  );
}

export default async function ComparePage(props: Params) {
  const data = await load(props);
  if (!data) notFound();
  const { league, model, a, b, asked } = data;
  const engine = propEngine(league)!;
  const colors = a && b ? matchupColors({ color: a.team?.color, altColor: a.team?.altColor }, { color: b.team?.color, altColor: b.team?.altColor }) : null;
  const markets = a && b ? compareMarkets(engine.markets, [a.log.games, b.log.games], [a.row, b.row]) : [];
  // Last names, unless they share one (the Ball brothers).
  const names = a && b && lastName(a.log.name) !== lastName(b.log.name) ? { a: lastName(a.log.name), b: lastName(b.log.name) } : { a: a?.log.name ?? '', b: b?.log.name ?? '' };
  const faced = a && b ? meetings(a.log.games, b.log.games).slice(0, FACED_GAMES) : [];
  // The stats that matter most between these two, as many as fit across a phone.
  const faceStats = markets.slice(0, 3);
  const pool = Object.entries(model.playerProjections)
    .filter(([gameId]) => model.predictions[gameId]?.game.state === 'pre')
    .flatMap(([, projection]) => [...projection.home, ...projection.away])
    .filter((p, i, all) => all.findIndex((q) => q.id === p.id) === i);
  // Something to try. With one player chosen: whoever's stat line is most like his, by projection (his recent averages if he's not on the board). With nobody: the two biggest in the league's headline stat.
  const chosen = a ?? b;
  const headline = engine.markets[0];
  const alike = chosen
    ? mostAlike(
        Object.fromEntries(
          engine.markets.flatMap((m) => {
            const value = chosen.row?.cells[m]?.projection ?? statLine(chosen.log.games, null, m, model.season.year).recent?.average;
            return value === undefined ? [] : [[m, value]];
          })
        ),
        pool.filter((p) => p.featured),
        engine.markets,
        chosen.log.id
      )
    : null;
  const suggested: { id: string; name: string }[] = chosen
    ? alike
      ? [{ id: chosen.log.id, name: chosen.log.name }, alike]
      : []
    : [...pool].sort((x, y) => (y.mean[headline] ?? 0) - (x.mean[headline] ?? 0)).slice(0, 2);
  const missing = asked.some((id, i) => id && !(i === 0 ? a : b));
  // Football: the two as fantasy players, from this week's board. A player ruled out isn't on a start-or-sit call.
  const board = league.id === 'nfl' && a && b ? await fantasyBoard(league, model).catch(() => null) : null;
  const fantasySide = (p: typeof a) => (p?.row ? (board?.rows.find((r) => r.id === p.log.id) ?? null) : null);
  const leftFantasy = fantasySide(a);
  const rightFantasy = fantasySide(b);
  const fantasyRows = fantasyCompareRows(leftFantasy, rightFantasy);
  const call = leftFantasy && rightFantasy ? startSit(leftFantasy.projected, leftFantasy.position, rightFantasy.projected, rightFantasy.position) : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link href={`/${league.id}/players`} className="inline-flex items-center gap-1 text-sm text-ink-2 hover:text-ink">
          <ChevronLeft className="h-4 w-4" aria-hidden /> {league.name} players
        </Link>
        {a && b && <ShareButton title={`${a.log.name} vs ${b.log.name}`} text={`${a.log.name} vs ${b.log.name}, stat by stat, on ShadowCrypts Predictions:`} />}
      </div>
      <PageHeader eyebrow={`${league.name} · Compare players`} title={a && b ? `${a.log.name} vs ${b.log.name}` : 'Any two players, side by side'}>
        <p>Next game projections against the books&apos; lines, recent form, this season, and how often each has cleared his line lately.</p>
      </PageHeader>

      <nav className="flex gap-2" aria-label="League">
        {LEAGUE_IDS.filter((id) => propEngine(LEAGUES[id])).map((id) => (
          <Link key={id} href={`/${id}/compare`} aria-current={id === league.id ? 'page' : undefined} className={`chip ${id === league.id ? 'chip-active' : 'chip-idle'}`}>
            {LEAGUES[id].name}
          </Link>
        ))}
      </nav>

      <section className="card p-4 sm:p-5" aria-label="Choose players">
        <ComparePicker league={league.id} a={a ? { id: a.log.id, name: a.log.name } : null} b={b ? { id: b.log.id, name: b.log.name } : null} />
        {missing && <p className="mt-3 text-xs text-warn">One of those players has no games on file here. Pick someone else.</p>}
      </section>

      {a && b && colors ? (
        <>
          <section className="card relative overflow-hidden p-4 sm:p-6" aria-label="The two players">
            <div
              className="pointer-events-none absolute inset-0 opacity-[0.22]"
              style={{ background: `linear-gradient(105deg, ${colors.away} 0%, transparent 48%, transparent 52%, ${colors.home} 100%)` }}
              aria-hidden
            />
            <div className="relative flex items-center gap-3 sm:gap-6">
              <PlayerHead p={a} league={league.id} color={colors.away} align="left" />
              <span className="shrink-0 font-display text-sm font-semibold uppercase tracking-[0.2em] text-ink-3">vs</span>
              <PlayerHead p={b} league={league.id} color={colors.home} align="right" />
            </div>
          </section>

          {fantasyRows.length > 0 && (
            <Section title="Fantasy points" subtitle="PPR. This week's projection is if he plays.">
              <TaleOfTheTape
                rows={fantasyRows}
                caption={`${a.log.name} and ${b.log.name}: fantasy points`}
                left={{ abbr: names.a, name: a.log.name, logo: a.team?.logo ?? null, color: colors.away }}
                right={{ abbr: names.b, name: b.log.name, logo: b.team?.logo ?? null, color: colors.home }}
              />
              {call && (
                <p className="mt-3 text-sm text-ink-2">
                  {call.favorite === 'left' ? names.a : names.b} is projected {call.gap.toFixed(1)} more. At that gap, the higher-projected player has outscored the other <span className="font-semibold text-ink">{pct(call.chance)}</span> of the time.{' '}
                  <Link href="/nfl/fantasy" className="text-ink-3 underline underline-offset-2 hover:text-ink">
                    Weekly rankings
                  </Link>
                </p>
              )}
            </Section>
          )}

          {markets.length > 0 && a.log.games.length > 1 && b.log.games.length > 1 && (
            <Section title={`Last ${COMPARE_RECENT} games`} subtitle="Each player's own last games, so the dates differ: they line up by how recent the game was. Move across, or tab to the chart and use the arrow keys, for each game.">
              <CompareChart
                markets={markets}
                slots={COMPARE_RECENT}
                series={[
                  { name: names.a, color: colors.away, games: chartGames(a.log.games) },
                  { name: names.b, color: colors.home, games: chartGames(b.log.games) }
                ]}
              />
            </Section>
          )}

          {markets.length ? (
            <div className="grid gap-4 md:grid-cols-2">
              {markets.map((m) => {
                const rows = compareRows(statLine(a.log.games, a.row, m, model.season.year), statLine(b.log.games, b.row, m, model.season.year));
                if (!rows.length) return null;
                return (
                  <section key={m} className="card min-w-0 p-4 sm:p-5" aria-labelledby={`stat-${m}`}>
                    <h2 id={`stat-${m}`} className="mb-3 font-display text-base font-semibold text-ink first-letter:uppercase">
                      {marketLabel(m).long}
                    </h2>
                    <TaleOfTheTape
                      rows={rows}
                      caption={`${a.log.name} and ${b.log.name}: ${marketLabel(m).long}`}
                      left={{ abbr: names.a, name: a.log.name, logo: a.team?.logo ?? null, color: colors.away }}
                      right={{ abbr: names.b, name: b.log.name, logo: b.team?.logo ?? null, color: colors.home }}
                    />
                  </section>
                );
              })}
            </div>
          ) : (
            <EmptyState>Neither player has stats on file in the markets we cover.</EmptyState>
          )}
          {faced.length > 0 && (
            <Section
              title="When they've met"
              subtitle={`${names.a} first in each pair, the bigger number in bold. ${faced.length === 1 ? 'Their one game' : `Their last ${faced.length} games`} against each other on file, newest first. A small sample, and rosters change.`}
            >
              <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
                <table className="w-full min-w-[420px] text-left text-sm tabular">
                  <thead>
                    <tr className="border-b border-line text-xs text-ink-3">
                      <th scope="col" className="py-2 pr-3 font-medium">
                        Game
                      </th>
                      {faceStats.map((m) => (
                        <th key={m} scope="col" className="py-2 pl-3 text-right font-medium">
                          {marketLabel(m).short}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {faced.map(({ left, right }) => {
                      const game = model.predictions[left.gameId]?.game;
                      return (
                        <tr key={left.gameId} className="border-b border-line/60 last:border-0">
                          <th scope="row" className="whitespace-nowrap py-2 pr-3 font-normal">
                            <Link href={`/${league.id}/game/${left.gameId}`} className="text-ink hover:underline">
                              {formatShortDate(left.date)}
                            </Link>
                            {game && (
                              <span className="ml-2 text-xs text-ink-3">
                                {game.away.abbr} {game.away.score} @ {game.home.abbr} {game.home.score}
                              </span>
                            )}
                          </th>
                          {faceStats.map((m) => {
                            const l = left.stats[m] ?? 0;
                            const r = right.stats[m] ?? 0;
                            return (
                              <td key={m} className="whitespace-nowrap py-2 pl-3 text-right text-ink-2">
                                <span className={l > r ? 'font-semibold text-ink' : ''}>{l}</span>
                                <span className="mx-1 text-ink-3">–</span>
                                <span className={r > l ? 'font-semibold text-ink' : ''}>{r}</span>
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Section>
          )}
          <p className="text-xs text-ink-3">
            Next game projections and over chances are the props board&apos;s: the book&apos;s price with our model&apos;s small weight, since the
            books have been the more accurate of the two. Averages count the games on file (this season and last); the bigger number in each row
            is in bold. For insight and fun, not betting advice.
          </p>
        </>
      ) : (
        <EmptyState>
          {suggested.length === 2 ? (
            <>
              {chosen ? 'Pick a second player above' : 'Pick two players above'}, or try{' '}
              <Link href={`/${league.id}/compare?a=${suggested[0].id}&b=${suggested[1].id}`} className="text-ink underline">
                {suggested[0].name} vs {suggested[1].name}
              </Link>
              .
            </>
          ) : (
            `${chosen ? 'Pick a second player above' : 'Pick two players above'}.`
          )}
        </EmptyState>
      )}
    </div>
  );
}
