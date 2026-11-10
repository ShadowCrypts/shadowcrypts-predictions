/** Picks for the playoff machine: which side wins each game someone decided, kept in the page's address so a scenario can be shared. */
export type Picks = Record<string, 'home' | 'away'>;

type PickableGame = { id: string; homeId: string; awayId: string };

/** "401873037h.401873039a", with the game ids in order so the same picks always make the same address. */
export function encodePicks(picks: Picks) {
  return Object.keys(picks)
    .sort()
    .map((id) => `${id}${picks[id] === 'home' ? 'h' : 'a'}`)
    .join('.');
}

/** Picks back out of an address, keeping only games still to play: an old link's finished games just drop off. */
export function decodePicks(text: string | null | undefined, games: PickableGame[]): Picks {
  const known = new Set(games.map((g) => g.id));
  const picks: Picks = {};
  for (const part of (text ?? '').split('.')) {
    const m = part.match(/^(\d{1,15})([ha])$/);
    if (m && known.has(m[1])) picks[m[1]] = m[2] === 'h' ? 'home' : 'away';
  }
  return picks;
}

/** One game's pick pressed: the same side again clears it, the other side switches it. */
export function togglePick(picks: Picks, gameId: string, side: 'home' | 'away'): Picks {
  const { [gameId]: current, ...rest } = picks;
  return current === side ? rest : { ...rest, [gameId]: side };
}

/** Every game a team has left decided one way: "if they win out". */
export function runTheTable(picks: Picks, games: PickableGame[], teamId: string, win: boolean): Picks {
  const next = { ...picks };
  for (const g of games) {
    if (g.homeId === teamId) next[g.id] = win ? 'home' : 'away';
    else if (g.awayId === teamId) next[g.id] = win ? 'away' : 'home';
  }
  return next;
}

/** The picks that don't involve a team, for undoing its row of them. */
export function withoutTeam(picks: Picks, games: PickableGame[], teamId: string): Picks {
  const next = { ...picks };
  for (const g of games) if (g.homeId === teamId || g.awayId === teamId) delete next[g.id];
  return next;
}

/** The home team's chance from a forecast's Elo gap. */
export const homeChance = (diff: number) => 1 / (1 + 10 ** (-diff / 400));

/** The teams a scenario moved most, biggest first: smaller changes than this could be chance between runs. */
export const MIN_MOVE = 0.01;
export function biggestMoves<T extends { id: string; playoffs: number }>(before: T[], after: T[], limit = 3) {
  const was = new Map(before.map((t) => [t.id, t.playoffs]));
  return after
    .map((t) => ({ id: t.id, from: was.get(t.id) ?? t.playoffs, to: t.playoffs }))
    .filter((t) => Math.abs(t.to - t.from) >= MIN_MOVE)
    .sort((a, b) => Math.abs(b.to - b.from) - Math.abs(a.to - a.from))
    .slice(0, limit);
}
