import { NextResponse } from 'next/server';
import { send } from '../../../lib/http';
import { isLeagueId, LEAGUES } from '../../../lib/leagues';
import { getLeagueModel } from '../../../lib/model';
import { picksCsv, propPicksFor } from '../../../lib/model/dayProps';
import { propEngine } from '../../../lib/model/propEngines';

export const dynamic = 'force-dynamic';

/**
 * GET /api/graded-props?league=nba — every logged prop pick (the model's 10+
 * point disagreements, locked before each game) that's been graded, as CSV:
 * the forward test behind the props record, pick by pick.
 */
export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get('league') ?? '';
  if (!isLeagueId(id) || !propEngine(LEAGUES[id])) return NextResponse.json({ error: 'league must be one of nba, nhl, nfl' }, { status: 400 });
  const model = await getLeagueModel(id);
  const finished = Object.values(model.predictions)
    .map((p) => p.game)
    .filter((g) => g.completed);
  const record = await propPicksFor(LEAGUES[id], finished, Infinity);
  return send(request, picksCsv(id, record?.recent ?? []), {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="shadowcrypts-prop-picks-${id}.csv"`,
      'cache-control': 'public, max-age=3600'
    }
  });
}
