'use client';

import { ArrowRight, CalendarDays, CornerDownLeft, Search as SearchIcon, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { findGames, findPlayers, GameHit, PlayerHit, PLAYERS_URL, queryTerms, searchable } from '../../../lib/search';
import { playerKey, teamKey, useFavorites, useFollowedPlayers } from '../favorites';
import { PlayerPhoto } from '../PlayerPhoto';
import { TeamLogo } from '../TeamLogo';

const noop = () => () => {};

type TeamHit = { league: string; id: string; abbr: string; name: string; shortName: string; logo: string | null };
type Item = { key: string; href: string; title: string; detail: string; team?: TeamHit; player?: PlayerHit; game?: GameHit };

/** Fetches a list for search once, on first open; null until it arrives, 'failed' if it can't. */
function useList<T>(open: boolean, url: string, pick: (data: unknown) => T[]) {
  const [list, setList] = useState<T[] | null | 'failed'>(null);
  useEffect(() => {
    if (!open || list !== null) return;
    let live = true;
    fetch(url)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data) => live && setList(pick(data)))
      .catch(() => live && setList('failed'));
    return () => {
      live = false;
    };
  }, [open, list, url, pick]);
  return list;
}

const pickTeams = (data: unknown) => (data as { teams: TeamHit[] }).teams;
const pickPlayers = (data: unknown) => (data as { players: PlayerHit[] }).players;
const pickGames = (data: unknown) => (data as { games: GameHit[] }).games;
/** Game times in the viewer's own zone (search only renders in the browser). */
const when = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

const PAGES: Item[] = [
  { key: 'p-today', href: '/', title: 'Today', detail: 'Every game on the board' },
  { key: 'p-live', href: '/live', title: 'Live mode', detail: 'Every game on now, and your parlays sweating in real time' },
  { key: 'p-nfl', href: '/nfl', title: 'NFL', detail: 'Games, power rankings, track record' },
  { key: 'p-nba', href: '/nba', title: 'NBA', detail: 'Games, power rankings, track record' },
  { key: 'p-mlb', href: '/mlb', title: 'MLB', detail: 'Games, power rankings, track record' },
  { key: 'p-nhl', href: '/nhl', title: 'NHL', detail: 'Games, power rankings, track record' },
  { key: 'p-results', href: '/results', title: 'Results', detail: 'Any date, and how the forecasts did' },
  { key: 'p-picks', href: '/picks', title: 'Your picks', detail: 'Pick winners and see your record against the model' },
  { key: 'p-matchup', href: '/matchup', title: 'Matchup machine', detail: 'Any two teams, head to head' },
  { key: 'p-parlay', href: '/parlay', title: 'Your parlay', detail: 'What a parlay is really worth before you place it' },
  { key: 'p-props', href: '/props', title: 'Player props', detail: 'Every posted prop with our projection, the real over chance, and where the model disagrees' },
  { key: 'p-nba-players', href: '/nba/players', title: 'NBA player ratings', detail: 'Every player behind the lineup model' },
  { key: 'p-nfl-qbs', href: '/nfl/players', title: 'NFL quarterback ratings', detail: 'Every passer behind the quarterback model' },
  { key: 'p-nhl-players', href: '/nhl/players', title: 'NHL players', detail: 'Every skater and goalie with props and recent games' },
  { key: 'p-standings-nfl', href: '/nfl/standings', title: 'NFL standings', detail: 'Records by division and conference, with playoff chances' },
  { key: 'p-standings-nba', href: '/nba/standings', title: 'NBA standings', detail: 'Records by division and conference, with playoff chances' },
  { key: 'p-standings-mlb', href: '/mlb/standings', title: 'MLB standings', detail: 'Records by division and conference, with playoff chances' },
  { key: 'p-standings-nhl', href: '/nhl/standings', title: 'NHL standings', detail: 'Records by division and conference, with playoff chances' },
  { key: 'p-injuries-nfl', href: '/nfl/injuries', title: 'NFL injury report', detail: "Who's out, and what each absence costs in the forecast" },
  { key: 'p-injuries-nba', href: '/nba/injuries', title: 'NBA injury report', detail: "Who's out, and what each absence costs in the forecast" },
  { key: 'p-injuries-mlb', href: '/mlb/injuries', title: 'MLB injury report', detail: "Who's out, and what each absence costs in the forecast" },
  { key: 'p-injuries-nhl', href: '/nhl/injuries', title: 'NHL injury report', detail: "Who's out, and what each absence costs in the forecast" },
  { key: 'p-fantasy', href: '/nfl/fantasy', title: 'Fantasy football rankings', detail: 'Projected points this week, PPR, half PPR or standard' },
  { key: 'p-machine-nfl', href: '/nfl/playoffs', title: 'NFL playoff machine', detail: 'Pick winners and watch every team\'s playoff chances change' },
  { key: 'p-machine-nba', href: '/nba/playoffs', title: 'NBA playoff machine', detail: 'Pick winners and watch every team\'s playoff chances change' },
  { key: 'p-machine-nhl', href: '/nhl/playoffs', title: 'NHL playoff machine', detail: 'Pick winners and watch every team\'s playoff chances change' },
  { key: 'p-compare', href: '/nba/compare', title: 'Compare players', detail: 'Any two players side by side: projections, lines and recent form' },
  { key: 'p-record', href: '/record', title: 'Track record', detail: 'Every graded forecast and how the model works' },
  { key: 'p-privacy', href: '/privacy', title: 'Privacy', detail: 'What the site keeps about you (almost nothing)' }
];

