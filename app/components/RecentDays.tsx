import Link from 'next/link';
import { formatShortDate } from '../../lib/time';

type Day = { date: string; hits: number; graded: number };

/** How many winners the forecast called, as a square's color: from the bad tone through neutral to the good one. */
function tone(share: number) {
  if (share >= 0.7) return 'bg-good ring-good/40';
  if (share >= 0.6) return 'bg-good/60 ring-good/30';
  if (share >= 0.5) return 'bg-good/30 ring-good/20';
  if (share >= 0.4) return 'bg-bad/30 ring-bad/20';
  return 'bg-bad/60 ring-bad/30';
}

/**
 * The last few weeks of game days as a strip of squares, each colored by how
 * many winners the forecast called that day and linking to it; the day shown
 * is outlined.
 */
export function RecentDays({ days, current }: { days: Day[]; current: string }) {
  const hits = days.reduce((s, d) => s + d.hits, 0);
  const graded = days.reduce((s, d) => s + d.graded, 0);
  return (
    <div className="card p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-medium text-ink">Last {days.length} game days</p>
        <p className="text-xs text-ink-3 tabular">
          {hits}–{graded - hits} · {graded ? Math.round((hits / graded) * 100) : 0}% of winners called
        </p>
      </div>
      <ol className="mt-3 flex flex-wrap gap-1.5" aria-label="Results by day">
        {days.map((d) => {
          const share = d.graded ? d.hits / d.graded : 0;
          const label = `${formatShortDate(`${d.date}T16:00:00Z`)}: ${d.hits}–${d.graded - d.hits}`;
          return (
            <li key={d.date}>
              <Link
                href={`/results?date=${d.date}`}
                title={label}
                aria-label={label}
                aria-current={d.date === current ? 'date' : undefined}
                className={`block h-6 w-6 rounded-md ring-1 transition hover:scale-110 ${tone(share)} ${d.date === current ? 'outline outline-2 outline-offset-2 outline-accent' : ''}`}
              />
            </li>
          );
        })}
      </ol>
      <p className="mt-2 text-[11px] text-ink-3">Greener is more winners called. Each square opens that day.</p>
    </div>
  );
}
