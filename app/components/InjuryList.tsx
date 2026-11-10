import type { InjuryEntry } from '../../lib/espn';
import { signed } from '../../lib/format';
import type { InjuryImpact } from '../../lib/model/adjustments';
import { TeamLogo } from './TeamLogo';

export const statusTone = (status: string) => {
  const s = status.toLowerCase();
  if (s === 'out' || s.includes('injured reserve') || /\bil\b/.test(s)) return 'bg-bad/15 text-bad';
  if (s.includes('doubtful') || s.includes('questionable')) return 'bg-warn/15 text-warn';
  return 'bg-raised text-ink-2';
};

export function InjuryList({
  team,
  report,
  impacts,
  limit = 12
}: {
  team?: { logo: string | null; abbr: string; shortName: string };
  report: InjuryEntry[];
  impacts: InjuryImpact[] | null;
  limit?: number;
}) {
  const impactById = new Map((impacts ?? []).map((i) => [i.athleteId, i]));
  const rows = [...report].sort((a, b) => (impactById.get(a.athleteId)?.elo ?? 0) - (impactById.get(b.athleteId)?.elo ?? 0));
  return (
    <div>
      {team && (
        <div className="mb-2 flex items-center gap-2">
          <TeamLogo src={team.logo} abbr={team.abbr} size={22} />
          <h3 className="font-semibold text-ink">{team.shortName}</h3>
          <span className="text-xs text-ink-3">{report.length ? `${report.length} listed` : ''}</span>
        </div>
      )}
      {rows.length ? (
        <ul className="divide-y divide-line">
          {rows.slice(0, limit).map((injury) => {
            const impact = impactById.get(injury.athleteId);
            const counts = impact && impact.elo <= -0.5;
            return (
              <li key={injury.athleteId} className="py-2.5">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="text-sm text-ink">
                    {injury.name} <span className="text-xs text-ink-3">{injury.position}</span>
                  </p>
                  <span className="flex shrink-0 items-center gap-2 text-xs">
                    {counts && <span className="font-semibold text-ink tabular">{signed(impact.elo)} Elo</span>}
                    <span className={`rounded-md px-1.5 py-0.5 font-medium ${statusTone(injury.status)}`}>{injury.status}</span>
                  </span>
                </div>
                {counts && <p className="text-xs text-ink-2">{impact.reason}</p>}
                {injury.comment && <p className="mt-0.5 line-clamp-2 text-xs text-ink-3">{injury.comment}</p>}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-sm text-ink-3">Nothing on the injury report.</p>
      )}
    </div>
  );
}
