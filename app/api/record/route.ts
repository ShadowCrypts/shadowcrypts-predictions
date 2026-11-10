import { NextResponse } from 'next/server';
import { json } from '../../../lib/http';
import { getLeagueModel } from '../../../lib/model';
import { leaguesFromQuery } from '../../../lib/model/api';

export const dynamic = 'force-dynamic';

/** GET /api/record?league=mlb — backtest metrics, calibration and the logged live record. */
export async function GET(request: Request) {
  const leagues = leaguesFromQuery(request.url);
  if (!leagues) return NextResponse.json({ error: 'league must be one of nfl, nba, mlb, nhl' }, { status: 400 });
  const models = await Promise.all(leagues.map((id) => getLeagueModel(id)));
  return json(request, {
    generatedAt: new Date().toISOString(),
    leagues: models.map((m) => ({ league: m.league, season: m.season, record: m.record }))
  });
}
