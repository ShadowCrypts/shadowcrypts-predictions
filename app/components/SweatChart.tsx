'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { pctCapped } from '../../lib/format';
import { legId } from '../../lib/legs';
import type { SweatGame } from '../../lib/model/sweat';
import { SweatPoint, sweatTrail } from '../../lib/parlay';
import { useViewerZone } from './LocalTime';
import type { TrackedParlay } from './parlayLog';
import { useWidth } from './useWidth';

const H = 200;
const M = { top: 14, right: 14, bottom: 26, left: 40 };
/** How often to read the games again while one is on. */
const REFRESH_MS = 60_000;

type Point = SweatPoint & { chance: number };

/** Last point at or before time t. */
function at(points: Point[], t: number) {
  let found = points[0];
  for (const p of points) if (p.t <= t) found = p;
  return found;
}

/**
 * A tracked parlay's chance to cash through its games, replayed from the
 * play-by-play: every leg's chance from where its game stood at each moment,
 * combined as the chance to cash now is. Reads the games again every minute
 * while one is on.
 */
export function SweatChart({ parlay }: { parlay: TrackedParlay }) {
  const ids = parlay.legs
    .map((l) => legId(l))
    .filter((id): id is string => id !== null)
    .join(',');
  const [games, setGames] = useState<Record<string, SweatGame> | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!ids) return;
    let timer: number | undefined;
    let stopped = false;
    const load = () =>
      fetch(`/api/sweat?ids=${encodeURIComponent(ids)}`)
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${r.status}`))))
        .then((data: { games: Record<string, SweatGame> }) => {
          if (stopped) return;
          setGames(data.games);
          setFailed(false);
          if (Object.values(data.games).some((g) => !g.final)) timer = window.setTimeout(load, REFRESH_MS);
        })
        .catch(() => {
          if (!stopped) setFailed(true);
        });
    load();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [ids]);

  const points = useMemo(() => {
    if (!games) return [];
    const finals = Object.fromEntries(parlay.legs.map((l) => [l.key, parlay.results[l.key]?.state]));
    return sweatTrail(parlay.legs, finals, games).filter((p): p is Point => p.chance !== null);
  }, [games, parlay]);

  if (!ids) return <p className="text-sm text-ink-3">This parlay was saved before legs carried what a replay needs.</p>;
  if (failed && !games) return <p className="text-sm text-ink-3">Couldn&apos;t load the play-by-play just now; try again in a minute.</p>;
  if (!games) return <div className="h-[200px] animate-pulse rounded-lg bg-raised" aria-label="Replaying the games" />;
  if (points.length < 2) return <p className="text-sm text-ink-3">Nothing to replay yet: none of its games has started.</p>;
  return <SweatPlot parlay={parlay} points={points} />;
}

/** The chart itself, mounted once there's a trail to draw so it measures its real width. */
function SweatPlot({ parlay, points }: { parlay: TrackedParlay; points: Point[] }) {
  const box = useRef<HTMLDivElement>(null);
  const W = useWidth(box, 600);
  const [hover, setHover] = useState<number | null>(null);
  const zone = useViewerZone();
  const span = points[points.length - 1].t - points[0].t;
  const { tickFormat, tipFormat } = useMemo(
    () => ({
      tickFormat: new Intl.DateTimeFormat('en-US', { timeZone: zone, ...(span > 20 * 3_600_000 ? { weekday: 'short' } : {}), hour: 'numeric', minute: '2-digit' }),
      tipFormat: new Intl.DateTimeFormat('en-US', { timeZone: zone, weekday: 'short', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' })
    }),
    [zone, span]
  );

  const tMin = points[0].t;
  const tMax = points[points.length - 1].t;
  const top = Math.max(...points.map((p) => p.chance));
  const hi = Math.min(1, Math.max(0.2, Math.ceil((top + 0.05) * 10) / 10));
  const sx = (t: number) => M.left + ((t - tMin) / (tMax - tMin || 1)) * (W - M.left - M.right);
  const sy = (v: number) => M.top + (1 - v / hi) * (H - M.top - M.bottom);
  let line = '';
  for (const [i, p] of points.entries()) line += i === 0 ? `M${sx(p.t).toFixed(1)},${sy(p.chance).toFixed(1)}` : `H${sx(p.t).toFixed(1)}V${sy(p.chance).toFixed(1)}`;
  const area = `${line}V${sy(0).toFixed(1)}H${sx(tMin).toFixed(1)}Z`;

  // When each leg was settled for good: the first moment it reads 1 or 0.
  const settled = parlay.legs.flatMap((l, k) => {
    const p = points.find((x) => x.legs[k] === 1 || x.legs[k] === 0);
    return p ? [{ t: p.t, k, hit: p.legs[k] === 1, chance: p.chance }] : [];
  });
  const start = points[0];
  const end = points[points.length - 1];
  const peak = points.reduce((a, b) => (b.chance > a.chance ? b : a), start);
  const busted = points.find((p) => p.chance === 0);
  const ending = end.chance === 1 ? 'cashed' : busted ? `busted at ${tickFormat.format(new Date(busted.t))}` : `now ${pctCapped(end.chance)}`;
  const summary = `Started at ${pctCapped(start.chance)} · peaked at ${pctCapped(peak.chance)} at ${tickFormat.format(new Date(peak.t))} · ${ending}`;
  const ticks = [0, hi / 2, hi];
  const tip = hover === null ? null : at(points, hover);
  const hx = hover === null ? 0 : sx(Math.max(tMin, Math.min(tMax, hover)));
  // The tooltip stays inside the chart, beside the cursor on whichever side has room.
  const tipW = Math.min(240, W - 8);

  return (
    <figure className="space-y-2">
      <figcaption className="text-xs font-medium text-ink-2 tabular">{summary}</figcaption>
      <div ref={box} className="relative">
        <svg
          width={W}
          height={H}
          viewBox={`0 0 ${W} ${H}`}
          className="block max-w-full touch-pan-y"
          role="img"
          aria-label={`Chance to cash through the games: ${summary}`}
          onPointerMove={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const x = ((e.clientX - rect.left) / rect.width) * W;
            setHover(tMin + ((x - M.left) / (W - M.left - M.right)) * (tMax - tMin));
          }}
          onPointerLeave={() => setHover(null)}
        >
          {ticks.map((v) => (
            <g key={v}>
              <line x1={M.left} x2={W - M.right} y1={sy(v)} y2={sy(v)} stroke="var(--grid)" strokeWidth={1} />
              <text x={M.left - 8} y={sy(v)} dy="0.32em" textAnchor="end" fontSize={11} fill="var(--text-muted)">
                {Math.round(v * 100)}%
              </text>
            </g>
          ))}
          {[tMin, (tMin + tMax) / 2, tMax].map((t, i) => (
            <text key={i} x={sx(t)} y={H - 8} textAnchor={i === 0 ? 'start' : i === 2 ? 'end' : 'middle'} fontSize={11} fill="var(--text-muted)">
              {tickFormat.format(new Date(t))}
            </text>
          ))}
          <path d={area} fill="var(--series-1)" fillOpacity={0.12} />
          <path d={line} fill="none" stroke="var(--series-1)" strokeWidth={2} strokeLinejoin="round" />
          {settled.map((s) => (
            <circle key={s.k} cx={sx(s.t)} cy={sy(s.chance)} r={4} fill={s.hit ? 'rgb(var(--good))' : 'rgb(var(--bad))'} stroke="var(--surface-1)" strokeWidth={1.5}>
              <title>{`${parlay.legs[s.k].label}: ${s.hit ? 'hit' : 'missed'}`}</title>
            </circle>
          ))}
          {tip && (
            <g>
              <line x1={hx} x2={hx} y1={M.top} y2={H - M.bottom} stroke="var(--axis)" />
              <circle cx={hx} cy={sy(tip.chance)} r={4} fill="var(--series-1)" stroke="var(--surface-1)" strokeWidth={2} />
            </g>
          )}
        </svg>
        {tip && (
          <div
            className="pointer-events-none absolute top-0 z-10 rounded-lg border border-line bg-raised px-3 py-2 text-xs shadow-xl"
            style={{ width: tipW, left: hx < W / 2 ? Math.min(hx + 8, W - tipW) : Math.max(0, hx - 8 - tipW) }}
          >
            <p className="text-ink-3">{tipFormat.format(new Date(tip.t))}</p>
            <p className="mt-0.5 font-semibold text-ink tabular">Chance to cash {pctCapped(tip.chance)}</p>
            <ul className="mt-1 space-y-0.5">
              {parlay.legs.map((l, k) => (
                <li key={l.key} className="flex justify-between gap-2 text-ink-2">
                  <span className="truncate">{l.label}</span>
                  <span className="shrink-0 tabular">{tip.legs[k] === null ? '—' : tip.legs[k] === 1 ? 'hit' : tip.legs[k] === 0 ? 'missed' : pctCapped(tip.legs[k]!)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
      <p className="text-xs text-ink-3">
        Each leg&apos;s live chance at every play, from the play-by-play, which matches the box score for nearly every player.
      </p>
    </figure>
  );
}
