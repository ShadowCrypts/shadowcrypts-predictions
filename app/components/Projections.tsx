import Link from 'next/link';
import { pct } from '../../lib/format';
import type { TeamInfo } from '../../lib/espn';
import type { LeagueConfig, LeagueId } from '../../lib/leagues';
import type { SeriesOutlook } from '../../lib/model/bracket';
import type { ProjectionView } from '../../lib/model/projections';
import { FORMAT_RULES, SeasonRecord, TeamOutlook } from '../../lib/model/season';
import { formatTime } from '../../lib/time';
import { FollowedStar } from './FollowedStar';
import { EmptyState, Section, StatTile } from './Section';
import { TeamLogo } from './TeamLogo';

type Ready = Extract<ProjectionView, { status: 'ready' }>;
type Playoffs = Extract<ProjectionView, { status: 'playoffs' }>;

const FINAL_NAME: Record<LeagueId, string> = { nfl: 'Super Bowl', nba: 'NBA Finals', mlb: 'World Series', nhl: 'Stanley Cup Final' };

const FORMAT_NOTE: Record<LeagueId, string> = {
  nfl: 'Four division winners (seeded 1–4) and three wild cards per conference make the playoffs, and the top seed gets a bye. Playoff games are single games at the higher seed; the Super Bowl is neutral. Simulated games never end in a tie.',
  nba: 'The top six in each conference go straight to the playoffs and 7–10 play the play-in (7 vs 8 and 9 vs 10, then the 7/8 loser hosts the 9/10 winner). “Playoffs” means reaching the 16-team bracket. Series are best of seven, with home court to the higher seed.',
  mlb: 'Three division winners and three wild cards per league make the playoffs, and the two best division winners get byes. Wild-card series are best of three at the higher seed, then best of five and best of seven.',
  nhl: 'Standings go by points: two for a win, one for an overtime or shootout loss. The top three in each division and two wild cards per conference make the playoffs. Series are best of seven, with home ice to the team with more points.'
};

/** Simulated odds never read as a certainty: anything under 1% or over 99% says so. */
function chance(p: number) {
  if (p < 0.005) return '<1%';
  if (p >= 0.995) return '>99%';
  return `${Math.round(p * 100)}%`;
}

function recordText(league: LeagueId, r: SeasonRecord) {
  if (league === 'nhl') return `${r.wins}-${r.losses}-${r.otLosses}`;
  return r.ties ? `${r.wins}-${r.losses}-${r.ties}` : `${r.wins}-${r.losses}`;
}

/** The average final record, rounded so it still adds up to a full season. */
function projectedRecord(league: LeagueId, t: TeamOutlook) {
  const wins = Math.round(t.wins);
  const otLosses = league === 'nhl' ? Math.round(t.otLosses) : 0;
  return recordText(league, { wins, losses: t.games - wins - otLosses - t.ties, ties: t.ties, otLosses });
}

function statusText(view: Exclude<ProjectionView, Ready | Playoffs>, teams?: Record<string, TeamInfo>) {
  switch (view.status) {
    case 'pending':
      return 'Running the season simulations in the background. They’ll show up on the next refresh.';
    case 'unavailable':
      return 'Season projections couldn’t be computed just now (a schedule or standings feed didn’t load). They’ll retry on the next visit.';
    case 'complete': {
      if (view.playoffs) {
        return `The ${view.season} regular season is over and the playoffs are underway, but the bracket couldn’t be lined up with ESPN’s seeds and results just now, so playoff odds will retry within 15 minutes. Game-by-game forecasts still cover every playoff game.`;
      }
      const champion = view.champion && teams?.[view.champion];
      return `The ${view.season} season is over${champion ? `: the ${champion.name} won the ${FINAL_NAME[view.league]}` : ''}. Projections for next season start once its schedule is out.`;
    }
    case 'unscheduled':
      return `No ${view.season} regular-season schedule yet. Projections start once ESPN publishes it.`;
  }
}

