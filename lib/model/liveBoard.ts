import { LEAGUE_IDS } from '../leagues';
import { CardData, toCard } from './card';
import { freshen } from './fresh';
import { getLeagueModel } from './index';

/** Every league at a glance: games on now, starting soon and just finished, plus the next one when nothing's close. */
export type LiveBoard = {
  generatedAt: string;
  live: CardData[];
  soon: CardData[];
  final: CardData[];
  /** The next game anywhere, when nothing starts within the window. */
  next: CardData | null;
};

const SOON_MS = 6 * 3_600_000;
/** Finals count as "just finished" for this long after their start (a game plus a few hours). */
const RECENT_MS = 9 * 3_600_000;

export async function liveBoard(now = Date.now()): Promise<LiveBoard> {
  const models = (await Promise.allSettled(LEAGUE_IDS.map((id) => getLeagueModel(id)))).flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
  const live: CardData[] = [];
  const soon: CardData[] = [];
  const final: CardData[] = [];
  let next: CardData | null = null;
  for (const model of models) {
    // Games in the window get the latest scores and clocks (the model can be a couple of minutes behind).
    const all = Object.values(model.predictions);
    const inWindow = all.filter((p) => p.game.state === 'in' || Math.abs(Date.parse(p.game.date) - now) <= Math.max(SOON_MS, RECENT_MS));
    const latest = new Map((await freshen(model.league, inWindow, now)).map((p) => [p.game.id, p]));
    for (const p of all.map((x) => latest.get(x.game.id) ?? x)) {
      const { game } = p;
      const start = Date.parse(game.date);
      if (game.state === 'in') live.push(toCard(p));
      else if (game.state === 'pre' && start >= now - 3_600_000) {
        if (start <= now + SOON_MS) soon.push(toCard(p));
        else if (!next || start < Date.parse(next.date)) next = toCard(p);
      } else if (game.completed && start >= now - RECENT_MS && start <= now) final.push(toCard(p));
    }
  }
  const byStart = (a: CardData, b: CardData) => a.date.localeCompare(b.date);
  return {
    generatedAt: new Date(now).toISOString(),
    live: live.sort(byStart),
    soon: soon.sort(byStart),
    final: final.sort((a, b) => b.date.localeCompare(a.date)),
    next: soon.length || live.length ? null : next
  };
}
