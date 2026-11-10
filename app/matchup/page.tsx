import type { Metadata } from 'next';
import { Suspense } from 'react';
import { LEAGUES, seasonLabel } from '../../lib/leagues';
import { getAllModels } from '../../lib/model/all';
import type { MatchupLeague } from '../../lib/model/matchup';
import { leagueSheet, scoreWord, tapeSeason } from '../../lib/model/tape';
import { seasonTeamMetrics } from '../../lib/model/teamMetricsLoad';
import { MatchupMachine } from '../components/MatchupMachine';
import { PageHeader } from '../components/Section';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Matchup machine',
  description: 'Pick any two teams and see who would win, at home, away or on neutral ground, from the same ratings behind every forecast.',
  // Every pairing is the same page to a search engine.
  alternates: { canonical: '/matchup' }
};

// Home-court patterns for a best-of-7 from the higher seed's side: 2-2-1-1-1 (NBA, NHL), 2-3-2 (World Series).
const SERIES: Record<string, number[] | null> = { nba: [1, 1, 0, 0, 1, 0, 1], nhl: [1, 1, 0, 0, 1, 0, 1], mlb: [1, 1, 0, 0, 0, 1, 1], nfl: null };

export default async function MatchupPage() {
  const { models } = await getAllModels();
  const now = new Date().toISOString();
  const leagues: MatchupLeague[] = await Promise.all(models.map(async (m) => {
    const league = LEAGUES[m.league];
    const games = Object.values(m.predictions).map((p) => p.game);
    const teamIds = m.rankings.map((r) => r.team.id);
    const seasonYear = tapeSeason(games, teamIds, m.season.year, now) ?? m.season.year;
    // Team scoring ratings only where they're used (not the NHL).
    const adjusted = league.scoring.k > 0 ? m.scoring.teams : undefined;
    const metrics = await seasonTeamMetrics(league, games, seasonYear, now);
    return {
      tape: {
        sheet: leagueSheet({ teamIds, games, history: m.history, seasonYear, before: now, adjusted, metrics, league: league.id }),
        when: `The ${seasonLabel(league, seasonYear)} season`,
        unit: scoreWord(league.scoreUnit)
      },
      id: m.league,
      name: league.name,
      hfa: league.elo.hfa,
      ratingsShare: league.preLine.ratingsShare,
      eloPerPoint: league.elo.eloPerPoint,
      series: SERIES[m.league],
      scoring: { average: m.scoring.average, marginPerLogit: league.scoring.marginPerLogit },
      teams: m.rankings
        .filter((r) => r.team)
        .map((r) => ({
          id: r.team.id,
          abbr: r.team.abbr,
          name: r.team.name,
          shortName: r.team.shortName,
          logo: r.team.logo,
          color: r.team.color,
          altColor: r.team.altColor ?? null,
          elo: r.rating,
          market: r.marketRating,
          offense: r.offense,
          defense: r.defense,
          venue: m.scoring.teams[r.team.id]?.venue ?? 0
        }))
        .sort((a, b) => a.name.localeCompare(b.name))
    };
  }));

  return (
    <div className="space-y-8">
      <PageHeader eyebrow="Matchup machine" title="Any two teams, head to head">
        <p>
          Pick a league, two teams and a venue. The number comes from the same ratings behind every forecast before a betting line is
          posted, with each team at full strength.
        </p>
      </PageHeader>
      <Suspense>
        <MatchupMachine leagues={leagues} />
      </Suspense>
    </div>
  );
}
