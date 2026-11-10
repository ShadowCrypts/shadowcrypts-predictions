import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ChevronLeft } from 'lucide-react';
import { isLeagueId, LEAGUES } from '../../../lib/leagues';
import { getLeagueModel } from '../../../lib/model';
import { peekSeasonProjection } from '../../../lib/model/projections';
import { getStandings } from '../../../lib/standingsFeed';
import { displayColor } from '../../../lib/teamColor';
import { EmptyState, PageHeader } from '../../components/Section';
import { StandingsView } from '../../components/StandingsView';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ league: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { league: id } = await params;
  if (!isLeagueId(id)) return {};
  const league = LEAGUES[id];
  return {
    title: `${league.name} standings and playoff chances`,
    description: `${league.fullName} standings by division and conference: records, home and road, streaks, and each team's chance of making the playoffs.`,
    alternates: { canonical: `/${id}/standings` }
  };
}

export default async function StandingsPage({ params }: Params) {
  const { league: id } = await params;
  if (!isLeagueId(id)) notFound();
  const league = LEAGUES[id];
  const [model, projection, standings] = await Promise.all([getLeagueModel(id), peekSeasonProjection(id), getStandings(league).catch(() => null)]);
  const colors = Object.fromEntries(Object.values(model.teams).map((t) => [t.id, displayColor(t.color, t.altColor)]));
  const odds = projection.status === 'ready' ? Object.fromEntries(projection.teams.map((t) => [t.id, t.playoffs])) : null;
  const hasTeams = !!standings?.conferences.some((c) => c.rows.length);

  return (
    <div className="space-y-6">
      <Link href={`/${id}`} className="inline-flex items-center gap-1 text-sm text-ink-2 hover:text-ink">
        <ChevronLeft className="h-4 w-4" aria-hidden /> {league.name}
      </Link>
      <PageHeader eyebrow={`${league.name}${standings?.season ? ` · ${standings.season}` : ''}`} title={`${league.name} standings`}>
        <p>
          {odds ? (
            <>
              Records from ESPN, with each team&apos;s chance of making the playoffs from our season simulation.{' '}
              <Link href={`/${id}/playoffs`} className="underline underline-offset-2 hover:text-ink">
                Change the results yourself in the playoff machine
              </Link>
              .
            </>
          ) : (
            'Records from ESPN.'
          )}
        </p>
      </PageHeader>
      {standings && hasTeams ? (
        <StandingsView league={id} standings={standings} colors={colors} odds={odds} opensBy={id === 'nba' ? 'conference' : 'division'} />
      ) : (
        <EmptyState>ESPN&apos;s standings didn&apos;t load just now. Try again in a minute.</EmptyState>
      )}
      <p className="max-w-3xl text-xs text-ink-3">
        ESPN&apos;s standings can trail a final score by a few hours, so a record here can be a game behind the one on a team&apos;s page. Teams level on {id === 'nhl' ? 'points' : 'percentage'} go by ESPN&apos;s official seed, which applies the league&apos;s tiebreakers. For insight and fun, not betting advice.
      </p>
    </div>
  );
}