function Chance({ p, sims }: { p: number; sims: number }) {
  return (
    <span
      title={`${Math.round(p * sims).toLocaleString()} of ${sims.toLocaleString()} simulations`}
      className={p >= 0.5 ? 'font-semibold text-ink' : p < 0.005 ? 'text-ink-3' : 'text-ink-2'}
    >
      {chance(p)}
    </span>
  );
}

function Notes({ league, view }: { league: LeagueConfig; view: Ready }) {
  const rules = FORMAT_RULES[league.id];
  const perTeam = view.unscheduled / view.teams.length;
  return (
    <div className="space-y-2 border-t border-line pt-4 text-xs leading-relaxed text-ink-3">
      <p>
        Every game uses the pre-line forecast: team ratings and home field, plus rest, travel and any announced starters or injuries for games in
        the next few weeks. Each simulation also shifts every team’s rating by a random amount (standard deviation {view.drift} Elo) because ratings
        are estimates and teams change. Ties in the standings are broken by coin flip, not the league’s tiebreaker rules.
      </p>
      <p>
        {FORMAT_NOTE[league.id]}
        {view.otRate !== null && ` ${pct(view.otRate)} of simulated games go past regulation, the share in the seasons on file.`}
      </p>
      {view.unscheduled > 0 && (
        <p>
          {league.id === 'nba' && Number.isInteger(perTeam)
            ? `Each team still has ${perTeam} games to be scheduled (the NBA sets them after the Cup group stage); they’re played against a league-average opponent.`
            : `${view.unscheduled} team-games aren’t on ESPN’s schedule yet and are played against a league-average opponent.`}
        </p>
      )}
      <p>
        Records are simulation averages, rounded. The range is the middle 80% of simulated win totals; when past seasons were re-run from their
        quarter, half and three-quarter marks, final win totals landed inside it {pct(rules.rangeCoverage)} of the time
        {league.id === 'nba' ? ', so treat NBA ranges as narrower than reality: late-season tanking and resting move records more than ratings can see.' : '.'}
      </p>
    </div>
  );
}

/** The league page's projections: one table per conference, or the bracket once the postseason is on. */
export function LeagueProjections({ league, view, teams }: { league: LeagueConfig; view: ProjectionView; teams: Record<string, TeamInfo> }) {
  return (
    <Section
      id="projections"
      title={view.status === 'playoffs' ? 'Playoff odds' : 'Season projections'}
      subtitle={
        view.status === 'ready'
          ? `${view.sims.toLocaleString()} simulations of the ${view.remaining.toLocaleString()} regular-season games left, then the playoffs. Re-run every 15 minutes; last at ${formatTime(view.generatedAt)}.`
          : view.status === 'playoffs'
            ? `${view.sims.toLocaleString()} simulations of the rest of the ${view.season} postseason, starting from the current bracket and series scores. Re-run every 15 minutes; last at ${formatTime(view.generatedAt)}.`
            : 'Projected records and playoff odds from simulating the rest of the season.'
      }
    >
      {view.status === 'ready' ? (
        <ProjectionTables league={league} view={view} teams={teams} />
      ) : view.status === 'playoffs' ? (
        <PlayoffTables league={league} view={view} teams={teams} />
      ) : (
        <EmptyState>{statusText(view, teams)}</EmptyState>
      )}
    </Section>
  );
}

