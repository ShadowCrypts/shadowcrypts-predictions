import Link from 'next/link';
import type { GameSide } from '../../lib/espn';
import type { GameCenter as Center, Play } from '../../lib/gamecenter';
import { PlayerPhoto } from './PlayerPhoto';
import { EmptyState } from './Section';
import { TeamLogo } from './TeamLogo';

/** Leagues whose players have pages of their own (the ones with a player model). */
const PLAYER_PAGES = new Set(['nba', 'nhl', 'nfl']);
/** Latest plays shown above the scoring summary while a game is on. */
const LATEST_PLAYS = 5;

function PlayRow({ play, away, home }: { play: Play; away: GameSide; home: GameSide }) {
  const team = play.teamId === home.teamId ? home : play.teamId === away.teamId ? away : null;
  return (
    <li className="flex gap-3 py-2.5">
      <span className="w-11 shrink-0 text-xs text-ink-3 tabular sm:w-14">
        {play.period}
        {play.clock && <span className="block">{play.clock}</span>}
      </span>
      {team ? <TeamLogo src={team.logo} abbr={team.abbr} size={20} /> : <span className="w-5 shrink-0" />}
      <span className={`min-w-0 flex-1 text-sm ${play.scoring ? 'text-ink' : 'text-ink-2'}`}>{play.text}</span>
      {play.awayScore !== null && play.homeScore !== null && (
        <span className="shrink-0 text-xs font-semibold text-ink-2 tabular">
          {play.awayScore}–{play.homeScore}
        </span>
      )}
    </li>
  );
}

/** Top performers, the scoring summary and (while live) the latest plays. */
export function GameCenter({
  center,
  away,
  home,
  live,
  league,
  colors
}: {
  center: Center;
  away: GameSide;
  home: GameSide;
  live: boolean;
  league: string;
  /** Each team's color as the page draws it, for the performers' photos. */
  colors?: { away: string; home: string };
}) {
  // Basketball flags every basket as scoring, so its summary is the latest plays instead.
  const showScoring = league !== 'nba' && center.scoring.length > 0;
  const plays = showScoring ? [...center.scoring].reverse() : center.recent;
  // While it's on, the latest plays too: a game between scores still has plenty happening.
  const latest = live && showScoring ? center.recent.slice(0, LATEST_PLAYS) : [];
  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
      <div>
        <h3 className="mb-3 text-sm font-semibold text-ink">Top performers</h3>
        {center.leaders.length ? (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
            {[away, home].map((side) => {
              const team = center.leaders.find((t) => t.teamId === side.teamId);
              return (
                <div key={side.teamId}>
                  <div className="mb-2 flex items-center gap-2">
                    <TeamLogo src={side.logo} abbr={side.abbr} size={20} />
                    <span className="text-sm font-semibold text-ink">{side.shortName}</span>
                  </div>
                  <ul className="divide-y divide-line">
                    {(team?.performers ?? []).map((p) => (
                      <li key={p.category} className="flex items-center gap-2.5 py-2 text-sm">
                        {p.id && <PlayerPhoto league={league} id={p.id} name={p.name} size={32} ring={side === away ? colors?.away : colors?.home} />}
                        <span className="flex min-w-0 flex-1 flex-col gap-0.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-3">
                          <span className="min-w-0">
                            {p.id && PLAYER_PAGES.has(league) ? (
                              <Link href={`/${league}/player/${p.id}`} className="block truncate text-ink hover:underline">
                                {p.name}
                              </Link>
                            ) : (
                              <span className="block truncate text-ink">{p.name}</span>
                            )}
                            <span className="text-xs text-ink-3">{p.category}</span>
                          </span>
                          <span className="text-xs font-semibold text-ink-2 tabular sm:shrink-0 sm:text-right">{p.value}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        ) : (
          <EmptyState>{live ? 'Stats appear as the game goes.' : 'No stats on file for this game.'}</EmptyState>
        )}
      </div>
      <div>
        {latest.length > 0 && (
          <div className="mb-6">
            <h3 className="mb-3 text-sm font-semibold text-ink">Latest plays</h3>
            <ul className="divide-y divide-line">
              {latest.map((play, i) => (
                <PlayRow key={`${play.period}-${play.clock}-${i}`} play={play} away={away} home={home} />
              ))}
            </ul>
          </div>
        )}
        <h3 className="mb-3 text-sm font-semibold text-ink">{showScoring ? 'Scoring summary' : live ? 'Latest plays' : 'Last plays'}</h3>
        {plays.length ? (
          <ul className="max-h-[420px] divide-y divide-line overflow-y-auto pr-1">
            {plays.slice(0, 40).map((play, i) => (
              <PlayRow key={`${play.period}-${play.clock}-${i}`} play={play} away={away} home={home} />
            ))}
          </ul>
        ) : (
          <EmptyState>{live ? 'No plays yet.' : 'No plays to show.'}</EmptyState>
        )}
      </div>
    </div>
  );
}
