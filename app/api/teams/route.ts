import { getTeams } from '../../../lib/espn';
import { json } from '../../../lib/http';
import { LEAGUE_IDS, LEAGUES } from '../../../lib/leagues';

// Answered per request (compressed to suit the browser); the team list itself is cached for a day.
export const dynamic = 'force-dynamic';

/** GET /api/teams — every team in every league, for search. */
export async function GET(request: Request) {
  const results = await Promise.allSettled(LEAGUE_IDS.map((id) => getTeams(LEAGUES[id])));
  const teams = results.flatMap((result, i) =>
    result.status === 'fulfilled'
      ? result.value.map((t) => ({ league: LEAGUE_IDS[i], id: t.id, abbr: t.abbr, name: t.name, shortName: t.shortName, logo: t.logo }))
      : []
  );
  return json(request, { teams }, { headers: { 'cache-control': 'public, max-age=3600' } });
}
