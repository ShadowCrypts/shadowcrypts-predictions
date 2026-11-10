import { NextResponse } from 'next/server';
import { json } from '../../../lib/http';
import { getLeagueModel } from '../../../lib/model';
import { leaguesFromQuery } from '../../../lib/model/api';

export const dynamic = 'force-dynamic';

/** GET /api/rankings?league=nba — current Elo power rankings. */
export async function GET(request: Request) {
  const leagues = leaguesFromQuery(request.url);
  if (!leagues) return NextResponse.json({ error: 'league must be one of nfl, nba, mlb, nhl' }, { status: 400 });
  const models = await Promise.all(leagues.map((id) => getLeagueModel(id)));
  return json(request, {
    generatedAt: new Date().toISOString(),
    leagues: models.map((m) => ({
      league: m.league,
      season: m.season,
      rankings: m.rankings.map((r) => ({
        rank: r.rank,
        team: { id: r.team.id, abbr: r.team.abbr, name: r.team.name },
        rating: Math.round(r.rating * 10) / 10,
        marketRating: Math.round(r.marketRating * 10) / 10,
        marketRank: r.marketRank,
        record: r.record,
        seasonChange: Math.round(r.seasonChange * 10) / 10
      }))
    }))
  });
}
