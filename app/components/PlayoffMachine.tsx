'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { pctCapped } from '../../lib/format';
import { biggestMoves, decodePicks, encodePicks, homeChance, Picks, runTheTable, togglePick, withoutTeam } from '../../lib/model/machine';
import type { MachineGame, MachineInput } from '../../lib/model/projections';
import { createSeasonSimulator, TeamOutlook } from '../../lib/model/season';
import { etDateKey, formatLongDay } from '../../lib/time';
import { LocalTime } from './LocalTime';
import { ShareButton } from './ShareButton';
import { TeamLogo } from './TeamLogo';

export type MachineTeam = { id: string; abbr: string; shortName: string; logo: string | null; color: string };

/** Enough to see a real move, few enough to answer within a second or two on a phone. */
const SIMS = 4000;
const SLICE = 100;
/** The same luck in every run, so a change comes from the picks and not from the dice. */
const SEED = 20_261_104;
const PAUSE_MS = 250;
const PAGE = 30;

/** Runs a scenario a slice at a time so the page stays responsive; null until it's done, and it starts over when the picks change. */
function useScenario(machine: MachineInput, picks: Picks | null) {
  const [result, setResult] = useState<{ key: string; teams: TeamOutlook[] } | null>(null);
  const [progress, setProgress] = useState(0);
  const key = picks === null ? null : encodePicks(picks);
  useEffect(() => {
    if (key === null) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const decided = decodePicks(key, machine.games);
    const sim = createSeasonSimulator(
      { ...machine.input, games: machine.games.map((g) => ({ homeId: g.homeId, awayId: g.awayId, diff: g.diff, winner: decided[g.id] })) },
      { sims: SIMS, seed: SEED, otRate: machine.otRate ?? undefined }
    );
    const step = () => {
      if (cancelled) return;
      sim.run(SLICE);
      setProgress(sim.done / sim.total);
      if (sim.done < sim.total) timer = setTimeout(step, 0);
      else setResult({ key, teams: sim.result().teams });
    };
    timer = setTimeout(step, PAUSE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [key, machine]);
  return { teams: result && result.key === key ? result.teams : null, progress };
}

function Change({ from, to }: { from: number; to: number }) {
  const points = Math.round((to - from) * 100);
  // Always the same width, so the percentages line up whether or not a row moved.
  return (
    <span className={`ml-1 inline-block w-8 text-right text-xs font-semibold tabular ${points > 0 ? 'text-good' : 'text-bad'}`}>
      {points !== 0 && `${points > 0 ? '+' : '−'}${Math.abs(points)}`}
    </span>
  );
}

function Standings({
  league,
  conference,
  teams,
  before,
  info,
  focus
}: {
  league: string;
  conference: { abbr: string; name: string };
  teams: TeamOutlook[];
  before: Map<string, TeamOutlook> | null;
  info: Map<string, MachineTeam>;
  focus: string;
}) {
  const rows = teams.filter((t) => t.conference === conference.abbr).sort((a, b) => b.playoffs - a.playoffs || b.wins - a.wins);
  return (
    <div className="min-w-0">
      <h3 className="mb-2 text-sm font-semibold text-ink">{conference.name}</h3>
      <table className="w-full text-sm">
        <caption className="sr-only">{conference.name} playoff chances with these picks</caption>
        <thead>
          <tr className="text-left text-xs text-ink-3">
            <th scope="col" className="pb-1.5 font-medium">
              Team
            </th>
            <th scope="col" className="pb-1.5 text-right font-medium" title="Average wins across the simulations">
              Wins
            </th>
            <th scope="col" className="pb-1.5 text-right font-medium">
              Playoffs
            </th>
            <th scope="col" className="pb-1.5 text-right font-medium">
              Title
            </th>
          </tr>
        </thead>
        <tbody className="tabular">
          {rows.map((t) => {
            const team = info.get(t.id);
            const was = before?.get(t.id);
            return (
              <tr key={t.id} className={`border-t border-line ${t.id === focus ? 'bg-accent/10' : ''}`}>
                <td className="py-1.5 pr-2">
                  <Link href={`/${league}/team/${t.id}`} className="flex min-w-0 items-center gap-2 hover:underline">
                    <TeamLogo src={team?.logo ?? null} abbr={team?.abbr ?? ''} size={20} />
                    <span className="truncate font-medium text-ink">{team?.abbr}</span>
                  </Link>
                </td>
                <td className="py-1.5 pl-2 text-right text-ink-2">{t.wins.toFixed(1)}</td>
                <td className="whitespace-nowrap py-1.5 pl-2 text-right font-semibold text-ink">
                  {pctCapped(t.playoffs)}
                  {was && <Change from={was.playoffs} to={t.playoffs} />}
                </td>
                <td className="py-1.5 pl-2 text-right text-ink-2">{pctCapped(t.title)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function GameRow({ game, info, pick, onPick }: { game: MachineGame; info: Map<string, MachineTeam>; pick: 'home' | 'away' | undefined; onPick: (side: 'home' | 'away') => void }) {
  const home = info.get(game.homeId);
  const away = info.get(game.awayId);
  const chance = homeChance(game.diff);
  const side = (which: 'home' | 'away', team: MachineTeam | undefined, value: number) => (
    <button
      type="button"
      onClick={() => onPick(which)}
      aria-pressed={pick === which}
      className={`flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2.5 py-2 text-left ring-1 transition ${
        pick === which ? 'bg-accent/15 ring-accent' : pick ? 'opacity-50 ring-line hover:opacity-100' : 'ring-line hover:bg-raised'
      }`}
    >
      <TeamLogo src={team?.logo ?? null} abbr={team?.abbr ?? ''} size={22} />
      <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">{team?.abbr}</span>
      <span className="text-xs text-ink-3 tabular">{pctCapped(value)}</span>
    </button>
  );
  return (
    <li className="py-1.5">
      <p className="mb-1 text-[11px] text-ink-3">
        <LocalTime iso={game.date} show="time" />
      </p>
      <div className="flex items-center gap-2" role="group" aria-label={`${away?.shortName} at ${home?.shortName}: pick a winner`}>
        {side('away', away, 1 - chance)}
        <span className="text-xs text-ink-3" aria-hidden>
          @
        </span>
        {side('home', home, chance)}
      </div>
    </li>
  );
}

/**
 * Pick winners and watch the playoff race change: the season simulation run
 * again in the browser with those games decided, next to the same run without
 * them, with the same luck in both so what moves is what the picks moved.
 */
export function PlayoffMachine({ league, leagueName, machine, teams, initial }: { league: string; leagueName: string; machine: MachineInput; teams: MachineTeam[]; initial: TeamOutlook[] | null }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const info = useMemo(() => new Map(teams.map((t) => [t.id, t])), [teams]);
  const [picks, setPicks] = useState<Picks>(() => decodePicks(params.get('p'), machine.games));
  const [focus, setFocus] = useState(() => (info.has(params.get('team') ?? '') ? params.get('team')! : ''));
  const [shown, setShown] = useState(PAGE);

  const count = Object.keys(picks).length;
  const code = encodePicks(picks);
  // Kept in the address, so a scenario can be shared or come back to.
  useEffect(() => {
    const query = new URLSearchParams();
    if (focus) query.set('team', focus);
    if (code) query.set('p', code);
    router.replace(query.size ? `${pathname}?${query}` : pathname, { scroll: false });
  }, [code, focus, pathname, router]);

  // The plain run only starts once there's something to compare it with.
  const plain = useMemo(() => (count ? ({} as Picks) : null), [count]);
  const base = useScenario(machine, plain);
  const scenario = useScenario(machine, count ? picks : null);
  const shownTeams = count ? scenario.teams : initial;
  const before = useMemo(() => (count && base.teams ? new Map(base.teams.map((t) => [t.id, t])) : null), [count, base.teams]);
  const moves = count && base.teams && scenario.teams ? biggestMoves(base.teams, scenario.teams) : [];
  const running = count > 0 && (!scenario.teams || !base.teams);
  const progress = count ? (scenario.progress + base.progress) / 2 : 0;

  const games = useMemo(() => (focus ? machine.games.filter((g) => g.homeId === focus || g.awayId === focus) : machine.games), [focus, machine.games]);
  const days = useMemo(() => {
    const groups: { day: string; games: MachineGame[] }[] = [];
    for (const g of games.slice(0, shown)) {
      const day = etDateKey(g.date);
      const last = groups[groups.length - 1];
      if (last?.day === day) last.games.push(g);
      else groups.push({ day, games: [g] });
    }
    return groups;
  }, [games, shown]);
  const focused = focus ? info.get(focus) : undefined;
  const moveText = moves.map((m) => `${info.get(m.id)?.abbr} ${pctCapped(m.from)} to ${pctCapped(m.to)}`).join(', ');

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
      <section aria-labelledby="machine-games" className="card min-w-0 p-4 sm:p-5">
        <h2 id="machine-games" className="font-display text-lg font-semibold text-ink">
          Pick your winners
        </h2>
        <p className="mt-1 text-sm text-ink-3">Tap a team to decide its game; tap it again to leave the game to chance. The percentages are our forecast.</p>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <select
            value={focus}
            onChange={(e) => {
              setFocus(e.target.value);
              setShown(PAGE);
            }}
            aria-label="Show one team's games"
            className="h-9 min-w-0 max-w-full rounded-lg bg-surface px-3 text-sm text-ink ring-1 ring-line focus:outline-none focus:ring-accent"
          >
            <option value="">Every game</option>
            {[...teams].sort((a, b) => a.shortName.localeCompare(b.shortName)).map((t) => (
              <option key={t.id} value={t.id}>
                {t.shortName}
              </option>
            ))}
          </select>
          {focus && (
            <>
              <button type="button" onClick={() => setPicks(runTheTable(picks, machine.games, focus, true))} className="chip chip-idle">
                Win out
              </button>
              <button type="button" onClick={() => setPicks(runTheTable(picks, machine.games, focus, false))} className="chip chip-idle">
                Lose out
              </button>
              <button type="button" onClick={() => setPicks(withoutTeam(picks, machine.games, focus))} className="chip chip-idle">
                Clear {focused?.abbr}
              </button>
            </>
          )}
        </div>
        <div className="mt-4 space-y-4">
          {days.map(({ day, games: list }) => (
            <div key={day}>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-3">{formatLongDay(`${day}T16:00:00Z`)}</h3>
              <ul className="mt-1">
                {list.map((g) => (
                  <GameRow key={g.id} game={g} info={info} pick={picks[g.id]} onPick={(side) => setPicks(togglePick(picks, g.id, side))} />
                ))}
              </ul>
            </div>
          ))}
        </div>
        {games.length > shown && (
          <button type="button" onClick={() => setShown((s) => s + PAGE)} className="chip chip-idle mt-4 w-full justify-center">
            Show more games ({games.length - shown} left)
          </button>
        )}
      </section>

      {/* On a phone the race sits below the games, so what a pick did stays in view while picking. */}
      {count > 0 && (
        <a
          href="#machine-results"
          className="card fixed inset-x-3 bottom-20 z-30 flex items-center justify-between gap-3 px-3.5 py-2.5 text-xs shadow-xl ring-1 ring-accent/50 lg:hidden"
        >
          <span className="min-w-0 flex-1 truncate text-ink-2">
            {running ? (
              'Playing out the season…'
            ) : moves.length ? (
              moves.map((m, i) => (
                <span key={m.id}>
                  {i > 0 && ' · '}
                  <span className="font-semibold text-ink">{info.get(m.id)?.abbr}</span> {pctCapped(m.from)} → {pctCapped(m.to)}
                </span>
              ))
            ) : (
              'Barely moves anyone'
            )}
          </span>
          <span className="shrink-0 font-semibold text-accent-strong">See the race ↓</span>
        </a>
      )}

      <section id="machine-results" aria-labelledby="machine-results-title" className="card min-w-0 scroll-mt-24 self-start p-4 sm:p-5 lg:sticky lg:top-24">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="machine-results-title" className="font-display text-lg font-semibold text-ink">
            {count ? `With your ${count === 1 ? 'pick' : `${count} picks`}` : 'The race now'}
          </h2>
          {count > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <ShareButton title={`${leagueName} playoff scenario`} text={`${leagueName} playoffs with my ${count === 1 ? 'pick' : `${count} picks`}${moveText ? `: ${moveText}` : ''}. Try yours on ShadowCrypts Predictions:`} />
              <button type="button" onClick={() => setPicks({})} className="chip chip-idle">
                Start over
              </button>
            </div>
          )}
        </div>
        <div aria-live="polite">
          {running ? (
            <p className="mt-2 text-sm text-ink-3">Playing out the season {SIMS.toLocaleString()} times…</p>
          ) : moves.length ? (
            <p className="mt-2 text-sm text-ink-2">
              Biggest moves:{' '}
              {moves.map((m, i) => (
                <span key={m.id}>
                  {i > 0 && ' · '}
                  <span className="font-semibold text-ink">{info.get(m.id)?.abbr}</span> {pctCapped(m.from)} → {pctCapped(m.to)}
                </span>
              ))}
            </p>
          ) : count ? (
            <p className="mt-2 text-sm text-ink-3">Those picks barely move anyone&apos;s playoff chances.</p>
          ) : (
            <p className="mt-2 text-sm text-ink-3">Each team&apos;s chances from our simulation of the rest of the season. Pick a game to see them change.</p>
          )}
        </div>
        <div className="mt-2 h-0.5 overflow-hidden rounded-full" aria-hidden>
          {running && <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${Math.round(progress * 100)}%` }} />}
        </div>
        {shownTeams ? (
          <div className={`mt-3 grid gap-6 sm:grid-cols-2 ${running ? 'opacity-60' : ''}`}>
            {machine.conferences.map((c) => (
              <Standings key={c.abbr} league={league} conference={c} teams={shownTeams} before={before} info={info} focus={focus} />
            ))}
          </div>
        ) : (
          <p className="mt-4 text-sm text-ink-3">{count ? 'Working it out…' : 'The season simulation is still running. Check back in a moment, or pick a game to run your own.'}</p>
        )}
        <p className="mt-4 text-xs text-ink-3">
          Your picks change the standings, not how good we think each team is. Standings ties are broken by coin flip rather than each league&apos;s tiebreakers, and a few percentage points
          either way can be chance. For insight and fun, not betting advice.
        </p>
      </section>
    </div>
  );
}
