'use client';

import { ArrowDown, ArrowUp } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { signed } from '../../lib/format';
import { Split, splitShare, splitText } from '../../lib/model/tape';
import { Metric, metricText } from '../../lib/model/teamMetrics';
import { TeamLogo } from './TeamLogo';

export type TeamStatRow = {
  id: string;
  abbr: string;
  shortName: string;
  logo: string | null;
  color: string;
  games: number;
  scored: number;
  allowed: number;
  home: Split | null;
  road: Split | null;
  recent: Split | null;
  schedule: number | null;
  metrics?: Record<string, number>;
};

/** A column: its heading, its sort value, how it reads, and which way "best" points when it's first sorted. */
type Column = { key: string; label: string; hint: string; value: (r: TeamStatRow) => number | null; show: (r: TeamStatRow) => string; lowFirst?: boolean };

const RESULTS: Column[] = [
  // First, because it's the sort the table opens on: on a phone it sits right beside the team.
  { key: 'margin', label: 'Margin', hint: 'Scored minus allowed, a game', value: (r) => r.scored - r.allowed, show: (r) => signed(r.scored - r.allowed, 1) },
  { key: 'scored', label: 'Scored', hint: 'Average a game', value: (r) => r.scored, show: (r) => r.scored.toFixed(1) },
  { key: 'allowed', label: 'Allowed', hint: 'Average a game', value: (r) => r.allowed, show: (r) => r.allowed.toFixed(1), lowFirst: true },
  { key: 'home', label: 'Home', hint: 'Record at home', value: (r) => (r.home ? splitShare(r.home) : null), show: (r) => (r.home ? splitText(r.home) : '—') },
  { key: 'road', label: 'Road', hint: 'Record on the road', value: (r) => (r.road ? splitShare(r.road) : null), show: (r) => (r.road ? splitText(r.road) : '—') },
  { key: 'recent', label: 'Last 10', hint: 'Record in their last ten games', value: (r) => (r.recent ? splitShare(r.recent) : null), show: (r) => (r.recent ? splitText(r.recent) : '—') },
  { key: 'schedule', label: 'Opp. Elo', hint: 'Average Elo of the teams they have played', value: (r) => r.schedule, show: (r) => (r.schedule === null ? '—' : String(Math.round(r.schedule))) }
];

const metricColumn = (m: Metric): Column => ({
  key: `metric-${m.key}`,
  label: m.label,
  hint: m.hint,
  value: (r) => r.metrics?.[m.key] ?? null,
  show: (r) => metricText(m, r.metrics?.[m.key]),
  lowFirst: m.lowFirst
});

/** Every team's season numbers; any column sorts it, and a second press turns it over. A second view holds what the box scores add. */
export function TeamStatsTable({ league, rows, metrics, metricsName }: { league: string; rows: TeamStatRow[]; metrics?: Metric[]; metricsName?: string }) {
  const hasRecent = rows.some((r) => r.recent);
  const views = [
    { id: 'results', name: 'Results', columns: RESULTS.filter((c) => c.key !== 'recent' || hasRecent) },
    ...(metrics?.length && rows.some((r) => r.metrics) ? [{ id: 'metrics', name: metricsName ?? 'More', columns: metrics.map(metricColumn) }] : [])
  ];
  const [view, setView] = useState('results');
  const columns = (views.find((v) => v.id === view) ?? views[0]).columns;
  const [sort, setSort] = useState<{ key: string; low: boolean }>({ key: 'margin', low: false });
  const column = columns.find((c) => c.key === sort.key) ?? columns[0];
  const sorted = [...rows].sort((a, b) => {
    const x = column.value(a);
    const y = column.value(b);
    // Teams without the number go last, whichever way it's sorted.
    if (x === null || y === null) return x === y ? a.shortName.localeCompare(b.shortName) : x === null ? 1 : -1;
    return (sort.low ? x - y : y - x) || a.shortName.localeCompare(b.shortName);
  });
  return (
    <div>
      {views.length > 1 && (
        <div className="mb-3 flex gap-2" role="group" aria-label="Which numbers">
          {views.map((v) => (
            <button
              key={v.id}
              type="button"
              aria-pressed={view === v.id}
              onClick={() => {
                setView(v.id);
                setSort({ key: v.columns[0].key, low: !!v.columns[0].lowFirst });
              }}
              className={`chip ${view === v.id ? 'chip-active' : 'chip-idle'}`}
            >
              {v.name}
            </button>
          ))}
        </div>
      )}
      <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <table className="w-full min-w-[540px] text-sm sm:min-w-[640px]">
          <thead>
            <tr className="text-left text-xs text-ink-3">
              <th scope="col" className="w-6 pb-2 font-medium sm:w-8">
                #
              </th>
              <th scope="col" className="sticky left-0 z-10 bg-surface pb-2 font-medium">
                Team
              </th>
              {columns.map((c) => {
                const active = c.key === column.key;
                return (
                  <th key={c.key} scope="col" className="pb-2 pl-3 text-right font-medium" aria-sort={active ? (sort.low ? 'ascending' : 'descending') : 'none'}>
                    <button
                      type="button"
                      title={c.hint}
                      onClick={() => setSort(active ? { key: c.key, low: !sort.low } : { key: c.key, low: !!c.lowFirst })}
                      className={`inline-flex items-center gap-0.5 whitespace-nowrap rounded hover:text-ink ${active ? 'font-semibold text-ink' : ''}`}
                    >
                      {c.label}
                      {active && (sort.low ? <ArrowUp className="h-3 w-3" aria-hidden /> : <ArrowDown className="h-3 w-3" aria-hidden />)}
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="tabular">
            {sorted.map((r, i) => (
              <tr key={r.id} className="border-t border-line transition hover:bg-raised/60">
                <td className="py-2 text-ink-3">{i + 1}</td>
                {/* Pinned, and short on a phone: the numbers scroll under it, with room for the first few beside it. */}
                <td className="sticky left-0 z-10 bg-surface py-2 pr-2">
                  <Link href={`/${league}/team/${r.id}`} className="flex items-center gap-2 hover:underline">
                    <span className="h-6 w-1 shrink-0 rounded-full" style={{ background: r.color }} aria-hidden />
                    <TeamLogo src={r.logo} abbr={r.abbr} size={22} />
                    <span className="font-medium text-ink sm:hidden">{r.abbr}</span>
                    <span className="hidden font-medium text-ink sm:inline">{r.shortName}</span>
                  </Link>
                </td>
                {columns.map((c) => (
                  <td key={c.key} className={`py-2 pl-3 text-right ${c.key === column.key ? 'font-semibold text-ink' : 'text-ink-2'}`}>
                    {c.show(r)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
