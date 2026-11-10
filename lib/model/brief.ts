import { pct } from '../format';
import { LEAGUES } from '../leagues';
import { marketLabel, PropMarket } from '../props';
import { formatDay, formatTime } from '../time';
import type { LeagueModel, Prediction } from './index';
import type { PropCell } from './propBoard';
import type { GameStakes } from './season';

export type BriefItem = { kind: 'watch' | 'stakes' | 'favorite' | 'tossup' | 'injury' | 'line' | 'hot' | 'cold'; title: string; detail: string; href: string };

/** A prop line has to have moved at least this far (a whole point, goal or yard) to make the brief. */
const MIN_LINE_MOVE = 1;
/** Playoff odds both teams have riding on a game, added up, for it to make the brief as the biggest stakes. */
const MIN_STAKES = 0.06;

/** How many points of playoff chance a game swings, per team. */
const swing = (s: { ifWin: number; ifLoss: number }) => s.ifWin - s.ifLoss;

const label = (p: Prediction) => `${p.game.away.abbr} @ ${p.game.home.abbr}`;
/** Average rank percentile times closeness: two top-quarter teams at 60/40 just clear it. */
const WATCH_MIN_APPEAL = 0.6;
const when = (p: Prediction) => `${formatDay(p.game.date)}, ${formatTime(p.game.date)}`;

/**
 * A few plain-language headlines for the next day or so of games: the biggest
 * favorite, the closest call, the biggest injury story, the prop line that
 * has moved most and the teams moving most. Everything comes from numbers
 * already on the site.
 */
