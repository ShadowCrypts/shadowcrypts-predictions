import { NextResponse } from 'next/server';
import { send } from '../../../lib/http';
import { getLeagueModel } from '../../../lib/model';
import { gradedCsv, leaguesFromQuery } from '../../../lib/model/api';

export const dynamic = 'force-dynamic';

/**
 * GET /api/graded?league=nba — every graded game as CSV (one league, or all of
 * them): the forecast the track record grades, the pick and whether it won, so
 * anyone can check the record for themselves.
 */
export async function GET(request: Request) {
  const leagues = leaguesFromQuery(request.url);
  if (!leagues) return NextResponse.json({ error: 'league must be one of nfl, nba, mlb, nhl' }, { status: 400 });
  const models = await Promise.all(leagues.map((id) => getLeagueModel(id)));
  const name = leagues.length === 1 ? leagues[0] : 'all';
  // The seasons the record grades: everything after each league's warm-up season.
  const graded = models.flatMap((m) => {
    const seasons = new Set(m.record.seasons.map((s) => s.seasonYear));
    return Object.values(m.predictions).filter((p) => seasons.has(p.game.seasonYear));
  });
  return send(request, gradedCsv(graded), {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="shadowcrypts-graded-${name}.csv"`,
      'cache-control': 'public, max-age=3600'
    }
  });
}
