import type { GameSide, GameState } from '../espn';
import { spreadLabel } from '../format';
import { LEAGUES, LeagueId } from '../leagues';
import { matchupColors } from '../teamColor';
import type { Prediction } from './index';
import { gameFlow, liveNow } from './live';
import { formatAmerican } from './market';
import type { Band } from './metrics';

export type CardSide = {
  teamId: string;
  abbr: string;
  name: string;
  shortName: string;
  logo: string | null;
  /** The team's color as drawn here (bars, glows), kept apart from the other team's. */
  color: string;
  score: number | null;
  record: string | null;
};

/** Everything a game card needs, small enough to hand to client components. */
export type CardData = {
  id: string;
  league: LeagueId;
  date: string;
  state: GameState;
  completed: boolean;
  statusDetail: string;
  note: string | null;
  broadcast: string | null;
  away: CardSide;
  home: CardSide;
  homeProb: number;
  pick: 'home' | 'away';
  pickProb: number;
  band: Band;
  basis: 'market' | 'model';
  correct: boolean | null;
  /** Rating model alone, and the market's (vig-free) number, home side. */
  modelHomeProb: number;
  marketHomeProb: number | null;
  /** Posted line in plain words: "MIL -1.5" or "CHI +120 / MIL -140". */
  line: string | null;
  /** In-game home win probability while the game is on; null otherwise. */
  liveHomeProb: number | null;
  /** Home win probability at the start and after each period so far, while the game is on. */
  liveFlow: number[] | null;
  /** Projected final score, consistent with the forecast. */
  projected: { home: number; away: number } | null;
  /** True when this forecast was logged before the game; false when it's reconstructed from the backtest. */
  locked: boolean;
};

const side = (s: GameSide, color: string): CardSide => ({
  teamId: s.teamId,
  abbr: s.abbr,
  name: s.name,
  shortName: s.shortName,
  logo: s.logo,
  color,
  score: s.score,
  record: s.record
});

export function toCard(p: Prediction): CardData {
  const { game, market } = p;
  const hasSpread = LEAGUES[game.league].elo.eloPerPoint !== null;
  const line = market
    ? hasSpread && market.homeSpread !== null
      ? spreadLabel(game.home.abbr, game.away.abbr, market.homeSpread)
      : `${game.away.abbr} ${formatAmerican(market.awayMoneyline)} / ${game.home.abbr} ${formatAmerican(market.homeMoneyline)}`
    : null;
  const live = liveNow(game.league, game, p.homeProb);
  const colors = matchupColors(game.away, game.home);
  return {
    id: game.id,
    league: game.league,
    date: game.date,
    state: game.state,
    completed: game.completed,
    statusDetail: game.statusDetail,
    note: game.note,
    broadcast: game.broadcast,
    away: side(game.away, colors.away),
    home: side(game.home, colors.home),
    homeProb: p.homeProb,
    pick: p.pick,
    pickProb: p.pickProb,
    band: p.band,
    basis: p.basis,
    correct: p.correct,
    modelHomeProb: p.modelHomeProb,
    marketHomeProb: market?.homeProb ?? null,
    line,
    liveHomeProb: live?.homeProb ?? null,
    liveFlow: live ? gameFlow(game.league, game, p.homeProb).map((f) => f.homeProb) : null,
    projected: p.projected ? { home: p.projected.home, away: p.projected.away } : null,
    locked: p.source === 'logged'
  };
}
