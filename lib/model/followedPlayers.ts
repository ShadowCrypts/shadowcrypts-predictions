import { shortStatus } from '../format';
import { isLeagueId, LeagueId, LEAGUES } from '../leagues';
import { marketLabel, PropMarket } from '../props';
import { displayColor } from '../teamColor';
import { getLeagueModel } from './index';
import { playerDirectory } from './playerIndex';
import { liveGameOf, nextGameRow } from './playerLog';
import { propEngine } from './propEngines';

/** Most players one request may ask about. */
export const MAX_FOLLOWED = 40;
/** Lines shown per player: his league's main markets first. */
const LINES_EACH = 3;

export type FollowedPlayer = {
  league: LeagueId;
  id: string;
  name: string;
  team: string;
  teamId: string;
  teamLogo: string | null;
  /** His team's color, for drawing. */
  teamColor: string;
  /** His next game on the board, if one is. */
  next: { gameId: string; label: string; date: string; state: 'pre' | 'in' | 'post' } | null;
  /** His team's game in progress right now, if there is one ("Q3 5:12"). */
  live: { gameId: string; label: string; status: string } | null;
  /** His status on the current injury report ("Out", "Questionable"), if he's on it. */
  injury: string | null;
  /** `over` is the site's chance of the over; `prices` the book's (null when it posted the line without them). */
  lines: { market: PropMarket; label: string; line: number; over: number; openLine: number | null; prices: { over: number | null; under: number | null; book: string } }[];
};

/** Keys like "nba:3112335", checked and capped; anything malformed is dropped. */
export function parseFollowed(raw: string | null) {
  const seen = new Set<string>();
  const out: { league: LeagueId; id: string }[] = [];
  for (const part of (raw ?? '').split(',')) {
    const [league, id, extra] = part.trim().split(':');
    if (extra !== undefined || !league || !id || !isLeagueId(league) || !propEngine(LEAGUES[league]) || !/^\d{1,15}$/.test(id)) continue;
    if (seen.has(`${league}:${id}`)) continue;
    seen.add(`${league}:${id}`);
    out.push({ league, id });
    if (out.length >= MAX_FOLLOWED) break;
  }
  return out;
}

/**
 * Followed players as the home page shows them: who and where, and his next
 * game's main lines (`all` for every market, as the parlay builder's quick add
 * wants) with the site's chance of each over. Players the model doesn't know
 * (or leagues it can't load) are left out.
 */
export async function followedPlayers(keys: { league: LeagueId; id: string }[], all = false): Promise<FollowedPlayer[]> {
  const leagues = [...new Set(keys.map((k) => k.league))];
  const loaded = new Map(
    await Promise.all(
      leagues.map(async (id) => {
        try {
          const model = await getLeagueModel(id);
          const directory = new Map((await playerDirectory(LEAGUES[id], model)).map((p) => [p.id, p]));
          return [id, { model, directory }] as const;
        } catch {
          return [id, null] as const;
        }
      })
    )
  );
  const out: FollowedPlayer[] = [];
  for (const { league, id } of keys) {
    const data = loaded.get(league);
    const engine = propEngine(LEAGUES[league]);
    if (!data || !engine) continue;
    const known = data.directory.get(id);
    const next = nextGameRow(data.model, id);
    const name = next?.row.name ?? known?.name;
    if (!name) continue;
    const team = data.model.teams[next?.row.teamId ?? ''] ?? Object.values(data.model.teams).find((t) => t.abbr === known?.team);
    const lines = next
      ? engine.markets
          .map((market) => ({ market, line: next.row.cells[market]?.line }))
          .filter((x): x is { market: PropMarket; line: NonNullable<typeof x.line> } => !!x.line)
          .slice(0, all ? undefined : LINES_EACH)
          .map(({ market, line }) => ({
            market,
            label: marketLabel(market).short,
            line: line.line,
            over: line.forecastOver,
            openLine: line.openLine ?? null,
            prices: { over: line.over, under: line.under, book: line.book }
          }))
      : [];
    const live = team ? await liveGameOf(league, data.model, team.id).catch(() => null) : null;
    out.push({
      league,
      id,
      name,
      team: team?.abbr ?? known?.team ?? '',
      teamId: team?.id ?? '',
      teamLogo: team?.logo ?? null,
      teamColor: displayColor(team?.color, team?.altColor),
      live: live ? { gameId: live.id, label: `${live.away.abbr} ${live.away.score ?? 0} @ ${live.home.abbr} ${live.home.score ?? 0}`, status: shortStatus(live.statusDetail) } : null,
      injury: (team ? (data.model.injuries[team.id] ?? []).find((i) => i.athleteId === id)?.status : undefined) ?? null,
      next: next ? { gameId: next.game.id, label: `${next.game.away.abbr} @ ${next.game.home.abbr}`, date: next.game.date, state: next.game.state } : null,
      lines
    });
  }
  return out;
}
