// Fighter ratings (Elo) from every UFC fight in order: each fight moves the winner up and the loser down by
// how surprising the result was. Pure, so the backtest (scripts/ufc-backtest.ts) and the site use the same code.
import type { UfcBout } from './feed';

export type UfcEloParams = {
  /** Points a fight can move a seasoned fighter's rating. */
  k: number;
  /** Extra points for a newcomer, fading over their first `newFights` fights (their rating has more to learn). */
  newK: number;
  newFights: number;
  /** Where a fighter's first UFC fight starts them: newcomers lose more often than not. */
  debut: number;
  /** A finish moves ratings this much more than a decision (0.2 = 20%). */
  finishBonus: number;
};

/**
 * Chosen on 2006–2018 fights and tested on 2019 onward (scripts/ufc-backtest.ts). Even at their best the
 * ratings are a weak guide to UFC fights: 56% right in the held-out years, where the betting market was 67%.
 */
export const UFC_ELO: UfcEloParams = { k: 64, newK: 32, newFights: 3, debut: 1250, finishBonus: 0.2 };

export const winChance = (ratingA: number, ratingB: number) => 1 / (1 + 10 ** ((ratingB - ratingA) / 400));

export type FighterRating = { rating: number; fights: number; wins: number; losses: number; draws: number; noContests: number; last: string; peak: number };

/** One fight as the ratings saw it: both ratings and fighter A's chance before it. */
export type RatedBout = { id: string; ratingA: number; ratingB: number; chanceA: number };

const isFinish = (b: Pick<UfcBout, 'round' | 'rounds' | 'clock'>) => !(b.round === b.rounds && b.clock === '5:00');

/**
 * Runs the ratings through every finished fight (oldest first). Returns each fighter's rating and UFC record,
 * and each finished fight's pre-fight ratings and chance.
 */
export function rateFights(bouts: UfcBout[], params: UfcEloParams = UFC_ELO) {
  const fighters = new Map<string, FighterRating>();
  const rated = new Map<string, RatedBout>();
  const get = (id: string, date: string) => {
    let f = fighters.get(id);
    if (!f) {
      f = { rating: params.debut, fights: 0, wins: 0, losses: 0, draws: 0, noContests: 0, last: date, peak: params.debut };
      fighters.set(id, f);
    }
    return f;
  };
  const kFor = (f: FighterRating) => params.k + params.newK * Math.max(0, (params.newFights - f.fights) / params.newFights);

  for (const bout of [...bouts].filter((b) => b.completed).sort((x, y) => x.date.localeCompare(y.date) || x.order - y.order)) {
    const a = get(bout.a.id, bout.date);
    const b = get(bout.b.id, bout.date);
    const chanceA = winChance(a.rating, b.rating);
    rated.set(bout.id, { id: bout.id, ratingA: a.rating, ratingB: b.rating, chanceA });
    a.last = b.last = bout.date;
    const aWon = bout.a.winner === true;
    const bWon = bout.b.winner === true;
    if (!aWon && !bWon) {
      // A draw at the full distance counts as half a win each; a no contest moves nothing.
      if (bout.round === bout.rounds && bout.clock === '5:00') {
        const swing = 0.5 - chanceA;
        a.rating += kFor(a) * swing;
        b.rating -= kFor(b) * swing;
        a.draws += 1;
        b.draws += 1;
        a.fights += 1;
        b.fights += 1;
      } else {
        a.noContests += 1;
        b.noContests += 1;
      }
      continue;
    }
    const bonus = isFinish(bout) ? 1 + params.finishBonus : 1;
    const swing = (aWon ? 1 : 0) - chanceA;
    const kA = kFor(a) * bonus;
    const kB = kFor(b) * bonus;
    a.rating += kA * swing;
    b.rating -= kB * swing;
    a.fights += 1;
    b.fights += 1;
    if (aWon) {
      a.wins += 1;
      b.losses += 1;
    } else {
      b.wins += 1;
      a.losses += 1;
    }
    a.peak = Math.max(a.peak, a.rating);
    b.peak = Math.max(b.peak, b.rating);
  }
  return { fighters, rated };
}
