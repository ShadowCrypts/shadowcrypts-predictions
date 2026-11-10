import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ChevronLeft } from 'lucide-react';
import { signed } from '../../../lib/format';
import { isLeagueId, LEAGUES } from '../../../lib/leagues';
import { getLeagueModel } from '../../../lib/model';
import { biggestAbsences, eloToPoints, teamInjuryReport } from '../../../lib/model/injuryReport';
import { propEngine } from '../../../lib/model/propEngines';
import { displayColor } from '../../../lib/teamColor';
import { InjuryBoard } from '../../components/InjuryBoard';
import { statusTone } from '../../components/InjuryList';
import { LocalTime } from '../../components/LocalTime';
import { EmptyState, PageHeader, Section } from '../../components/Section';
import { TeamLogo } from '../../components/TeamLogo';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ league: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { league: id } = await params;
  if (!isLeagueId(id)) return {};
  const league = LEAGUES[id];
  return {
    title: `${league.name} injury report`,
    description: `Every ${league.name} player on the injury report, by team, with what each absence takes off the team's forecast for its next game.`,
    alternates: { canonical: `/${id}/injuries` }
  };
}

export default async function InjuriesPage({ params }: Params) {
  const { league: id } = await params;
  if (!isLeagueId(id)) notFound();
  const league = LEAGUES[id];
  const model = await getLeagueModel(id);
  const teams = model.rankings
    .map((r) => {
      const next = (model.teamGames[r.team.id] ?? []).map((g) => model.predictions[g]).find((p) => p && !p.game.completed && p.game.state === 'pre');
      return teamInjuryReport({ ...r.team, color: displayColor(r.team.color, r.team.altColor) }, model.injuries[r.team.id] ?? [], next ?? null);
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  const listed = teams.filter((t) => t.rows.length);
  const biggest = biggestAbsences(listed);
  const count = listed.reduce((sum, t) => sum + t.rows.length, 0);
  const playerPages = !!propEngine(league);

  return (
    <div className="space-y-6">
      <Link href={`/${id}`} className="inline-flex items-center gap-1 text-sm text-ink-2 hover:text-ink">
        <ChevronLeft className="h-4 w-4" aria-hidden /> {league.name}
      </Link>
      <PageHeader eyebrow={`${league.name} · ${count} player${count === 1 ? '' : 's'} listed`} title={`${league.name} injury report`}>
        <p>ESPN&apos;s report, team by team, with what each absence takes off our rating of the team for its next game.</p>
      </PageHeader>
      {biggest.length > 0 && (
        <Section title="Costing the most" subtitle="The absences that take the most off a team's rating for its next game. 100 Elo is about a 64% favorite.">
          <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
            <table className="w-full min-w-[520px] text-sm">
              <caption className="sr-only">The costliest absences in the league</caption>
              <thead>
                <tr className="text-left text-xs text-ink-3">
                  <th scope="col" className="pb-2 font-medium">
                    Player
                  </th>
                  <th scope="col" className="pb-2 font-medium">
                    Status
                  </th>
                  <th scope="col" className="pb-2 font-medium">
                    Next game
                  </th>
                  <th scope="col" className="pb-2 text-right font-medium">
                    Elo
                  </th>
                  <th scope="col" className="pb-2 pl-3 text-right font-medium" title="What that does to an even game">
                    Win chance
                  </th>
                </tr>
              </thead>
              <tbody className="tabular">
                {biggest.map(({ team, row }) => (
                  <tr key={row.id} className="border-t border-line">
                    <td className="py-2">
                      <span className="flex items-center gap-2">
                        <TeamLogo src={team.logo} abbr={team.abbr} size={20} />
                        {playerPages ? (
                          <Link href={`/${id}/player/${row.id}`} className="font-medium text-ink hover:underline">
                            {row.name}
                          </Link>
                        ) : (
                          <span className="font-medium text-ink">{row.name}</span>
                        )}
                        <span className="text-xs text-ink-3">{row.position}</span>
                      </span>
                    </td>
                    <td className="py-2">
                      <span className={`rounded-md px-1.5 py-0.5 text-xs font-medium ${statusTone(row.status)}`}>{row.status}</span>
                    </td>
                    <td className="py-2 text-xs text-ink-2">
                      {team.next && (
                        <Link href={`/${id}/game/${team.next.gameId}`} className="hover:underline">
                          {team.next.home ? 'vs' : '@'} {team.next.opponent} · <LocalTime iso={team.next.date} show="day" />
                        </Link>
                      )}
                    </td>
                    <td className="py-2 text-right font-semibold text-ink">{signed(row.elo ?? 0)}</td>
                    <td className="py-2 pl-3 text-right text-ink-2">−{Math.abs(eloToPoints(row.elo ?? 0)).toFixed(1)} pts</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}
      {listed.length ? <InjuryBoard league={id} teams={listed} playerPages={playerPages} /> : <EmptyState>No one on ESPN&apos;s {league.name} injury report right now.</EmptyState>}
      <p className="max-w-3xl text-xs text-ink-3">
        A cost counts the chance he sits, from his status, and {league.lineups ? "how much he's been playing lately, so a player already missing for a while costs little: the team's recent lineups have gone on without him" : 'what he has meant to the team'}. ESPN doesn&apos;t keep past reports, so
        the chance each status means sitting is our estimate, not a measured rate. Once a line is up the forecast follows it, and the line has its own read on who plays; these costs move the rating number behind it. For insight and fun, not betting advice.
      </p>
    </div>
  );
}