const PLAYOFF_NOTE: Record<LeagueId, string> = {
  nfl: 'The bracket follows the official seeds: the top seed has a bye and then hosts the lowest seed left, and every game is at the higher seed except the neutral-site Super Bowl.',
  nba: 'The bracket follows the official seeds, play-in included (7 hosts 8, 9 hosts 10, then the 7/8 loser hosts the 9/10 winner). Series are best of seven, 2-2-1-1-1, with home court to the higher seed and, in the Finals, to the better regular-season record.',
  mlb: 'The bracket follows the official seeds: the top two in each league skip the best-of-three wild-card round, the 1 seed meets the 4/5 winner, and the higher seed hosts through the LCS. Division Series go 2-2-1; the LCS and World Series go 2-3-2, with World Series home field to the better regular-season record.',
  nhl: 'The bracket follows the official seeds: the better division winner meets the second wild card, and 2 meets 3 in each division. Series are best of seven, 2-2-1-1-1, with home ice to the team with more points.'
};

const abbrOf = (teams: Record<string, TeamInfo>, id: string) => teams[id]?.abbr ?? id;

/** "MIL leads 2–1", "Series tied 1–1", "TB won 4–2"; null before a game is in. */
function seriesScore(s: SeriesOutlook, teams: Record<string, TeamInfo>) {
  const [a, b] = s.wins;
  const lead = a >= b ? s.teams[0] : s.teams[1];
  const score = `${Math.max(a, b)}–${Math.min(a, b)}`;
  if (s.winner) return s.length === 1 ? `${abbrOf(teams, s.winner)} won` : `${abbrOf(teams, s.winner)} won ${score}`;
  if (s.length === 1 || a + b === 0) return null;
  return a === b ? `Series tied ${score}` : `${abbrOf(teams, lead)} leads ${score}`;
}

function nextGameText(s: SeriesOutlook, teams: Record<string, TeamInfo>) {
  if (!s.next) return null;
  const { game, homeId, prob, live } = s.next;
  const favorite = prob >= 0.5 ? s.teams[0] : s.teams[1];
  const label = s.length === 1 ? (live ? 'Under way' : 'Single game') : live ? `Game ${game} under way` : `Next: Game ${game}`;
  return `${label}${homeId ? ` at ${abbrOf(teams, homeId)}` : ', neutral site'} · ${abbrOf(teams, favorite)} ${pct(Math.max(prob, 1 - prob))}${live ? ' live' : ''}`;
}

function SeriesCard({ league, view, s, teams }: { league: LeagueConfig; view: Playoffs; s: SeriesOutlook; teams: Record<string, TeamInfo> }) {
  const conference = s.conference && view.conferences.find((c) => c.abbr === s.conference)?.name;
  const score = seriesScore(s, teams);
  const next = nextGameText(s, teams);
  return (
    <div className="rounded-xl bg-raised p-4 ring-1 ring-line">
      <p className="text-xs text-ink-3">
        {view.rounds[s.round].name}
        {conference ? ` · ${conference}` : ''}
        {s.length > 1 ? ` · best of ${s.length}` : ''}
      </p>
      <ul className="mt-3 space-y-2">
        {s.teams.map((id, k) => {
          const team = teams[id];
          const seed = view.teams.find((t) => t.id === id)?.seed;
          const p = k === 0 ? s.odds : 1 - s.odds;
          return (
            <li key={id} className="flex items-center gap-2">
              <TeamLogo src={team?.logo ?? null} abbr={team?.abbr ?? '?'} size={26} />
              <Link href={`/${league.id}/team/${id}`} className="min-w-0 truncate font-medium text-ink hover:underline">
                {team?.shortName ?? id}
              </Link>
              {seed !== undefined && <span className="text-xs text-ink-3">{s.conference ? `#${seed}` : `${view.teams.find((t) => t.id === id)?.conference} #${seed}`}</span>}
              {s.length > 1 && <span className="ml-auto font-display text-xl font-semibold text-ink tabular">{s.wins[k]}</span>}
              <span className={`w-12 text-right text-sm tabular ${s.length > 1 ? '' : 'ml-auto'}`}>
                {s.winner ? <span className={s.winner === id ? 'font-semibold text-good' : 'text-ink-3'}>{s.winner === id ? 'Won' : 'Out'}</span> : <Chance p={p} sims={view.sims} />}
              </span>
            </li>
          );
        })}
      </ul>
      {!s.winner && (
        <span className="mt-3 block h-1.5 w-full overflow-hidden rounded-full bg-track" aria-hidden>
          <span className="block h-full rounded-full bg-accent" style={{ width: `${s.odds * 100}%` }} />
        </span>
      )}
      {(score || next) && <p className="mt-2 text-xs text-ink-3">{[score, next].filter(Boolean).join(' · ')}</p>}
    </div>
  );
}

