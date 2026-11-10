'use client';

import { pct, pctCapped } from '../../lib/format';
import type { CardData } from '../../lib/model/card';
import type { GameStakes } from '../../lib/model/season';
import { AlertSettings } from './AlertSettings';
import { teamKey, useFavorites } from './favorites';
import { GameCard } from './GameCard';
import { useLastVisit } from './visits';

/** Forecast history per game, keyed `league:gameId`: [time in ms, home win probability], oldest first. */
export type CompactHistory = Record<string, [number, number][]>;

/** Smallest change worth pointing out. */
const MIN_CHANGE = 0.01;

/** The home probability in effect at `time`: the last reading at or before it, or the first one if tracking began later. */
function probabilityAt(history: [number, number][] | undefined, time: number) {
  if (!history?.length) return null;
  let found = history[0][1];
  for (const [t, p] of history) {
    if (t <= time) found = p;
    else break;
  }
  return found;
}

function SinceLastVisit({ card, followed, history, lastVisit }: { card: CardData; followed: Set<string>; history: CompactHistory; lastVisit: number }) {
  if (card.state !== 'pre') return null;
  const then = probabilityAt(history[`${card.league}:${card.id}`], lastVisit);
  if (then === null || Math.abs(card.homeProb - then) < MIN_CHANGE) return null;
  // Told from your team's side; if you follow both, from the home side.
  const home = followed.has(teamKey(card.league, card.home.teamId)) || !followed.has(teamKey(card.league, card.away.teamId));
  const side = home ? card.home : card.away;
  const before = home ? then : 1 - then;
  const now = home ? card.homeProb : 1 - card.homeProb;
  return (
    <p className="mt-1.5 px-1 text-xs text-ink-3" title={`Last visit: ${new Date(lastVisit).toLocaleString()}`}>
      Since your last visit: {side.abbr}{' '}
      <span className="tabular">{pct(before)}</span> → <span className={`font-semibold tabular ${now > before ? 'text-good' : 'text-bad'}`}>{pct(now)}</span>
    </p>
  );
}

/** A followed team's playoff chance now, and with a win or a loss in this game, when the season simulation has them. */
function PlayoffLine({ card, followed, playoffs, stakes }: { card: CardData; followed: Set<string>; playoffs: Record<string, number>; stakes: Record<string, GameStakes> }) {
  const s = stakes[`${card.league}:${card.id}`];
  const home = followed.has(teamKey(card.league, card.home.teamId)) || !followed.has(teamKey(card.league, card.away.teamId));
  const side = home ? card.home : card.away;
  const now = playoffs[teamKey(card.league, side.teamId)];
  if (now === undefined || !s) return null;
  const stake = home ? s.home : s.away;
  // When this game can't move their odds a visible amount, just the odds.
  const moves = pctCapped(stake.ifWin) !== pctCapped(stake.ifLoss);
  return (
    <p className="mt-1 px-1 text-xs text-ink-3 tabular">
      Playoffs: {side.abbr} <span className="font-semibold text-ink-2">{pctCapped(now)}</span>
      {moves && ` · ${pctCapped(stake.ifWin)} with a win, ${pctCapped(stake.ifLoss)} with a loss`}
    </p>
  );
}

/** The next game for each followed team, at the top of the home page. Nothing shows until you follow a team. */
export function YourTeams({
  cards,
  history = {},
  playoffs = {},
  stakes = {}
}: {
  cards: CardData[];
  history?: CompactHistory;
  /** Playoff chances by "league:teamId", and each coming game's stakes by "league:gameId", from the season simulations. */
  playoffs?: Record<string, number>;
  stakes?: Record<string, GameStakes>;
}) {
  const { favorites } = useFavorites();
  const lastVisit = useLastVisit();
  if (!favorites.size) return null;
  const next = new Map<string, CardData>();
  for (const c of [...cards].sort((a, b) => a.date.localeCompare(b.date))) {
    if (c.completed) continue;
    for (const side of [c.home, c.away]) {
      const key = teamKey(c.league, side.teamId);
      if (favorites.has(key) && !next.has(key)) next.set(key, c);
    }
  }
  const games = [...new Map([...next.values()].map((c) => [c.id, c])).values()].sort((a, b) => a.date.localeCompare(b.date));
  return (
    <section aria-labelledby="your-teams-title">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 id="your-teams-title" className="font-display text-lg font-semibold tracking-tight text-ink sm:text-xl">
          Your teams
        </h2>
        <AlertSettings compact />
      </div>
      {games.length ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {games.slice(0, 8).map((c) => (
            <div key={c.id}>
              <GameCard card={c} showLeague />
              {lastVisit !== null && <SinceLastVisit card={c} followed={favorites} history={history} lastVisit={lastVisit} />}
              <PlayoffLine card={c} followed={favorites} playoffs={playoffs} stakes={stakes} />
            </div>
          ))}
        </div>
      ) : (
        <p className="rounded-xl border border-dashed border-line-strong px-4 py-5 text-center text-sm text-ink-3">
          None of your teams play in the next few days.
        </p>
      )}
    </section>
  );
}
