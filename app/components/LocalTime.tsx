'use client';

import { useSyncExternalStore } from 'react';
import { formatDay, formatLongDay, formatTime, TIME_ZONE } from '../../lib/time';

type Show = 'day-time' | 'day' | 'time' | 'long-day';

const noop = () => () => {};
const viewerZone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || TIME_ZONE;
  } catch {
    return TIME_ZONE;
  }
};

const formats = new Map<string, Record<Show, Intl.DateTimeFormat>>();
function formatsFor(zone: string) {
  let f = formats.get(zone);
  if (!f) {
    f = {
      time: new Intl.DateTimeFormat('en-US', { timeZone: zone, hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }),
      'day-time': new Intl.DateTimeFormat('en-US', { timeZone: zone, weekday: 'short', month: 'short', day: 'numeric' }),
      day: new Intl.DateTimeFormat('en-US', { timeZone: zone, weekday: 'short', month: 'short', day: 'numeric' }),
      'long-day': new Intl.DateTimeFormat('en-US', { timeZone: zone, weekday: 'long', month: 'long', day: 'numeric' })
    };
    formats.set(zone, f);
  }
  return f;
}

function inZone(iso: string, show: Show, zone: string) {
  const d = new Date(iso);
  const f = formatsFor(zone);
  if (show === 'time') return f.time.format(d);
  if (show === 'long-day') return f['long-day'].format(d);
  if (show === 'day') return f.day.format(d);
  return `${f['day-time'].format(d)} · ${f.time.format(d)}`;
}

function eastern(iso: string, show: Show) {
  if (show === 'time') return formatTime(iso);
  if (show === 'long-day') return formatLongDay(iso);
  if (show === 'day') return formatDay(iso);
  return `${formatDay(iso)} · ${formatTime(iso)}`;
}

/** The viewer's time zone: Eastern on the server and during hydration, then the browser's own. */
export const useViewerZone = () => useSyncExternalStore(noop, viewerZone, () => TIME_ZONE);

/**
 * A game time in the viewer's own time zone. The server doesn't know where the
 * viewer is, so the first paint is Eastern and the browser swaps in local time.
 */
export function LocalTime({ iso, show = 'day-time', className }: { iso: string; show?: Show; className?: string }) {
  const zone = useViewerZone();
  const local = zone === TIME_ZONE ? eastern(iso, show) : inZone(iso, show, zone);
  return (
    <time dateTime={iso} className={className} title={zone === TIME_ZONE ? undefined : eastern(iso, show)}>
      {local}
    </time>
  );
}
