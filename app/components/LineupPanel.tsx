import Link from 'next/link';
import type { GameSide } from '../../lib/espn';
import { signed } from '../../lib/format';
import type { TeamLineup } from '../../lib/model/lineups';
import { PlayerPhoto } from './PlayerPhoto';
import { TeamLogo } from './TeamLogo';

function availabilityTone(available: number) {
  if (available <= 0) return 'bg-bad/15 text-bad';
  if (available < 1) return 'bg-warn/15 text-warn';
  return '';
}

/** One team's side of "who's playing": projected rotation before the game, absences after it. */
export function LineupPanel({ league, side, team, color }: { league: string; side: GameSide; team: TeamLineup; color?: string }) {
  // Players expected on the floor first, then anyone listed as out.
  const rotation = (team.players ?? []).filter((p) => p.minutes >= 4 || p.available < 1).sort((a, b) => b.minutes - a.minutes || b.share - a.share);
  const costById = new Map(team.absences.map((a) => [a.id, a.cost]));
  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <TeamLogo src={side.logo} abbr={side.abbr} size={22} />
        <h3 className="font-semibold text-ink">{side.shortName}</h3>
        <span
          className={`ml-auto rounded-md px-1.5 py-0.5 text-xs font-semibold tabular ${
            team.elo <= -3 ? 'bg-bad/15 text-bad' : team.elo >= 3 ? 'bg-good/15 text-good' : 'bg-raised text-ink-2'
          }`}
          title="Tonight's lineup against the team's recent lineups, in Elo"
        >
          {signed(team.elo)} Elo
        </span>
      </div>
      {rotation.length ? (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-ink-3">
              <th className="pb-1.5 font-medium">Player</th>
              <th className="pb-1.5 text-right font-medium" title="Projected minutes tonight, after absent players' minutes are handed out">
                Min
              </th>
              <th className="pb-1.5 text-right font-medium" title="Game Score per 48 minutes, with plus-minus; about 15 is league average">
                Rating
              </th>
              <th className="pb-1.5 text-right font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="tabular">
            {rotation.slice(0, 12).map((p) => (
              <tr key={p.id} className={`border-t border-line ${p.available <= 0 ? 'text-ink-3' : ''}`}>
                <td className="py-1.5">
                  <span className="flex min-w-0 items-center gap-2">
                    <PlayerPhoto league={league} id={p.id} name={p.name} size={22} ring={p.available <= 0 ? undefined : color} />
                    <Link
                      href={`/${league}/player/${p.id}`}
                      className={`truncate hover:underline ${p.available <= 0 ? 'line-through decoration-ink-3/60' : 'text-ink'}`}
                    >
                      {p.name}
                    </Link>
                  </span>
                </td>
                <td className="py-1.5 text-right text-ink-2">{p.available <= 0 ? '—' : Math.round(p.minutes)}</td>
                <td className="py-1.5 text-right text-ink-2">{p.rating.toFixed(1)}</td>
                <td className="py-1.5 text-right">
                  {p.available < 1 ? (
                    <span className={`rounded-md px-1.5 py-0.5 text-xs font-medium ${availabilityTone(p.available)}`}>
                      {p.reason ?? 'Out'}
                      {costById.has(p.id) && <span className="ml-1 opacity-80">{signed(-costById.get(p.id)!)}</span>}
                    </span>
                  ) : (
                    <span className="text-xs text-ink-3">Available</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : team.absences.length ? (
        <ul className="divide-y divide-line text-sm">
          {team.absences.map((a) => (
            <li key={a.id} className="flex items-baseline justify-between gap-2 py-2">
              <span className="text-ink">
                {a.name} <span className="text-xs text-ink-3">{a.reason?.toLowerCase()}</span>
              </span>
              <span className="text-xs font-semibold text-bad tabular">{signed(-a.cost)} Elo</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-ink-3">Full strength: nobody who matters sat out.</p>
      )}
    </div>
  );
}
