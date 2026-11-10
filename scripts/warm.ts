/**
 * Pre-downloads every season the model replays, plus closing betting lines for
 * every graded game, into .cache/ so page loads never have to. Safe to re-run:
 * finished months and lines already on file are skipped.
 *
 *   npm run warm
 */
import { getBoxScores, getNflSkillBoxes } from '../lib/boxscores';
import { getClosingOdds, getInjuries, getLeagueGames, getTeams } from '../lib/espn';
import { LEAGUE_IDS, LEAGUES } from '../lib/leagues';
import { getPropHistory } from '../lib/propFeed';
import { hasPropModel } from '../lib/props';

async function main() {
  for (const id of LEAGUE_IDS) {
    const league = LEAGUES[id];
    const started = Date.now();
    const [games] = await Promise.all([getLeagueGames(league), getTeams(league), getInjuries(league)]);
    const regular = games.filter((g) => g.seasonType === 2 || g.seasonType === 3);
    const first = Math.min(...regular.map((g) => g.seasonYear));
    const graded = regular.filter((g) => g.completed && g.seasonYear > first);
    const odds = await getClosingOdds(league, graded);
    const lines = Object.values(odds).filter(Boolean).length;
    // Box scores for every finished game, which the lineup and quarterback models replay from the start.
    const box = league.lineups || league.quarterbacks ? await getBoxScores(league, regular) : null;
    const boxNote = box ? `, box scores for ${Object.values(box).filter(Boolean).length} of ${regular.filter((g) => g.completed).length}` : '';
    // NHL skaters and goalies, and NFL rushers and receivers, for the player projections.
    if (league.id === 'nhl') await getBoxScores(league, regular);
    if (league.id === 'nfl') await getNflSkillBoxes(league, regular);
    // Sportsbook player props, which the player projections are graded against.
    const props = hasPropModel(league) ? await getPropHistory(league, graded) : null;
    const propNote = props ? `, player props for ${Object.values(props).filter(Boolean).length}` : '';
    console.log(
      `${league.name}: ${games.length} games, closing lines for ${lines} of ${graded.length} graded${boxNote}${propNote} in ${((Date.now() - started) / 1000).toFixed(1)}s`
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