function PlayoffTables({ league, view, teams }: { league: LeagueConfig; view: Playoffs; teams: Record<string, TeamInfo> }) {
  const open = view.series.filter((s) => s.winner === null);
  const settled = view.series.filter((s) => s.winner !== null).reverse();
  const alive = view.teams.filter((t) => t.out === null).sort((a, b) => b.title - a.title || a.seed - b.seed);
  const later = view.rounds.map((round, i) => ({ ...round, i })).filter((round) => round.i > view.current);
  return (
    <div className="space-y-6">
      <div>
        <h3 className="mb-2 text-sm font-semibold text-ink">{view.rounds[view.current]?.name ?? 'Current series'}</h3>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {open.map((s) => (
            <SeriesCard key={`${s.round}-${s.teams.join('-')}`} league={league} view={view} s={s} teams={teams} />
          ))}
        </div>
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold text-ink">Title odds for every team still alive</h3>
        <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-ink-3">
                <th className="pb-2 font-medium">Team</th>
                {later.map((round, k) => (
                  <th key={round.i} className={`pb-2 pl-3 text-right font-medium ${k === 0 ? '' : 'hidden sm:table-cell'}`} title={`Chance to reach the ${round.name}`}>
                    {round.short}
                  </th>
                ))}
                <th className="pb-2 pl-3 text-right font-medium">Title</th>
              </tr>
            </thead>
            <tbody className="tabular">
              {alive.map((t) => {
                const team = teams[t.id];
                return (
                  <tr key={t.id} className="border-t border-line transition hover:bg-raised/60">
                    <td className="py-2">
                      <Link href={`/${league.id}/team/${t.id}`} className="flex items-center gap-2 hover:underline">
                        <TeamLogo src={team?.logo ?? null} abbr={team?.abbr ?? '?'} size={22} />
                        <span className="font-medium text-ink">{team?.shortName ?? t.id}</span>
                        <FollowedStar league={league.id} teamId={t.id} />
                        <span className="text-xs text-ink-3">
                          {t.conference} #{t.seed}
                        </span>
                      </Link>
                    </td>
                    {later.map((round, k) => (
                      <td key={round.i} className={`py-2 pl-3 text-right ${k === 0 ? '' : 'hidden sm:table-cell'}`}>
                        {t.reached >= round.i ? (
                          <span className="font-semibold text-good" title={`Already in the ${round.name}`}>
                            ✓
                          </span>
                        ) : (
                          <Chance p={t.reach[round.i]} sims={view.sims} />
                        )}
                      </td>
                    ))}
                    <td className="py-2 pl-3 text-right">
                      <span className="ml-auto flex w-14 flex-col items-end gap-1">
                        <Chance p={t.title} sims={view.sims} />
                        <span className="block h-1 w-full overflow-hidden rounded-full bg-track" aria-hidden>
                          <span className="block h-full rounded-full bg-accent" style={{ width: `${t.title * 100}%` }} />
                        </span>
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {settled.length > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-semibold text-ink">Results so far</h3>
          <ul className="grid gap-x-6 gap-y-1 text-sm text-ink-2 sm:grid-cols-2">
            {settled.map((s) => {
              const loser = s.teams[0] === s.winner ? s.teams[1] : s.teams[0];
              const [a, b] = s.wins;
              return (
                <li key={`${s.round}-${s.teams.join('-')}`}>
                  <span className="text-ink-3">{view.rounds[s.round].short}:</span> {teams[s.winner!]?.shortName ?? s.winner} beat {teams[loser]?.shortName ?? loser}
                  {s.length > 1 && <span className="tabular"> {`${Math.max(a, b)}–${Math.min(a, b)}`}</span>}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div className="space-y-2 border-t border-line pt-4 text-xs leading-relaxed text-ink-3">
        <p>
          Each game still to play uses the app’s forecast at its real home team: the betting line once one is posted, otherwise the pre-line forecast
          (ratings, home field, and any announced starters or injuries). A game under way counts at its live win probability as of the last run.
          Games ESPN hasn’t scheduled yet use team ratings, with home field following the league’s pattern.
        </p>
        <p>
          Games are simulated as independent at those odds. Nothing lets a team’s strength change during the playoffs or allows for its rating being
          off, which tends to understate long shots a little.
        </p>
        <p>{PLAYOFF_NOTE[league.id]}</p>
        <p>Odds under 1% or over 99% are shown that way rather than as certain; a ✓ means results have already put the team in that round.</p>
      </div>
    </div>
  );
}

/** A postseason game page's series: the score, each team's chance to win it, and their title odds. */
export function GameSeries({ league, view, homeId, awayId, teams }: { league: LeagueConfig; view: ProjectionView; homeId: string; awayId: string; teams: Record<string, TeamInfo> }) {
  if (view.status !== 'playoffs') return null;
  const s = [...view.series].reverse().find((x) => x.teams.includes(homeId) && x.teams.includes(awayId));
  if (!s) return null;
  const title = (id: string) => view.teams.find((t) => t.id === id)?.title ?? 0;
  return (
    <Section
      title={s.length > 1 ? 'Series outlook' : 'Playoff outlook'}
      subtitle={
        <>
          From {view.sims.toLocaleString()} simulations of the rest of the postseason, re-run every 15 minutes (last at {formatTime(view.generatedAt)}).{' '}
          <Link href={`/${league.id}#projections`} className="text-accent-strong underline underline-offset-2">
            The whole bracket
          </Link>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
        <SeriesCard league={league} view={view} s={s} teams={teams} />
        <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-1">
          {s.teams.map((id) => (
            <div key={id} className="rounded-xl bg-raised p-3 ring-1 ring-line">
              <dt className="text-xs text-ink-3">{abbrOf(teams, id)} title odds</dt>
              <dd className="mt-1 font-semibold text-ink tabular">{view.teams.find((t) => t.id === id)?.out !== null ? 'Out' : chance(title(id))}</dd>
            </div>
          ))}
        </dl>
      </div>
    </Section>
  );
}

function ProjectionTables({ league, view: ready, teams }: { league: LeagueConfig; view: Ready; teams: Record<string, TeamInfo> }) {
  const extra = league.id === 'nba' ? { label: 'Play-in', pick: (t: TeamOutlook) => t.playIn } : { label: 'Division', pick: (t: TeamOutlook) => t.divisionTitle };
  const standing = (t: TeamOutlook) => t.points ?? t.wins;
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        {ready.conferences.map((conference) => (
          <div key={conference.abbr}>
            <h3 className="mb-2 text-sm font-semibold text-ink">{conference.name}</h3>
            <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
              <table className="w-full text-sm sm:min-w-[440px]">
                <thead>
                  <tr className="text-left text-xs text-ink-3">
                    <th className="pb-2 font-medium">Team</th>
                    <th className="pb-2 text-right font-medium" title="Average final record, and the middle 80% of simulated win totals">
                      Projected
                    </th>
                    <th className="hidden pb-2 text-right font-medium sm:table-cell">{extra.label}</th>
                    <th className="pb-2 pl-3 text-right font-medium">Playoffs</th>
                    <th className="pb-2 text-right font-medium">Title</th>
                  </tr>
                </thead>
                <tbody className="tabular">
                  {ready.teams
                    .filter((t) => t.conference === conference.abbr)
                    .sort((a, b) => standing(b) - standing(a) || b.playoffs - a.playoffs)
                    .map((t) => {
                      const team = teams[t.id];
                      return (
                        <tr key={t.id} className="border-t border-line transition hover:bg-raised/60">
                          <td className="py-2">
                            <Link href={`/${league.id}/team/${t.id}`} className="flex items-center gap-2 hover:underline">
                              <TeamLogo src={team?.logo ?? null} abbr={team?.abbr ?? '?'} size={22} />
                              <span className="font-medium text-ink">{team?.shortName ?? t.id}</span>
                              <FollowedStar league={league.id} teamId={t.id} />
                              <span className="hidden text-xs text-ink-3 min-[400px]:inline">{recordText(league.id, t.current)}</span>
                            </Link>
                          </td>
                          <td className="py-2 text-right">
                            <span className="font-semibold text-ink">{projectedRecord(league.id, t)}</span>
                            <span className="block text-xs text-ink-3">
                              {t.winsLow}–{t.winsHigh} W
                            </span>
                          </td>
                          <td className="hidden py-2 text-right sm:table-cell">
                            <Chance p={extra.pick(t) ?? 0} sims={ready.sims} />
                          </td>
                          <td className="py-2 pl-3 text-right">
                            <span className="ml-auto flex w-14 flex-col items-end gap-1">
                              <Chance p={t.playoffs} sims={ready.sims} />
                              <span className="block h-1 w-full overflow-hidden rounded-full bg-track" aria-hidden>
                                <span className="block h-full rounded-full bg-accent" style={{ width: `${t.playoffs * 100}%` }} />
                              </span>
                            </span>
                          </td>
                          <td className="py-2 text-right">
                            <Chance p={t.title} sims={ready.sims} />
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </div>
      <Notes league={league} view={ready} />
    </div>
  );
}

/** A team page's playoff outlook: its current series and how far it's likely to go. */
function TeamPlayoffOutlook({ league, view, teamId, teams }: { league: LeagueConfig; view: Playoffs; teamId: string; teams: Record<string, TeamInfo> }) {
  const t = view.teams.find((x) => x.id === teamId);
  const last = view.rounds.length - 1;
  const name = (id: string) => teams[id]?.shortName ?? id;
  let body: React.ReactNode;
  if (!t) {
    body = <EmptyState>Not in the {view.season} playoff field.</EmptyState>;
  } else if (t.out !== null) {
    const lost = view.series.find((s) => s.round === t.out && s.winner && s.winner !== teamId && s.teams.includes(teamId));
    const score = lost && lost.length > 1 ? ` (${Math.max(...lost.wins)}–${Math.min(...lost.wins)})` : '';
    body = (
      <EmptyState>
        Knocked out in the {view.rounds[t.out].name}
        {lost ? ` by the ${teams[lost.winner!]?.name ?? lost.winner}${score}` : ''}.
      </EmptyState>
    );
  } else {
    const s = view.series.filter((x) => x.winner === null && x.teams.includes(teamId)).sort((a, b) => a.round - b.round)[0];
    const side = s ? s.teams.indexOf(teamId) : -1;
    const opponent = s ? s.teams[1 - side] : null;
    const [us, them] = s ? [s.wins[side], s.wins[1 - side]] : [0, 0];
    const next = s?.next;
    const state = !s
      ? 'Waiting'
      : s.length === 1
        ? next?.live
          ? 'Under way'
          : 'Single game'
        : us === them
          ? us === 0 && !next?.live
            ? 'Up next'
            : `Tied ${us}–${them}`
          : us > them
            ? `Leads ${us}–${them}`
            : `Trails ${us}–${them}`;
    const nextProb = next ? (side === 0 ? next.prob : 1 - next.prob) : null;
    const round = s ? s.round : t.reached;
    body = (
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label={s ? view.rounds[s.round].name : 'Next round'}
          value={state}
          sub={s && opponent ? `vs ${name(opponent)}` : `Already in the ${view.rounds[t.reached].name}; opponent not set yet`}
        />
        <StatTile
          label={s && s.length > 1 ? 'Win the series' : 'Advance'}
          value={chance(round + 1 <= last ? t.reach[round + 1] : t.title)}
          sub={next && nextProb !== null ? `${next.live ? `Game ${next.game} live` : `Game ${next.game}`}: ${pct(nextProb)} to win it` : undefined}
        />
        {round < last && <StatTile label={`Reach the ${FINAL_NAME[league.id]}`} value={chance(t.reach[last])} />}
        <StatTile label="Win it all" value={chance(t.title)} sub={`In ${Math.round(t.title * view.sims).toLocaleString()} of ${view.sims.toLocaleString()} simulations`} />
      </div>
    );
  }
  return (
    <Section
      id="projections"
      title="Playoff outlook"
      subtitle={
        <>
          From {view.sims.toLocaleString()} simulations of the rest of the {view.season} postseason, starting from the current bracket and series scores.{' '}
          <Link href={`/${league.id}#projections`} className="text-accent-strong underline underline-offset-2">
            The whole bracket and how it works
          </Link>
        </>
      }
    >
      {body}
    </Section>
  );
}

/** A team page's season outlook (its playoff outlook once the postseason is on). */
export function TeamProjection({ league, view, teamId, teams = {} }: { league: LeagueConfig; view: ProjectionView; teamId: string; teams?: Record<string, TeamInfo> }) {
  if (view.status === 'playoffs') return <TeamPlayoffOutlook league={league} view={view} teamId={teamId} teams={teams} />;
  const t = view.status === 'ready' ? view.teams.find((x) => x.id === teamId) : undefined;
  const sims = view.status === 'ready' ? view.sims : 0;
  const playoffsSub =
    t &&
    (league.id === 'nba'
      ? `Play-in: ${chance(t.playIn ?? 0)}`
      : [`Division: ${chance(t.divisionTitle ?? 0)}`, t.bye !== null && `${league.id === 'nfl' ? 'Top seed' : 'Bye'}: ${chance(t.bye)}`].filter(Boolean).join(' · '));
  return (
    <Section
      id="projections"
      title="Season outlook"
      subtitle={
        view.status === 'ready' ? (
          <>
            From {sims.toLocaleString()} simulations of the rest of the {view.season} season and the playoffs, with standings ties broken by coin flip.{' '}
            <Link href={`/${league.id}#projections`} className="text-accent-strong underline underline-offset-2">
              Every team and how it works
            </Link>
          </>
        ) : undefined
      }
    >
      {view.status !== 'ready' ? (
        <EmptyState>{statusText(view, teams)}</EmptyState>
      ) : !t ? (
        <EmptyState>This team isn’t in the {view.season} standings.</EmptyState>
      ) : (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile
            label="Projected record"
            value={projectedRecord(league.id, t)}
            sub={`Now ${recordText(league.id, t.current)} · middle 80%: ${t.winsLow}–${t.winsHigh} wins`}
          />
          <StatTile
            label="Make the playoffs"
            value={chance(t.playoffs)}
            sub={
              <>
                {playoffsSub}
                {t.cutoff !== null && t.cutoff !== undefined && (
                  <>
                    <br />
                    About {t.cutoff} {league.id === 'nhl' ? 'points' : 'wins'} usually gets them in
                  </>
                )}
              </>
            }
          />
          <StatTile label={`Reach the ${FINAL_NAME[league.id]}`} value={chance(t.final)} />
          <StatTile label="Win it all" value={chance(t.title)} sub={`In ${Math.round(t.title * sims).toLocaleString()} of ${sims.toLocaleString()} simulations`} />
        </div>
      )}
    </Section>
  );
}
