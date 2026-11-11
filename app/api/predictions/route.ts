import { NextResponse } from 'next/server';
import { json } from '../../../lib/http';
import { getLeagueModel } from '../../../lib/model';
import { leaguesFromQuery, predictionJson } from '../../../lib/model/api';
import { freshen } from '../../../lib/model/fresh';

export const dynamic = 'force-dynamic';

/** GET /api/predictions?league=nba — upcoming predictions for one or every league. */
export async function GET(request: Request) {
  const leagues = leaguesFromQuery(request.url);
  if (!leagues) return NextResponse.json({ error: 'league must be one of nfl, nba, mlb, nhl' }, { status: 400 });
  const models = await Promise.all(leagues.map((id) => getLeagueModel(id)));
  // Games on now carry the latest score and clock (read again at most every 15 seconds).
  const slates = await Promise.all(models.map((model) => freshen(model.league, model.slate)));
  return json(request, {
    generatedAt: new Date().toISOString(),
    leagues: models.map((model, i) => ({
      league: model.league,
      season: model.season,
      predictions: slates[i].map(predictionJson)
    }))
  }, { headers: { 'cache-control': 'public, max-age=15' } });
}
