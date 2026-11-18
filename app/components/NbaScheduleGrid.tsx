import type { NbaScheduleTeam } from '../../lib/model/nbaFantasyBoard';
import { shiftDateKey } from '../../lib/time';
import { TeamLogo } from './TeamLogo';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** Who plays when this fantasy week: more games means more chances to score, the usual way to pick streamers. */
export function NbaScheduleGrid({ start, teams }: { start: string; teams: NbaScheduleTeam[] }) {
  const most = Math.max(...teams.map((t) => t.total));
  return (
    <div className="card overflow-x-auto p-0">
      <table className="w-full min-w-[640px] text-sm tabular">
        <caption className="sr-only">Each team&apos;s games this fantasy week</caption>
        <thead>
          <tr className="border-b border-line text-left text-xs text-ink-3">
            <th scope="col" className="py-3 pl-3 pr-2 font-medium sm:pl-4">
              Team
            </th>
            {DAYS.map((d, i) => (
              <th key={d} scope="col" className="py-3 px-1 text-center font-medium">
                {d}
                <span className="block font-normal">{Number(shiftDateKey(start, i).slice(8))}</span>
              </th>
            ))}
            <th scope="col" className="py-3 pl-2 text-right font-medium" title="Games this week">
              Week
            </th>
            <th scope="col" className="py-3 pl-2 text-right font-medium" title="Games still to play this week">
              Left
            </th>
            <th scope="col" className="py-3 pl-2 pr-3 text-right font-medium sm:pr-4" title="Games next week">
              Next wk
            </th>
          </tr>
        </thead>
        <tbody>
          {teams.map((t) => (
            <tr key={t.id} className="border-t border-line">
              <th scope="row" className="py-1.5 pl-3 pr-2 text-left font-medium text-ink sm:pl-4">
                <span className="flex items-center gap-2">
                  <TeamLogo src={t.logo} abbr={t.abbr} size={18} />
                  {t.abbr}
                </span>
              </th>
              {t.days.map((d, i) => (
                <td key={i} className="px-1 py-1.5 text-center text-xs">
                  {d ? <span className={`inline-block whitespace-nowrap rounded-md px-1.5 py-0.5 ${d.done ? 'text-ink-3' : 'bg-accent/15 font-medium text-ink'}`}>{d.label}</span> : <span className="text-ink-3/50">·</span>}
                </td>
              ))}
              <td className={`py-1.5 pl-2 text-right font-semibold ${t.total === most && most > 0 ? 'text-good' : 'text-ink'}`}>{t.total}</td>
              <td className="py-1.5 pl-2 text-right text-ink-2">{t.left}</td>
              <td className="py-1.5 pl-2 pr-3 text-right text-ink-2 sm:pr-4">{t.nextWeek}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
