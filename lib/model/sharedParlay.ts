import { isLeagueId, propParams } from '../leagues';
import { ParsedLeg, parseLegId } from '../legs';
import type { LegLink } from './correlation';
import { getLeagueModel } from './index';
import { chanceAt } from './propModel';
import { marketLabel } from '../props';

/** A leg as the parlay builder keeps it. */
export type SharedLeg = {
  key: string;
  group: string;
  league: string;
  gameId: string;
  game: string;
  start: string;
  label: string;
  prob: number;
  price: number | null;
  book: string | null;
  link: LegLink;
  line?: number;
};

/** "25+" for the over at 24.5; "over 25" for a whole-number line, which can push (as the player page names alt lines). */
const overName = (at: number) => (Number.isInteger(at) ? `over ${at}` : `${at + 0.5}+`);

/**
 * A shared parlay rebuilt from its leg ids, entirely from the model: names,
 * the current chance and the posted price, as the props and game pages would
 * give them now. A link can't put words or numbers in the site's mouth.
 * Legs that can't be priced any more (the game started, the line came down)
 * are counted, not shown.
 */
export async function sharedLegs(ids: string[]): Promise<{ legs: SharedLeg[]; unavailable: number }> {
  const legs: SharedLeg[] = [];
  let unavailable = 0;
  for (const id of ids) {
    const leg = parseLegId(id);
    const priced = leg && isLeagueId(leg.league) ? await price(leg).catch(() => null) : null;
    if (priced && !legs.some((l) => l.group === priced.group)) legs.push(priced);
    else unavailable += 1;
  }
  return { legs, unavailable };
}

async function price(leg: ParsedLeg): Promise<SharedLeg | null> {
  if (!isLeagueId(leg.league)) return null;
  const model = await getLeagueModel(leg.league);
  const prediction = model.predictions[leg.gameId];
  if (!prediction || prediction.game.state !== 'pre') return null;
  const { game, market } = prediction;
  const base = { league: leg.league, gameId: game.id, game: `${game.away.abbr} @ ${game.home.abbr}`, start: game.date };
  if (leg.kind === 'win') {
    const home = leg.teamId === game.home.teamId;
    const side = home ? game.home : leg.teamId === game.away.teamId ? game.away : null;
    if (!side) return null;
    const group = `${leg.league}:${game.id}:moneyline`;
    return {
      ...base,
      key: `${group}:${side.abbr}`,
      group,
      label: `${side.shortName} to win`,
      prob: home ? prediction.homeProb : 1 - prediction.homeProb,
      price: market ? (home ? market.homeMoneyline : market.awayMoneyline) : null,
      book: market?.provider ?? null,
      link: { kind: 'win', teamId: side.teamId }
    };
  }
  const row = model.propBoards[game.id]?.rows.find((r) => r.id === leg.playerId);
  const main = row?.cells[leg.market]?.line;
  const params = propParams(leg.league);
  if (!row || !main || !params) return null;
  const group = `${leg.league}:${game.id}:${row.id}:${leg.market}`;
  const isMain = leg.line === main.line;
  const over = isMain ? main.forecastOver : chanceAt(params, leg.market, main.line, main.forecastOver)(leg.line);
  const long = marketLabel(leg.market).long;
  return {
    ...base,
    key: isMain ? `${group}:${leg.side}` : `${group}:${leg.side}@${leg.line}`,
    group,
    label: `${row.name} ${leg.side === 'over' ? (isMain ? `over ${leg.line}` : overName(leg.line)) : `under ${leg.line}`} ${long}`,
    prob: leg.side === 'over' ? over : 1 - over,
    price: isMain ? (leg.side === 'over' ? main.over : main.under) : null,
    book: isMain ? main.book : null,
    link: { kind: 'prop', playerId: row.id, teamId: row.teamId, market: leg.market, side: leg.side },
    line: leg.line
  };
}
