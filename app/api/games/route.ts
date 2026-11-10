import { json } from '../../../lib/http';
import { getAllModels } from '../../../lib/model/all';
import type { GameHit } from '../../../lib/search';

export const dynamic = 'force-dynamic';

/** GET /api/games — every game on the board not yet final (on now or coming up), for search: league, id, start, state and both teams. */
export async function GET(request: Request) {
  const { models } = await getAllModels();
  const games: GameHit[] = models
    .flatMap((m) => m.slate)
    .filter((p) => !p.game.completed && p.game.state !== 'post')
    .sort((a, b) => a.game.date.localeCompare(b.game.date))
    .map(({ game }) => ({
      league: game.league,
      id: game.id,
      date: game.date,
      state: game.state,
      away: { abbr: game.away.abbr, name: game.away.name, shortName: game.away.shortName },
      home: { abbr: game.home.abbr, name: game.home.name, shortName: game.home.shortName }
    }));
  return json(request, { games }, { headers: { 'cache-control': 'public, max-age=300' } });
}
