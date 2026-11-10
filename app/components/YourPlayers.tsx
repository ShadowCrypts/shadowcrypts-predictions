'use client';

import Link from 'next/link';
import { useEffect, useId, useState } from 'react';
import { pct } from '../../lib/format';
import type { FollowedPlayer } from '../../lib/model/followedPlayers';
import { AlertSettings } from './AlertSettings';
import { ChanceBar } from './ChanceBar';
import { useFavorites, useFollowedPlayers } from './favorites';
import { LocalTime } from './LocalTime';
import { LineValue } from './LineValue';
import { PlayerPhoto } from './PlayerPhoto';
import { TeamLogo } from './TeamLogo';

/** Lines move and post through the day; read them again this often while the page is open (more often while a game is on). */
const REFRESH_MS = 5 * 60_000;
const LIVE_REFRESH_MS = 60_000;

function PlayerCard({ p }: { p: FollowedPlayer }) {
  // His page, which tracks his lines live while his game is on.
  const href = `/${p.league}/player/${p.id}`;
  return (
    <Link href={href} className="card relative flex min-w-0 flex-col gap-3 overflow-hidden p-4 transition hover:ring-line-strong">
      {/* His team's color glowing in from the corner behind the photo. */}
      <span className="pointer-events-none absolute inset-0" style={{ background: `radial-gradient(80% 70% at 0% 0%, ${p.teamColor}2e, transparent 65%)` }} aria-hidden />
      <span className="relative flex items-center gap-3">
        <span className="relative shrink-0">
          <PlayerPhoto league={p.league} id={p.id} name={p.name} size={44} ring={p.teamColor} />
          {p.teamLogo && (
            <span className="absolute -bottom-1 -right-1 rounded-full bg-surface">
              <TeamLogo src={p.teamLogo} abbr={p.team} size={18} />
            </span>
          )}
        </span>
        <span className="min-w-0">
          <span className="flex items-center gap-1.5">
            <span className="truncate font-semibold text-ink">{p.name}</span>
            {p.injury && (
              <span
                className={`shrink-0 rounded px-1 py-0.5 text-[10px] font-semibold ${p.injury.toLowerCase() === 'out' ? 'bg-bad/15 text-bad' : 'bg-warn/15 text-warn'}`}
                title="On the current injury report"
              >
                {p.injury}
              </span>
            )}
          </span>
          <span className="block truncate text-xs text-ink-3">
            {p.live ? (
              <span className="inline-flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-live" aria-hidden />
                <span className="font-semibold text-live">Live</span> {p.live.label} · {p.live.status}
              </span>
            ) : p.next ? (
              <>
                {p.next.label} · {p.next.state === 'in' ? <span className="font-semibold text-live">Live</span> : <LocalTime iso={p.next.date} />}
              </>
            ) : (
              `${p.team ? `${p.team} · ` : ''}No game on the board yet`
            )}
          </span>
        </span>
      </span>
      {p.live && <p className="relative text-xs font-medium text-accent-strong">His stats so far and live chances on each line →</p>}
      {p.live ? null : p.lines.length > 0 ? (
        <table className="relative w-full text-sm tabular">
          <tbody>
            {p.lines.map((l) => (
              <tr key={l.market} className="border-t border-line/60">
                <td className="py-1.5 text-ink-2">{l.label}</td>
                <td className="py-1.5 text-right text-ink">
                  <LineValue line={l.line} openLine={l.openLine} />
                </td>
                <td className="py-1.5 pl-3 text-right">
                  <span className="inline-flex flex-col items-end">
                    <span className={l.over >= 0.5 ? 'font-semibold text-accent-strong' : 'text-ink-2'}>{pct(l.over)} over</span>
                    <ChanceBar chance={l.over} />
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="relative text-xs text-ink-3">
          {p.injury?.toLowerCase() === 'out'
            ? 'Out, per the injury report: books don’t post lines for a player ruled out.'
            : p.next
              ? 'No lines posted yet. Books usually post them the day before.'
              : 'His projections and lines show here once his next game is on the board.'}
        </p>
      )}
    </Link>
  );
}

/**
 * Followed players' next games and main lines, under Your teams. Nothing shows
 * until you follow a player. `onlyLive` (live mode) shows just the ones whose
 * game is on, and nothing at all when none is.
 */
export function YourPlayers({ onlyLive = false, title = 'Your players' }: { onlyLive?: boolean; title?: string }) {
  const { players } = useFollowedPlayers();
  const { favorites } = useFavorites();
  const ids = [...players].sort().join(',');
  const [data, setData] = useState<{ ids: string; players: FollowedPlayer[] } | null>(null);
  const headingId = useId();
  const anyLive = data?.players.some((p) => p.live) ?? false;

  useEffect(() => {
    if (!ids) return;
    let live = true;
    const load = () =>
      fetch(`/api/players/next?ids=${encodeURIComponent(ids)}`)
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
        .then((body: { players: FollowedPlayer[] }) => live && setData({ ids, players: body.players }))
        .catch(() => undefined);
    load();
    const timer = window.setInterval(() => document.visibilityState === 'visible' && load(), anyLive ? LIVE_REFRESH_MS : REFRESH_MS);
    return () => {
      live = false;
      window.clearInterval(timer);
    };
  }, [ids, anyLive]);

  if (!ids) return null;
  // Until the first answer for this set arrives, keep the last one rather than flashing empty.
  const shown = data?.players.filter((p) => players.has(`${p.league}:${p.id}`) && (!onlyLive || p.live)) ?? null;
  if (onlyLive && !shown?.length) return null;
  return (
    <section aria-labelledby={headingId}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 id={headingId} className="font-display text-lg font-semibold tracking-tight text-ink sm:text-xl">
          {title}
        </h2>
        {/* The alerts switch sits with Your teams; following only players, it's here instead. */}
        {!onlyLive && !favorites.size && <AlertSettings compact />}
      </div>
      {shown === null ? (
        <p className="text-sm text-ink-3">Loading your players…</p>
      ) : shown.length ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {shown.map((p) => (
            <PlayerCard key={`${p.league}:${p.id}`} p={p} />
          ))}
        </div>
      ) : (
        <p className="rounded-xl border border-dashed border-line-strong px-4 py-5 text-center text-sm text-ink-3">None of your players are on the board right now.</p>
      )}
    </section>
  );
}