export function dailyBrief(models: LeagueModel[], now = new Date(), stakes: Partial<Record<string, Record<string, GameStakes>>> = {}): BriefItem[] {
  const upcoming = (hours: number) =>
    models.flatMap((m) => m.slate).filter((p) => p.game.state === 'pre' && Date.parse(p.game.date) > now.getTime() && Date.parse(p.game.date) - now.getTime() <= hours * 3_600_000);
  const soon = upcoming(36).length ? upcoming(36) : upcoming(96);
  const items: BriefItem[] = [];
  const href = (p: Prediction) => `/${p.game.league}/game/${p.game.id}`;

  if (soon.length) {
    // Game to watch: two good teams (by Elo rank within their league) in a close game.
    const standing = new Map<string, { rank: number; of: number }>();
    for (const m of models) for (const r of m.rankings) standing.set(`${m.league}:${r.team.id}`, { rank: r.rank, of: m.rankings.length });
    const quality = (league: string, teamId: string) => {
      const s = standing.get(`${league}:${teamId}`);
      return s && s.of > 1 ? 1 - (s.rank - 1) / (s.of - 1) : 0;
    };
    const appeal = (p: Prediction) =>
      ((quality(p.game.league, p.game.home.teamId) + quality(p.game.league, p.game.away.teamId)) / 2) * (1 - Math.abs(2 * p.homeProb - 1));
    const best = [...soon].sort((a, b) => appeal(b) - appeal(a))[0];
    const watch = appeal(best) >= WATCH_MIN_APPEAL ? best : null;
    const rankOf = (p: Prediction, side: 'home' | 'away') => standing.get(`${p.game.league}:${p.game[side].teamId}`)?.rank;
    if (watch) {
      items.push({
        kind: 'watch',
        title: `Game to watch: ${label(watch)}`,
        detail: `${LEAGUES[watch.game.league].name} #${rankOf(watch, 'away')} vs #${rankOf(watch, 'home')} by Elo · ${watch.game.away.abbr} ${pct(1 - watch.homeProb)}, ${watch.game.home.abbr} ${pct(watch.homeProb)} · ${when(watch)}`,
        href: href(watch)
      });
    }

    // Biggest stakes: the game whose result moves the two teams' playoff chances most, from the season simulation.
    const riding = (p: Prediction) => {
      const s = stakes[p.game.league]?.[p.game.id];
      return s ? { s, total: swing(s.home) + swing(s.away) } : null;
    };
    const heaviest = soon
      .map((p) => ({ p, r: riding(p) }))
      .filter((x): x is { p: Prediction; r: NonNullable<ReturnType<typeof riding>> } => !!x.r && x.r.total >= MIN_STAKES)
      .sort((a, b) => b.r.total - a.r.total)[0];
    if (heaviest) {
      const { p, r } = heaviest;
      const points = (x: number) => Math.round(x * 100);
      items.push({
        kind: 'stakes',
        title: `Biggest stakes: ${label(p)}`,
        detail: `Worth ${points(swing(r.s.home))} points of playoff chance to ${p.game.home.abbr}, ${points(swing(r.s.away))} to ${p.game.away.abbr} · ${when(p)}`,
        href: href(p)
      });
    }

    const favorite = [...soon].sort((a, b) => b.pickProb - a.pickProb)[0];
    const side = favorite.pick === 'home' ? favorite.game.home : favorite.game.away;
    items.push({
      kind: 'favorite',
      title: `Biggest favorite: ${side.shortName} ${pct(favorite.pickProb)}`,
      detail: `${LEAGUES[favorite.game.league].name} · ${label(favorite)} · ${when(favorite)}`,
      href: href(favorite)
    });

    const tossup = [...soon].sort((a, b) => Math.abs(a.homeProb - 0.5) - Math.abs(b.homeProb - 0.5))[0];
    if (tossup.game.id !== favorite.game.id && tossup.game.id !== watch?.game.id) {
      items.push({
        kind: 'tossup',
        title: `Closest call: ${tossup.game.away.abbr} ${pct(1 - tossup.homeProb)}, ${tossup.game.home.abbr} ${pct(tossup.homeProb)}`,
        detail: `${LEAGUES[tossup.game.league].name} · ${label(tossup)} · ${when(tossup)}`,
        href: href(tossup)
      });
    }

    const absences = soon.flatMap((p) =>
      (['home', 'away'] as const).flatMap((s) => (p.injuries?.[s] ?? []).map((i) => ({ p, team: s === 'home' ? p.game.home : p.game.away, injury: i })))
    );
    const biggest = absences.filter((a) => a.injury.elo <= -15).sort((a, b) => a.injury.elo - b.injury.elo)[0];
    if (biggest) {
      items.push({
        kind: 'injury',
        title: `Injury watch: ${biggest.injury.name} (${biggest.injury.status.toLowerCase()})`,
        detail: `${biggest.team.shortName} lose about ${Math.round(-biggest.injury.elo)} Elo for it · ${label(biggest.p)} · ${when(biggest.p)}`,
        href: href(biggest.p)
      });
    }

    // The prop line the book has moved most since it opened: the market's own read on news and money.
    const soonByKey = new Map(soon.map((p) => [`${p.game.league}:${p.game.id}`, p]));
    const lineMoves = models.flatMap((m) =>
      Object.entries(m.propBoards ?? {}).flatMap(([gameId, board]) => {
        const p = soonByKey.get(`${m.league}:${gameId}`);
        if (!p) return [];
        return board.rows.flatMap((row) =>
          (Object.entries(row.cells) as [PropMarket, PropCell | undefined][]).flatMap(([market, cell]) => {
            const line = cell?.line;
            const open = line?.openLine;
            return line && open !== null && open !== undefined && Math.abs(line.line - open) >= MIN_LINE_MOVE ? [{ p, row, market, line: line.line, open }] : [];
          })
        );
      })
    );
    const moved = lineMoves.sort((a, b) => Math.abs(b.line - b.open) / Math.max(1, b.open) - Math.abs(a.line - a.open) / Math.max(1, a.open))[0];
    if (moved) {
      items.push({
        kind: 'line',
        title: `Line on the move: ${moved.row.name} ${marketLabel(moved.market).long} ${moved.open} → ${moved.line}`,
        detail: `${LEAGUES[moved.p.game.league].name} · ${label(moved.p)} · ${when(moved.p)} · moved since the book opened it`,
        href: `/${moved.p.game.league}/player/${moved.row.id}`
      });
    }
  }

  // Form: the biggest Elo moves over each team's last 10 games, in leagues that are playing.
  const moves = models
    .filter((m) => m.season.phase === 'Regular season' || m.season.phase === 'Postseason')
    .flatMap((m) =>
      m.rankings
        .filter((r) => r.trend.length >= 11)
        .map((r) => ({ league: m.league, team: r.team, change: r.trend[r.trend.length - 1] - r.trend[r.trend.length - 11] }))
    );
  const hot = [...moves].sort((a, b) => b.change - a.change)[0];
  const cold = [...moves].sort((a, b) => a.change - b.change)[0];
  if (hot && hot.change >= 15) {
    items.push({
      kind: 'hot',
      title: `Hottest team: ${hot.team.shortName}`,
      detail: `${LEAGUES[hot.league].name} · up ${Math.round(hot.change)} Elo over their last 10 games`,
      href: `/${hot.league}/team/${hot.team.id}`
    });
  }
  if (cold && cold.change <= -15) {
    items.push({
      kind: 'cold',
      title: `Sliding: ${cold.team.shortName}`,
      detail: `${LEAGUES[cold.league].name} · down ${Math.round(-cold.change)} Elo over their last 10 games`,
      href: `/${cold.league}/team/${cold.team.id}`
    });
  }
  return items;
}
