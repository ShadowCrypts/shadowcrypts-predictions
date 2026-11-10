import { pctCapped } from '../../lib/format';
import type { TurningPoint } from '../../lib/model/turningPoints';
import { TeamBadge } from './TeamColors';

type Side = { teamId: string; abbr: string; logo: string | null; color: string };

/** The plays that swung the win chance most, each with the scoring team's chance just before and just after it. */
export function TurningPoints({ points, away, home }: { points: TurningPoint[]; away: Side; home: Side }) {
  return (
    <ol className="divide-y divide-line/60">
      {points.map((p) => {
        const team = p.homeScored ? home : away;
        const before = p.homeScored ? p.before : 1 - p.before;
        const after = p.homeScored ? p.after : 1 - p.after;
        return (
          <li key={`${p.period}-${p.clock}-${p.text}`} className="flex items-start gap-3 py-2.5 sm:items-center">
            <span className="w-11 shrink-0 text-xs text-ink-3 tabular sm:w-14">
              {p.period}
              {p.clock && <span className="block">{p.clock}</span>}
            </span>
            <TeamBadge side={team} size={20} />
            <span className="min-w-0 flex-1">
              <span className="block text-sm text-ink">{p.text}</span>
              <span className="block text-xs text-ink-3 tabular">
                {away.abbr} {p.awayScore} – {p.homeScore} {home.abbr}
                {/* On a phone the swing sits under the play instead of beside it. */}
                <span className="sm:hidden">
                  {' · '}
                  <span className="font-semibold text-ink">
                    {team.abbr} {pctCapped(before)} → {pctCapped(after)}
                  </span>{' '}
                  <span className="font-semibold text-good">+{Math.round((after - before) * 100)}</span>
                </span>
              </span>
            </span>
            <span className="hidden shrink-0 text-right sm:block">
              <span className="block text-sm font-semibold text-ink tabular">
                {team.abbr} {pctCapped(before)} → {pctCapped(after)}
              </span>
              <span className="block text-xs font-semibold text-good tabular">+{Math.round((after - before) * 100)} pts</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