export function Search() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const teamList = useList(open, '/api/teams', pickTeams);
  const playerList = useList(open, PLAYERS_URL, pickPlayers);
  const gameList = useList(open, '/api/games', pickGames);
  const [active, setActive] = useState(0);
  const shortcut = useSyncExternalStore(noop, () => (/Mac|iPhone|iPad/.test(navigator.platform) ? '⌘K' : 'Ctrl K'), () => 'Ctrl K');
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const opener = useRef<HTMLElement | null>(null);

  const show = useCallback(() => {
    opener.current = document.activeElement as HTMLElement | null;
    setOpen(true);
  }, []);
  const close = useCallback(() => {
    setOpen(false);
    setQuery('');
    setActive(0);
    opener.current?.focus?.();
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const typing = event.target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName);
      if ((event.key === 'k' && (event.metaKey || event.ctrlKey)) || (event.key === '/' && !typing)) {
        event.preventDefault();
        show();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [show]);

  useEffect(() => {
    if (!open) return;
    input.current?.focus();
    const original = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = original;
    };
  }, [open]);

  const teams = Array.isArray(teamList) ? teamList : null;
  const players = Array.isArray(playerList) ? playerList : null;
  const games = Array.isArray(gameList) ? gameList : null;
  const { favorites } = useFavorites();
  const { players: followedPlayers } = useFollowedPlayers();
  const items = useMemo(() => {
    const terms = queryTerms(query);
    const matches = (text: string) => terms.every((t) => searchable(text).includes(t));
    const pages = PAGES.filter((p) => !terms.length || matches(`${p.title} ${p.detail}`));
    const teamItem = (t: TeamHit): Item => ({ key: `t-${t.league}-${t.id}`, href: `/${t.league}/team/${t.id}`, title: t.name, detail: t.league.toUpperCase(), team: t });
    const playerItem = (p: PlayerHit): Item => ({
      key: `pl-${p.league}-${p.id}`,
      href: `/${p.league}/player/${p.id}`,
      title: p.name,
      detail: `${p.team ? `${p.team} · ` : ''}${p.league.toUpperCase()} · props and recent games`,
      player: p
    });
    // Nothing typed yet: who you follow comes first, a keystroke away.
    if (!terms.length) {
      const mine = [
        ...(teams ?? []).filter((t) => favorites.has(teamKey(t.league, t.id))).map(teamItem),
        ...(players ?? []).filter((p) => followedPlayers.has(playerKey(p.league, p.id))).map(playerItem)
      ].slice(0, 8);
      return [...mine, ...pages];
    }
    const teamItems = (teams ?? [])
      .filter((t) => matches(`${t.name} ${t.abbr} ${t.shortName} ${t.league}`))
      .sort((a, b) => Number(b.abbr.toLowerCase() === terms[0]) - Number(a.abbr.toLowerCase() === terms[0]) || a.name.localeCompare(b.name))
      .slice(0, 6)
      .map(teamItem);
    const gameItems: Item[] = findGames(games ?? [], query).map((g) => ({
      key: `g-${g.league}-${g.id}`,
      href: `/${g.league}/game/${g.id}`,
      title: `${g.away.shortName} @ ${g.home.shortName}`,
      detail: `${g.league.toUpperCase()} · ${g.state === 'in' ? 'On now' : when.format(new Date(g.date))}`,
      game: g
    }));
    return [...teamItems, ...gameItems, ...findPlayers(players ?? [], query).map(playerItem), ...pages];
  }, [query, teams, players, games, favorites, followedPlayers]);
  const loading = query.trim() !== '' && (teamList === null || playerList === null);

  useEffect(() => {
    list.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const go = (item: Item | undefined) => {
    if (!item) return;
    close();
    router.push(item.href);
  };

  const onInputKey = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((i) => Math.min(items.length - 1, i + 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      go(items[active]);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      close();
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={show}
        className="flex h-9 items-center gap-2 rounded-lg px-2.5 text-sm text-ink-3 ring-1 ring-line transition hover:bg-raised hover:text-ink lg:w-56"
        aria-label="Search teams, players and pages"
        aria-keyshortcuts="Control+K Meta+K"
      >
        <SearchIcon className="h-4 w-4" aria-hidden />
        <span className="hidden lg:inline">Teams, players…</span>
        <kbd className="ml-auto hidden rounded border border-line px-1.5 text-[10px] font-semibold text-ink-3 lg:inline">{shortcut}</kbd>
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 px-4 pt-[12vh] backdrop-blur-sm" onMouseDown={close}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Search"
            className="w-full max-w-lg animate-fade-up overflow-hidden rounded-2xl border border-line-strong bg-surface shadow-2xl"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 border-b border-line px-4">
              <SearchIcon className="h-4 w-4 shrink-0 text-ink-3" aria-hidden />
              <input
                ref={input}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setActive(0);
                }}
                onKeyDown={onInputKey}
                placeholder="Search a team, player or page"
                className="h-14 w-full bg-transparent text-base text-ink placeholder:text-ink-3 focus:outline-none"
                role="combobox"
                aria-expanded="true"
                aria-controls="search-results"
                aria-activedescendant={items[active] ? `search-${items[active].key}` : undefined}
                autoComplete="off"
                spellCheck={false}
              />
              <button type="button" onClick={close} className="rounded-md p-1 text-ink-3 hover:bg-raised hover:text-ink" aria-label="Close search">
                <X className="h-4 w-4" aria-hidden />
              </button>
            </div>
            <ul ref={list} id="search-results" role="listbox" className="max-h-[50vh] overflow-y-auto p-2">
              {items.map((item, i) => (
                <li
                  key={item.key}
                  id={`search-${item.key}`}
                  data-index={i}
                  role="option"
                  aria-selected={i === active}
                  onMouseMove={() => setActive(i)}
                  onClick={() => go(item)}
                  className={`flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 ${i === active ? 'bg-raised' : ''}`}
                >
                  {item.team ? (
                    <TeamLogo src={item.team.logo} abbr={item.team.abbr} size={28} />
                  ) : item.player ? (
                    <PlayerPhoto league={item.player.league} id={item.player.id} name={item.player.name} size={28} />
                  ) : item.game ? (
                    <span className={`flex h-7 w-7 items-center justify-center rounded-lg ${item.game.state === 'in' ? 'bg-live/15 text-live' : 'bg-accent-2/15 text-accent-2'}`}>
                      <CalendarDays className="h-3.5 w-3.5" aria-hidden />
                    </span>
                  ) : (
                    <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent/15 text-accent-strong">
                      <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                    </span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-ink">{item.title}</span>
                    <span className="block truncate text-xs text-ink-3">{item.detail}</span>
                  </span>
                  {i === active && <CornerDownLeft className="h-3.5 w-3.5 text-ink-3" aria-hidden />}
                </li>
              ))}
              {loading && <li className="px-3 py-2 text-sm text-ink-3">Loading teams and players…</li>}
              {(teamList === 'failed' || playerList === 'failed') && (
                <li className="px-3 py-2 text-sm text-ink-3">{teamList === 'failed' && playerList === 'failed' ? 'Team and player' : teamList === 'failed' ? 'Team' : 'Player'} search is unavailable right now.</li>
              )}
              {query.trim() && !loading && items.length === 0 && <li className="px-3 py-6 text-center text-sm text-ink-3">No matches for “{query}”.</li>}
            </ul>
          </div>
        </div>
      )}
    </>
  );
}
