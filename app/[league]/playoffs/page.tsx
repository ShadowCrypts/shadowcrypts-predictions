import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ChevronLeft } from 'lucide-react';
import { Suspense } from 'react';
import { isLeagueId, LEAGUE_IDS, LEAGUES } from '../../../lib/leagues';
import { getLeagueModel } from '../../../lib/model';
import { getMachineInput, peekSeasonProjection } from '../../../lib/model/projections';
import { displayColor } from '../../../lib/teamColor';
import { MachineTeam, PlayoffMachine } from '../../components/PlayoffMachine';
import { EmptyState, PageHeader } from '../../components/Section';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ league: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { league: id } = await params;
  if (!isLeagueId(id)) return {};
  const league = LEAGUES[id];
  return {
    title: `${league.name} playoff machine`,
    description: `Pick the winners of any ${league.name} games and watch every team's playoff and title chances change, from the same simulation behind our season projections.`,
    alternates: { canonical: `/${id}/playoffs` }
  };
}

export default async function PlayoffsPage({ params }: Params) {
  const { league: id } = await params;
  if (!isLeagueId(id)) notFound();
  const league = LEAGUES[id];
  const [model, machine, projection] = await Promise.all([getLeagueModel(id), getMachineInput(id).catch(() => null), peekSeasonProjection(id)]);
  const teams: MachineTeam[] = model.rankings.map((r) => ({ id: r.team.id, abbr: r.team.abbr, shortName: r.team.shortName, logo: r.team.logo, color: displayColor(r.team.color, r.team.altColor) }));

  return (
    <div className="space-y-6">
      <Link href={`/${league.id}#projections`} className="inline-flex items-center gap-1 text-sm text-ink-2 hover:text-ink">
        <ChevronLeft className="h-4 w-4" aria-hidden /> {league.name} projections
      </Link>
      <PageHeader eyebrow={`${league.name}${machine ? ` · ${machine.season}` : ''}`} title={`${league.name} playoff machine`}>
        <p>Decide any game yourself and see what it does to the whole race: every team&apos;s playoff and title chances, recalculated on your device in about a second.</p>
        <nav className="mt-4 flex flex-wrap gap-2" aria-label="League">
          {LEAGUE_IDS.map((other) => (
            <Link key={other} href={`/${other}/playoffs`} aria-current={other === league.id ? 'page' : undefined} className={`chip ${other === league.id ? 'chip-active' : 'chip-idle'}`}>
              {LEAGUES[other].name}
            </Link>
          ))}
        </nav>
      </PageHeader>
      {machine && machine.games.length ? (
        <Suspense>
          <PlayoffMachine league={league.id} leagueName={league.name} machine={machine} teams={teams} initial={projection.status === 'ready' ? projection.teams : null} />
        </Suspense>
      ) : (
        <EmptyState>
          {league.name} regular-season games are all played for now, so there&apos;s nothing to pick. The machine comes back when the next schedule does.{' '}
          <Link href={`/${league.id}#projections`} className="text-ink underline">
            See where things stand
          </Link>
          .
        </EmptyState>
      )}
    </div>
  );
}
