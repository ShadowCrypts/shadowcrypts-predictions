'use client';

import { Search } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { pct } from '../../lib/format';
import { marketLabel, PropMarket } from '../../lib/props';
import { searchable } from '../../lib/search';
import { LocalTime } from './LocalTime';
import { ParlayLeg, useParlay } from './parlay';
import { PlayerPhoto } from './PlayerPhoto';
import { ChanceBar } from './ChanceBar';
import { HitRate, HitStrip } from './HitStrip';
import { LineValue } from './LineValue';
import { EdgeRecord, EdgeTag, LegButton } from './PlayerProps';

/** One player's line in one market, flattened from a game's prop board. */
export type PropSpot = {
  key: string;
  league: string;
  gameId: string;
  game: string;
  start: string;
  playerId: string;
  name: string;
  teamId: string;
  team: string;
  detail: string;
  available: number;
  market: PropMarket;
  line: number;
  /** Where the line opened, when the book has moved it since. */
  openLine: number | null;
  /** His average in this stat over his last five games played. */
  recent: number | null;
  /** How often he cleared this line in his last ten games. */
  hits: HitRate | null;
  /** His team's color, for the ring around his photo. */
  teamColor: string;
  over: number | null;
  under: number | null;
  book: string;
  projection: number;
  forecastOver: number;
  modelOver: number;
  edge: { side: 'over' | 'under'; edge: number } | null;
};

type Sort = 'soonest' | 'disagreement' | 'gap' | 'moved' | 'hits';

/** A line's hit rate for sorting; too few games sorts last. */
const hitShare = (s: PropSpot) => (s.hits && s.hits.n >= 5 ? s.hits.hits / s.hits.n : -1);

/** How far the projection sits from the line, as a small arrow and number under it ("▲ 1.8"): which side the model's number is on, not a tip. */
function ProjectionGap({ projection, line }: { projection: number; line: number }) {
  const gap = projection - line;
  if (Math.abs(gap) < 0.05) return <span className="block text-[10px] text-ink-3">at the line</span>;
  return (
    <span className="block text-[10px] text-ink-3 tabular" title={`Our projection is ${Math.abs(gap).toFixed(1)} ${gap > 0 ? 'above' : 'below'} the line`}>
      {gap > 0 ? '▲' : '▼'} {Math.abs(gap).toFixed(1)}
      <span className="sr-only"> {gap > 0 ? 'above' : 'below'} the line</span>
    </span>
  );
}

/** How far a line has moved since it opened, relative to its size (0 when it hasn't, or the opening wasn't kept). */
const moved = (s: PropSpot) => (s.openLine === null ? 0 : Math.abs(s.line - s.openLine) / Math.max(1, s.openLine));

const PAGE = 120;

/**
 * Every posted prop line for one league's next games, filterable by stat,
 * player or team, with the model's disagreements tagged and parlay buttons.
 */
