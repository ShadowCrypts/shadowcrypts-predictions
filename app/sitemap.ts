import type { MetadataRoute } from 'next';
import { getTeams } from '../lib/espn';
import { LEAGUE_IDS, LEAGUES } from '../lib/leagues';
import { getLeagueModel } from '../lib/model';
import { getAllModels } from '../lib/model/all';
import { playerDirectory } from '../lib/model/playerIndex';
import { propEngine } from '../lib/model/propEngines';
import { getUfcModel } from '../lib/ufc/model';

// Built per request from the models the server already holds (not at build time, which would mean downloading every season).
export const dynamic = 'force-dynamic';

const base = () => (process.env.SITE_URL ?? 'http://localhost:3000').replace(/\/$/, '');

/**
 * Every page worth indexing: home, leagues, teams, players who've played
 * lately, the games still to play, the track record and plans. Finished games
 * drop off as new ones come on.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const url = base();
  const now = new Date();
  const pages: MetadataRoute.Sitemap = [
    { url: `${url}/`, lastModified: now, changeFrequency: 'hourly', priority: 1 },
    { url: `${url}/record`, lastModified: now, changeFrequency: 'daily', priority: 0.7 },
    { url: `${url}/matchup`, changeFrequency: 'daily', priority: 0.6 },
    { url: `${url}/data`, changeFrequency: 'monthly', priority: 0.4 },
    { url: `${url}/props`, changeFrequency: 'hourly', priority: 0.8 },
    ...LEAGUE_IDS.filter((id) => propEngine(LEAGUES[id])).map((id) => ({ url: `${url}/props?league=${id}`, changeFrequency: 'hourly' as const, priority: 0.8 })),
    { url: `${url}/parlay`, changeFrequency: 'monthly', priority: 0.4 },
    { url: `${url}/nba/players`, changeFrequency: 'daily', priority: 0.6 },
    { url: `${url}/nfl/players`, changeFrequency: 'weekly', priority: 0.6 },
    { url: `${url}/nhl/players`, changeFrequency: 'daily', priority: 0.5 },
    ...(['nba', 'nfl', 'nhl'] as const).map((id) => ({ url: `${url}/${id}/compare`, changeFrequency: 'weekly' as const, priority: 0.4 })),
    { url: `${url}/nfl/fantasy`, changeFrequency: 'daily', priority: 0.8 },
    ...(['nfl', 'nba', 'nhl', 'mlb'] as const).map((id) => ({ url: `${url}/${id}/playoffs`, changeFrequency: 'daily' as const, priority: 0.7 })),
    ...(['nfl', 'nba', 'nhl', 'mlb'] as const).map((id) => ({ url: `${url}/${id}/injuries`, changeFrequency: 'daily' as const, priority: 0.7 })),
    ...(['nfl', 'nba', 'nhl', 'mlb'] as const).map((id) => ({ url: `${url}/${id}/standings`, changeFrequency: 'daily' as const, priority: 0.8 })),
    { url: `${url}/privacy`, changeFrequency: 'monthly', priority: 0.3 },
    ...LEAGUE_IDS.map((id) => ({ url: `${url}/${id}`, lastModified: now, changeFrequency: 'hourly' as const, priority: 0.9 }))
  ];
  const teams = await Promise.all(LEAGUE_IDS.map((id) => getTeams(LEAGUES[id]).catch(() => [])));
  teams.forEach((list, i) => {
    for (const team of list) pages.push({ url: `${url}/${LEAGUE_IDS[i]}/team/${team.id}`, changeFrequency: 'daily', priority: 0.6 });
  });
  // Players who've played in the last two months; a league whose model isn't ready just waits for the next crawl.
  const players = await Promise.all(
    LEAGUE_IDS.filter((id) => propEngine(LEAGUES[id])).map((id) =>
      getLeagueModel(id)
        .then((model) => playerDirectory(LEAGUES[id], model))
        .catch(() => [])
    )
  );
  for (const p of players.flat()) if (p.usage > 0) pages.push({ url: `${url}/${p.league}/player/${p.id}`, changeFrequency: 'daily', priority: 0.5 });
  // Games on the board that haven't finished: their previews are what people search for before a game.
  const { models } = await getAllModels();
  for (const m of models) {
    for (const p of m.slate) {
      if (!p.game.completed && p.game.state !== 'post') pages.push({ url: `${url}/${m.league}/game/${p.game.id}`, changeFrequency: 'hourly', priority: 0.7 });
    }
  }
  // UFC: the section, cards still to come and the last few, their fights, and fighters who are active.
  const ufc = await getUfcModel().catch(() => null);
  if (ufc) {
    pages.push({ url: `${url}/ufc`, lastModified: now, changeFrequency: 'hourly', priority: 0.9 });
    for (const e of [...ufc.upcoming, ...ufc.recent.slice(0, 3)]) {
      const coming = ufc.upcoming.includes(e);
      pages.push({ url: `${url}/ufc/event/${e.id}`, changeFrequency: coming ? 'hourly' : 'weekly', priority: coming ? 0.8 : 0.5 });
      for (const b of e.bouts) pages.push({ url: `${url}/ufc/fight/${b.id}`, changeFrequency: coming ? 'hourly' : 'weekly', priority: coming ? 0.7 : 0.4 });
    }
    for (const [id, f] of ufc.fighters) if (f.active) pages.push({ url: `${url}/ufc/fighter/${id}`, changeFrequency: 'weekly', priority: 0.5 });
  }
  return pages;
}
