import type { LeagueId } from '../leagues';
import { etDateKey } from '../time';
import { CardData, toCard } from './card';
import type { LeagueModel, Prediction } from './index';
import { gameFlow } from './live';

export type DayTally = { hits: number; misses: number; locked: number; graded: number };
export type DayResults = { date: string; cards: CardData[]; total: DayTally; byLeague: Partial<Record<LeagueId, DayTally>> };

// Built once per model build (models are replaced, not mutated), so page views don't rescan every game.
const indexes = new WeakMap<LeagueModel, Map<string, Prediction[]>>();

function byDate(model: LeagueModel) {
  let index = indexes.get(model);
  if (!index) {
    index = new Map();
    for (const p of Object.values(model.predictions)) {
      const key = etDateKey(p.game.date);
      index.set(key, [...(index.get(key) ?? []), p]);
    }
    indexes.set(model, index);
  }
  return index;
}

function tally(cards: CardData[]): DayTally {
  const graded = cards.filter((c) => c.completed && c.correct !== null);
  return {
    hits: graded.filter((c) => c.correct).length,
    misses: graded.filter((c) => !c.correct).length,
    locked: graded.filter((c) => c.locked).length,
    graded: graded.length
  };
}

/** Every game on one Eastern date across the given leagues, with how the forecasts did. */
export function dayResults(models: LeagueModel[], date: string): DayResults {
  const cards: CardData[] = [];
  const byLeague: DayResults['byLeague'] = {};
  for (const m of models) {
    const leagueCards = (byDate(m).get(date) ?? []).map(toCard);
    if (leagueCards.length) byLeague[m.league] = tally(leagueCards);
    cards.push(...leagueCards);
  }
  cards.sort((a, b) => a.date.localeCompare(b.date));
  return { date, cards, total: tally(cards), byLeague };
}

/** A winner given more than this isn't much of an upset. */
const UPSET_MAX_CHANCE = 0.4;

/**
 * The day's stories: the biggest upset (the miss where the winner had the
 * lowest chance, if it was a real underdog) and the most confident call,
 * whichever way it went.
 */
export function dayHighlights(cards: CardData[]) {
  const graded = cards.filter((c) => c.completed && c.correct !== null);
  const upset = graded.filter((c) => !c.correct && 1 - c.pickProb <= UPSET_MAX_CHANCE).sort((a, b) => b.pickProb - a.pickProb)[0] ?? null;
  const surest = [...graded].sort((a, b) => b.pickProb - a.pickProb)[0] ?? null;
  return { upset, surest: surest && surest.id !== upset?.id ? surest : null };
}

/** A winner this far down or further at a checkpoint during the game counts as a comeback. */
const COMEBACK_MAX_CHANCE = 0.25;

/**
 * The day's biggest comeback: of the finished games, the winner whose chance
 * fell lowest at a checkpoint during it (after a quarter, period or inning),
 * if that was a real hole. Read from each game's period scores with the live
 * model, so a hole dug and climbed out of within one period doesn't show.
 */
export function dayComeback(models: LeagueModel[], cards: CardData[]) {
  let best: { card: CardData; low: number; at: string } | null = null;
  for (const card of cards) {
    if (!card.completed || card.home.score === null || card.away.score === null || card.home.score === card.away.score) continue;
    const p = models.find((m) => m.league === card.league)?.predictions[card.id];
    if (!p) continue;
    const homeWon = card.home.score > card.away.score;
    for (const point of gameFlow(card.league, p.game, p.homeProb)) {
      if (point.label === 'Start' || point.label === 'Final') continue;
      const chance = homeWon ? point.homeProb : 1 - point.homeProb;
      if (chance <= COMEBACK_MAX_CHANCE && (!best || chance < best.low)) best = { card, low: chance, at: point.label };
    }
  }
  return best;
}

/** Dates with games in the models' window, oldest first. */
export function gameDates(models: LeagueModel[]) {
  const dates = new Set<string>();
  for (const m of models) for (const key of byDate(m).keys()) dates.add(key);
  return [...dates].sort();
}

/** The latest date before `today` with finished games, for the "last night" summary. */
export function lastResultsDate(models: LeagueModel[], today: string) {
  let latest: string | null = null;
  for (const m of models) {
    for (const [key, games] of byDate(m)) {
      if (key < today && (!latest || key > latest) && games.some((p) => p.game.completed)) latest = key;
    }
  }
  return latest;
}
