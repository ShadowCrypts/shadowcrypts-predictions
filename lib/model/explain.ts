import { pct } from '../format';
import type { Factor, Prediction } from './index';
import { keyAbsences } from './injuryNews';

/** Elo a factor has to swing, one team against the other, to be worth a mention (about half a point of spread). */
const NOTABLE = 15;
/** How far our ratings can sit from the forecast and still be "about the same place". */
const AGREE = 0.03;
/** A forecast has to move this far to be worth saying so. */
const MOVED = 0.03;
/** Below this, a favorite isn't really one. */
const COIN_FLIP = 0.52;
const MOST_FACTORS = 3;
const MOST_ABSENT = 4;

const HOME_WORD = { nba: 'home court', nfl: 'home field', mlb: 'home field', nhl: 'home ice' } as const;

type Explained = Pick<Prediction, 'game' | 'market' | 'basis' | 'homeProb' | 'pick' | 'pickProb' | 'modelHomeProb' | 'factors' | 'injuries'>;

/** One rating-model factor in plain words, null when it barely matters. */
function factorPhrase(f: Factor, game: Explained['game']): string | null {
  const net = f.home - f.away;
  if (Math.abs(net) < NOTABLE) return null;
  const ahead = (net > 0 ? game.home : game.away).shortName;
  const behind = (net > 0 ? game.away : game.home).shortName;
  switch (f.label) {
    case 'Team rating':
      return `the ${ahead} rate higher (${Math.round(Math.max(f.home, f.away))} to ${Math.round(Math.min(f.home, f.away))} Elo)`;
    case 'Home field':
      return `the ${ahead} have ${HOME_WORD[game.league]}`;
    case 'Rest':
      return `the ${behind} are on a back-to-back`;
    case 'Starting goalies':
      return `the starting goalies favor the ${ahead}`;
    case 'Starting pitchers':
      return `the starting pitchers favor the ${ahead}`;
    // These two measure each team against its own recent lineups and starters, not one team against the other:
    // the Bucks missing nobody doesn't give them a better lineup than the Celtics.
    case 'Lineups':
      return `lineup changes favor the ${ahead}`;
    case 'Quarterbacks': {
      // Whichever team's change moves the number most, by name when the model knows who.
      const side = Math.abs(f.home) >= Math.abs(f.away) ? 'home' : 'away';
      const change = f.change?.[side];
      return change ? `the ${game[side].shortName} are expected to start ${change}` : `quarterback changes favor the ${ahead}`;
    }
    case 'Injuries':
      return `injuries cost the ${behind} more`;
    case 'Travel':
      return `the ${behind} traveled east across time zones`;
    default:
      return null;
  }
}

/** "A", "A and B", "A, B and C". */
function listed(items: string[]) {
  return items.length < 2 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/**
 * Why a coming game's forecast says what it says, in a few plain sentences, all
 * from numbers already on the page. Once a line is posted the forecast follows
 * the line, so it says that first; our own factors then explain our ratings'
 * number, not the forecast's, and it never claims otherwise.
 */
export function whyForecast(p: Explained, { showSpread, movement = [] }: { showSpread: boolean; movement?: { p: number }[] }): string[] {
  const { game, market } = p;
  const pick = p.pick === 'home' ? game.home : game.away;
  const chance = pct(p.pickProb);
  const sentences: string[] = [];

  if (p.basis === 'market' && market) {
    const spread = showSpread ? market.homeSpread : null;
    const line =
      spread !== null && spread !== 0
        ? `The betting line has the ${(spread < 0 ? game.home : game.away).shortName} favored by ${Math.abs(spread)}`
        : spread === 0
          ? 'The betting line calls it even'
          : p.pickProb < COIN_FLIP
            ? 'The betting market calls it about even'
            : `The betting market favors the ${pick.shortName}`;
    sentences.push(`${line}, and the forecast follows it (${pick.shortName} ${chance}) because lines have beaten every rating model we've tested.`);

    const ours = p.pick === 'home' ? p.modelHomeProb : 1 - p.modelHomeProb;
    if (ours < 1 - COIN_FLIP) {
      const other = p.pick === 'home' ? game.away : game.home;
      sentences.push(`Our own ratings lean the other way, to the ${other.shortName} at ${pct(1 - ours)}. When the two disagree, the line has been right more often.`);
    } else if (ours < COIN_FLIP) {
      sentences.push('Our own ratings call it about even.');
    } else if (Math.abs(ours - p.pickProb) <= AGREE) {
      sentences.push(`Our own ratings land in about the same place, at ${pct(ours)}.`);
    } else {
      sentences.push(`Our own ratings like the ${pick.shortName} ${ours > p.pickProb ? 'more' : 'less'}, at ${pct(ours)}.`);
    }
  } else {
    sentences.push(
      p.pickProb < COIN_FLIP
        ? `No betting line is up yet, and our pre-line forecast calls it about even (${pick.shortName} ${chance}). It switches to the line once one posts.`
        : `No betting line is up yet, so this is our pre-line forecast: the ${pick.shortName} at ${chance}, from our Elo ratings and what past lines said about each team. It switches to the line once one posts.`
    );
  }

  const reasons = p.factors
    .map((f) => ({ size: Math.abs(f.home - f.away), phrase: factorPhrase(f, game) }))
    .filter((f): f is { size: number; phrase: string } => f.phrase !== null)
    .sort((a, b) => b.size - a.size)
    .slice(0, MOST_FACTORS)
    .map((f) => f.phrase);
  if (reasons.length) {
    sentences.push(`${p.basis === 'market' ? "Behind our ratings' number" : 'Behind that number'}: ${listed(reasons)}.`);
  }

  // "id|TEAM|Name", from the same list the movement alerts use.
  const absent = keyAbsences(p).map((key) => {
    const [, team, ...name] = key.split('|');
    return `${name.join('|')} (${team})`;
  });
  if (absent.length) {
    const more = absent.length - MOST_ABSENT;
    sentences.push(`Likely out: ${listed([...absent.slice(0, MOST_ABSENT), ...(more > 0 ? [`${more} more`] : [])])}.`);
  }

  if (movement.length >= 2) {
    const first = movement[0].p;
    const moved = p.homeProb - first;
    if (Math.abs(moved) >= MOVED) {
      const toward = moved > 0 ? game.home : game.away;
      const then = moved > 0 ? first : 1 - first;
      const now = moved > 0 ? p.homeProb : 1 - p.homeProb;
      sentences.push(`It's moved toward the ${toward.shortName} since we first logged it, from ${pct(then)} to ${pct(now)}.`);
    }
  }
  return sentences;
}
