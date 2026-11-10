'use client';

import { ArrowLeftRight } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { pct } from '../../lib/format';
import { matchupProbability, MatchupLeague, matchupScore, seriesProbability, Venue } from '../../lib/model/matchup';
import { tapeNote, tapeRows } from '../../lib/model/tape';
import { matchupColors } from '../../lib/teamColor';
import { ProbabilityMeter } from './ProbabilityMeter';
import { Section } from './Section';
import { ShareButton } from './ShareButton';
import { TaleOfTheTape } from './TaleOfTheTape';
import { TeamLogo } from './TeamLogo';

/** One side of the matchup: the team's logo in a halo of its color, the team list, and its chance as the headline number. */
function TeamPicker({
  label,
  value,
  teams,
  onChange,
  color,
  chance,
  favored
}: {
  label: string;
  value: string;
  teams: MatchupLeague['teams'];
  onChange: (id: string) => void;
  color: string;
  chance: number | null;
  favored: boolean;
}) {
  const team = teams.find((t) => t.id === value);
  return (
    <div className="flex min-w-0 flex-1 flex-col items-center gap-3 text-center">
      <span className="text-xs font-medium uppercase tracking-wider text-ink-3">{label}</span>
      {team && (
        <span
          className="inline-flex h-[84px] w-[84px] items-center justify-center rounded-full ring-1 ring-inset ring-white/10 sm:h-[104px] sm:w-[104px]"
          style={{ background: `radial-gradient(circle at 50% 35%, ${color}55, ${color}18 70%)`, boxShadow: `0 0 40px -8px ${color}66` }}
        >
          <TeamLogo src={team.logo} abbr={team.abbr} size={64} eager />
        </span>
      )}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={`${label} team`}
        className="w-full max-w-[16rem] cursor-pointer truncate rounded-lg bg-surface/80 px-3 py-2 text-center text-sm font-semibold text-ink ring-1 ring-line backdrop-blur focus:outline-none focus:ring-accent"
      >
        {teams.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </select>
      {chance !== null && (
        <p className={`font-display font-bold leading-none tabular ${favored ? 'text-4xl text-ink sm:text-6xl' : 'text-3xl text-ink-3 sm:text-5xl'}`}>{pct(chance)}</p>
      )}
      {team && <span className="text-xs text-ink-3 tabular">Elo {Math.round(team.elo)} · market {Math.round(team.market)}</span>}
    </div>
  );
}

export function MatchupMachine({ leagues }: { leagues: MatchupLeague[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const byElo = (l: MatchupLeague) => [...l.teams].sort((x, y) => y.elo - x.elo);
  const initialLeague = leagues.find((l) => l.id === params.get('league')) ?? leagues.find((l) => l.id === 'nba') ?? leagues[0];
  const [leagueId, setLeagueId] = useState(initialLeague?.id ?? '');
  const league = leagues.find((l) => l.id === leagueId) ?? leagues[0];
  const valid = (id: string | null) => (id && league?.teams.some((t) => t.id === id) ? id : null);
  // A team asked for in the link, else the best team by Elo that isn't the other side (a link can name just one).
  const [a, setA] = useState(() => valid(params.get('a')) ?? (league ? byElo(league).find((t) => t.id !== valid(params.get('b')))?.id : '') ?? '');
  const [b, setB] = useState(() => valid(params.get('b')) ?? (league ? byElo(league).find((t) => t.id !== a)?.id : '') ?? '');
  const [venue, setVenue] = useState<Venue>(() => (['a', 'b', 'neutral'].includes(params.get('venue') ?? '') ? (params.get('venue') as Venue) : 'a'));

  // Keep the URL in step so a matchup can be shared.
  useEffect(() => {
    const query = new URLSearchParams({ league: leagueId, a, b, venue });
    router.replace(`${pathname}?${query}`, { scroll: false });
  }, [leagueId, a, b, venue, pathname, router]);

  const switchLeague = (id: string) => {
    const next = leagues.find((l) => l.id === id);
    if (!next) return;
    const top = byElo(next);
    setLeagueId(id);
    setA(top[0]?.id ?? '');
    setB(top[1]?.id ?? '');
  };

  const teamA = league?.teams.find((t) => t.id === a);
  const teamB = league?.teams.find((t) => t.id === b);
  const result = useMemo(() => (league && teamA && teamB ? matchupProbability(league, teamA, teamB, venue) : null), [league, teamA, teamB, venue]);

  if (!league || !teamA || !teamB || !result) return <p className="text-ink-3">Ratings aren&apos;t available right now.</p>;

  const same = teamA.id === teamB.id;
  const colors = matchupColors(teamA, teamB);
  const favorite = result.probability >= 0.5 ? teamA : teamB;
  const favProb = Math.max(result.probability, 1 - result.probability);
  const score = matchupScore(league, teamA, teamB, venue, result.probability);
  const tape = tapeRows(league.tape.sheet, teamA.id, teamB.id, { host: venue === 'a' ? 'left' : venue === 'b' ? 'right' : null, unit: league.tape.unit });
  const series =
    league.series && venue !== 'neutral'
      ? (() => {
          // The host is always the first team here, so 'a' means a host home game and 'b' a road game.
          const host = venue === 'a' ? teamA : teamB;
          const guest = venue === 'a' ? teamB : teamA;
          const atHome = matchupProbability(league, host, guest, 'a').probability;
          const onRoad = matchupProbability(league, host, guest, 'b').probability;
          return { host, guest, win: seriesProbability(atHome, onRoad, league.series!) };
        })()
      : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="scrollbar-none -mx-4 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:px-0" role="group" aria-label="League">
          {leagues.map((l) => (
            <button key={l.id} type="button" onClick={() => switchLeague(l.id)} aria-pressed={l.id === leagueId} className={`chip ${l.id === leagueId ? 'chip-active' : 'chip-idle'}`}>
              {l.name}
            </button>
          ))}
        </div>
        {!same && (
          <ShareButton
            title={`${teamA.shortName} vs ${teamB.shortName}`}
            text={`${favorite.shortName} ${pct(favProb)} ${venue === 'neutral' ? 'on neutral ground' : `at ${(venue === 'a' ? teamA : teamB).shortName}`}, on ShadowCrypts Predictions:`}
          />
        )}
      </div>

      <section className="card relative overflow-hidden p-4 sm:p-7" aria-live="polite">
        {/* Each half in its team's color, meeting on a slant, like a game page. */}
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.22]"
          style={{ background: `linear-gradient(105deg, ${colors.away} 0%, transparent 48%, transparent 52%, ${colors.home} 100%)` }}
          aria-hidden
        />
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.3]"
          style={{ background: `radial-gradient(40% 70% at 10% 30%, ${colors.away}, transparent 70%), radial-gradient(40% 70% at 90% 30%, ${colors.home}, transparent 70%)` }}
          aria-hidden
        />
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/25 to-transparent" aria-hidden />

        <div className="relative">
          <div className="flex items-start gap-2 sm:gap-6">
            <TeamPicker
              label={venue === 'a' ? 'Home' : venue === 'b' ? 'Away' : 'Team A'}
              value={a}
              teams={league.teams}
              onChange={setA}
              color={colors.away}
              chance={same ? null : result.probability}
              favored={result.probability >= 0.5}
            />
            <div className="flex flex-col items-center gap-3 self-center pt-6">
              <span className="font-display text-sm font-semibold uppercase tracking-[0.2em] text-ink-3">vs</span>
              <button
                type="button"
                onClick={() => {
                  setA(b);
                  setB(a);
                  setVenue((v) => (v === 'a' ? 'b' : v === 'b' ? 'a' : v));
                }}
                className="rounded-full bg-surface/80 p-2 text-ink-2 ring-1 ring-line transition hover:bg-raised hover:text-ink"
                aria-label="Swap teams"
                title="Swap teams"
              >
                <ArrowLeftRight className="h-4 w-4" aria-hidden />
              </button>
            </div>
            <TeamPicker
              label={venue === 'b' ? 'Home' : venue === 'a' ? 'Away' : 'Team B'}
              value={b}
              teams={league.teams}
              onChange={setB}
              color={colors.home}
              chance={same ? null : 1 - result.probability}
              favored={result.probability < 0.5}
            />
          </div>

          <div className="mt-6 flex justify-center">
            <div className="flex rounded-full bg-surface/80 p-0.5 ring-1 ring-line backdrop-blur" role="group" aria-label="Venue">
              {(
                [
                  ['a', `At ${teamA.abbr}`],
                  ['neutral', 'Neutral'],
                  ['b', `At ${teamB.abbr}`]
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setVenue(id)}
                  aria-pressed={venue === id}
                  className={`rounded-full px-4 py-1.5 text-sm font-medium transition ${venue === id ? 'bg-raised text-ink ring-1 ring-line-strong' : 'text-ink-3 hover:text-ink'}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {same ? (
            <p className="mt-6 text-center text-ink-3">Pick two different teams.</p>
          ) : (
            <>
              <div className="mx-auto mt-6 max-w-2xl">
                <ProbabilityMeter
                  awayAbbr={teamA.abbr}
                  homeAbbr={teamB.abbr}
                  homeProb={1 - result.probability}
                  pick={result.probability >= 0.5 ? 'away' : 'home'}
                  size="xl"
                  bare
                  colors={colors}
                />
              </div>
              <p className="mt-4 text-center text-sm text-ink-2">
                {venue === 'neutral' ? 'On neutral ground' : `At ${(venue === 'a' ? teamA : teamB).shortName}`}:{' '}
                <span className="font-semibold text-ink">
                  {favorite.shortName} {pct(favProb)}
                </span>
                <span className="text-ink-3 tabular">
                  {' '}
                  · projected {teamA.abbr} {score.a.toFixed(1)} – {score.b.toFixed(1)} {teamB.abbr}
                </span>
              </p>
              <dl className="mx-auto mt-6 grid max-w-2xl grid-cols-2 gap-3 text-sm sm:grid-cols-3">
                <div className="rounded-xl bg-surface/70 p-3 ring-1 ring-line backdrop-blur">
                  <dt className="text-xs text-ink-3">Elo ratings alone</dt>
                  <dd className="mt-1 font-display text-lg font-bold text-ink tabular">
                    {teamA.abbr} {pct(result.elo)}
                  </dd>
                </div>
                <div className="rounded-xl bg-surface/70 p-3 ring-1 ring-line backdrop-blur">
                  <dt className="text-xs text-ink-3">Market-implied alone</dt>
                  <dd className="mt-1 font-display text-lg font-bold text-ink tabular">
                    {teamA.abbr} {pct(result.market)}
                  </dd>
                </div>
                {series && (
                  <div className="col-span-2 rounded-xl bg-accent/10 p-3 ring-1 ring-accent/40 sm:col-span-1">
                    <dt className="text-xs text-ink-3">Best of 7, {series.host.abbr} home court</dt>
                    <dd className="mt-1 font-display text-lg font-bold text-ink tabular">
                      {(series.win >= 0.5 ? series.host : series.guest).abbr} {pct(Math.max(series.win, 1 - series.win))}
                    </dd>
                  </div>
                )}
              </dl>
            </>
          )}
          <p className="mx-auto mt-5 max-w-xl text-center text-xs text-ink-3">
            Both teams at full strength. Real game forecasts also count injuries, rest, travel and starters, and follow the betting line once one is
            posted.
          </p>
        </div>
      </section>

      {!same && tape.length >= 2 && (
        <Section title="Tale of the tape" subtitle={tapeNote(tape, league.tape.when, league.id)}>
          <TaleOfTheTape rows={tape} left={{ ...teamA, color: colors.away }} right={{ ...teamB, color: colors.home }} />
        </Section>
      )}
    </div>
  );
}