export function PropFinder({ spots, record }: { spots: PropSpot[]; record: EdgeRecord }) {
  const markets = useMemo(() => [...new Set(spots.map((s) => s.market))], [spots]);
  // Every game on the board, soonest first, for the game filter.
  const games = useMemo(
    () => [...new Map(spots.map((s) => [s.gameId, { id: s.gameId, label: s.game, start: s.start }])).values()].sort((a, b) => a.start.localeCompare(b.start)),
    [spots]
  );
  const [gameId, setGameId] = useState('all');
  const [market, setMarket] = useState<PropMarket | 'all'>('all');
  const [onlyTagged, setOnlyTagged] = useState(false);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<Sort>('soonest');
  const [shown, setShown] = useState(PAGE);
  const { legs, toggle } = useParlay();
  const chosen = new Set(legs.map((l) => l.key));

  const q = searchable(query);
  const filtered = spots
    .filter((s) => gameId === 'all' || s.gameId === gameId)
    .filter((s) => market === 'all' || s.market === market)
    .filter((s) => !onlyTagged || s.edge)
    .filter((s) => !q || searchable(`${s.name} ${s.team} ${s.game}`).includes(q))
    .sort((a, b) => {
      if (sort === 'disagreement') return (b.edge?.edge ?? 0) - (a.edge?.edge ?? 0) || a.start.localeCompare(b.start);
      if (sort === 'gap') return Math.abs(b.projection - b.line) / Math.max(1, b.line) - Math.abs(a.projection - a.line) / Math.max(1, a.line);
      if (sort === 'moved') return moved(b) - moved(a) || a.start.localeCompare(b.start);
      if (sort === 'hits') return hitShare(b) - hitShare(a) || (b.hits?.n ?? 0) - (a.hits?.n ?? 0) || a.start.localeCompare(b.start);
      return a.start.localeCompare(b.start) || a.game.localeCompare(b.game) || b.projection - a.projection;
    });
  const tagged = spots.filter((s) => s.edge).length;

  const legFor = (s: PropSpot, side: 'over' | 'under'): ParlayLeg => {
    const group = `${s.league}:${s.gameId}:${s.playerId}:${s.market}`;
    return {
      key: `${group}:${side}`,
      group,
      league: s.league,
      gameId: s.gameId,
      game: s.game,
      start: s.start,
      label: `${s.name} ${side} ${s.line} ${marketLabel(s.market).long}`,
      prob: side === 'over' ? s.forecastOver : 1 - s.forecastOver,
      price: side === 'over' ? s.over : s.under,
      book: s.book,
      link: { kind: 'prop', playerId: s.playerId, teamId: s.teamId, market: s.market, side },
      line: s.line
    };
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <label className="relative min-w-0 flex-1 basis-56">
          <span className="sr-only">Find a player or team</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3" aria-hidden />
          <input
            id="prop-search"
            type="search"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setShown(PAGE);
            }}
            placeholder="Player, team or game"
            className="w-full rounded-full bg-surface py-2 pl-9 pr-4 text-sm text-ink ring-1 ring-line placeholder:text-ink-3 focus:outline-none focus:ring-accent"
          />
        </label>
        <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-ink-2">
          <input id="prop-tagged" type="checkbox" checked={onlyTagged} onChange={(e) => setOnlyTagged(e.target.checked)} className="h-4 w-4 accent-[rgb(var(--accent))]" />
          Model disagrees ({tagged})
        </label>
        {games.length > 1 && (
          <label className="inline-flex items-center gap-2 text-sm text-ink-2">
            Game
            <select
              id="prop-game"
              value={gameId}
              onChange={(e) => {
                setGameId(e.target.value);
                setShown(PAGE);
              }}
              className="max-w-[11rem] rounded-lg bg-surface px-2 py-1.5 text-sm text-ink ring-1 ring-line"
            >
              <option value="all">All {games.length} games</option>
              {games.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.label}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="inline-flex items-center gap-2 text-sm text-ink-2">
          Sort
          <select id="prop-sort" value={sort} onChange={(e) => setSort(e.target.value as Sort)} className="rounded-lg bg-surface px-2 py-1.5 text-sm text-ink ring-1 ring-line">
            <option value="soonest">Soonest game</option>
            <option value="disagreement">Biggest disagreement</option>
            <option value="gap">Projection vs line</option>
            <option value="moved">Line moved most</option>
            <option value="hits">Hit rate, last 10</option>
          </select>
        </label>
      </div>
      <div className="scrollbar-none -mx-1 flex gap-1.5 overflow-x-auto px-1" role="group" aria-label="Stat">
        {(['all', ...markets] as const).map((m) => (
          <button key={m} type="button" onClick={() => setMarket(m)} aria-pressed={m === market} className={`chip shrink-0 ${m === market ? 'chip-active' : 'chip-idle'}`}>
            {m === 'all' ? 'All stats' : marketLabel(m).short}
          </button>
        ))}
      </div>

      <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <table className="w-full min-w-[580px] text-left text-sm tabular sm:min-w-[740px]">
          <thead>
            <tr className="border-b border-line text-xs text-ink-3">
              <th className="py-2 pr-3 font-medium">Player</th>
              <th className="py-2 pr-3 font-medium">Stat</th>
              <th className="py-2 pr-3 text-right font-medium">Proj</th>
              <th className="hidden py-2 pr-3 text-right font-medium sm:table-cell" title="His average over his last five games played">
                L5
              </th>
              <th className="py-2 pr-3 text-right font-medium">Line</th>
              <th className="py-2 pr-3 text-right font-medium" title="Games over this line in his last ten. On past lines, hit rates added nothing to the book's own chance">
                L10
              </th>
              <th className="py-2 pr-3 text-right font-medium" title="Chance of the over: the book's own number with its margin removed, plus the model's small weight">
                Over
              </th>
              <th className="hidden py-2 pr-3 text-right font-medium sm:table-cell" title="Our model's over chance on its own">
                Model
              </th>
              <th className="py-2 text-right font-medium">Parlay</th>
            </tr>
          </thead>
          <tbody>
            {filtered.slice(0, shown).map((s) => (
              <tr key={s.key} className="border-b border-line/60 transition last:border-0 hover:bg-raised/40">
                <td className="py-2 pr-3">
                  <span className="flex max-w-[14rem] items-center gap-2.5 sm:max-w-none">
                    <PlayerPhoto league={s.league} id={s.playerId} name={s.name} size={32} ring={s.teamColor} />
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate font-medium text-ink">
                        <Link href={`/${s.league}/player/${s.playerId}`} className="inline-flex min-h-6 items-center hover:underline">
                          {s.name}
                        </Link>
                        {s.available < 1 && <span className="ml-1.5 text-[10px] font-semibold text-warn">{pct(s.available)} to play</span>}
                      </span>
                      <span className="truncate text-xs text-ink-3">
                        {s.team} ·{' '}
                        <Link href={`/${s.league}/game/${s.gameId}#props`} className="inline-flex min-h-6 items-center hover:text-ink hover:underline">
                          {s.game}
                        </Link>{' '}
                        · <LocalTime iso={s.start} show="time" />
                      </span>
                    </span>
                  </span>
                </td>
                <td className="whitespace-nowrap py-2 pr-3 text-ink-2">{marketLabel(s.market).short}</td>
                <td className="py-2 pr-3 text-right">
                  <span className="block font-semibold text-ink">{s.projection.toFixed(1)}</span>
                  <ProjectionGap projection={s.projection} line={s.line} />
                </td>
                <td className="hidden py-2 pr-3 text-right text-ink-3 sm:table-cell">{s.recent?.toFixed(1) ?? '—'}</td>
                <td className="py-2 pr-3 text-right text-ink-2">
                  <LineValue line={s.line} openLine={s.openLine} />
                </td>
                <td className="py-2 pr-3 text-right">{s.hits ? <HitStrip rate={s.hits} /> : <span className="text-ink-3">—</span>}</td>
                <td className="whitespace-nowrap py-2 pr-3 text-right">
                  <span className="inline-flex flex-col items-end">
                    <span>
                      <span className={s.forecastOver >= 0.5 ? 'font-semibold text-accent-strong' : 'text-ink-2'}>
                        {pct(s.forecastOver)}
                        {s.over === null && '*'}
                      </span>
                      {s.edge && <EdgeTag edge={s.edge} record={record} />}
                    </span>
                    <ChanceBar chance={s.forecastOver} />
                  </span>
                </td>
                <td className="hidden py-2 pr-3 text-right text-ink-3 sm:table-cell">{pct(s.modelOver)}</td>
                <td className="py-2 text-right">
                  <span className="inline-flex gap-1.5">
                    {(['over', 'under'] as const).map((side) => {
                      const leg = legFor(s, side);
                      return (
                        <LegButton
                          key={side}
                          leg={leg}
                          side={side === 'over' ? 'Over' : 'Under'}
                          price={side === 'over' ? s.over : s.under}
                          active={chosen.has(leg.key)}
                          disabled={false}
                          onToggle={toggle}
                        />
                      );
                    })}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!filtered.length && <p className="text-sm text-ink-3">No lines match. Clear the search or pick another stat.</p>}
      {filtered.length > shown && (
        <button type="button" onClick={() => setShown((n) => n + PAGE)} className="w-full rounded-xl py-2 text-sm text-ink-2 ring-1 ring-line hover:text-ink hover:ring-line-strong">
          Show more ({(filtered.length - shown).toLocaleString()} left)
        </button>
      )}
      {spots.some((s) => s.over === null) && (
        <p className="text-xs text-ink-3">
          * Posted in ESPN&apos;s feed without prices, so the line is read as the book&apos;s 50/50 point and a parlay can&apos;t show its payout.
        </p>
      )}
    </div>
  );
}
