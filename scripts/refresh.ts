/**
 * Keeps logged forecasts current so each one locks close to its game's start.
 * Rebuilding a league's model re-logs its upcoming games in .cache/ledger/, and
 * the last entry before a game starts is the one that gets graded. Each league
 * is rebuilt every 10 minutes while any of its games starts within 3 hours,
 * otherwise every 45 minutes. Runs until stopped.
 *
 *   npm run refresh
 */
import { LEAGUE_IDS, LEAGUES, LeagueId } from '../lib/leagues';
import { getLeagueModel } from '../lib/model';
import { readLedger } from '../lib/model/ledger';

const SOON_MS = 3 * 3_600_000;
const FAST_MS = 10 * 60_000;
const SLOW_MS = 45 * 60_000;

const nextRun = new Map<LeagueId, number>(LEAGUE_IDS.map((id) => [id, 0]));
const clock = (ms: number) => new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

async function refresh(id: LeagueId) {
  const { name } = LEAGUES[id];
  const started = Date.now();
  try {
    const model = await getLeagueModel(id, { fresh: true });
    // If a rebuild throws, getLeagueModel hands back the previous model instead.
    if (Date.parse(model.generatedAt) < started) throw new Error(`rebuild failed, still serving the ${clock(Date.parse(model.generatedAt))} model`);
    const soon = Object.values(model.predictions).filter((p) => {
      const start = Date.parse(p.game.date);
      return p.game.state === 'pre' && start > started && start - started <= SOON_MS;
    }).length;
    const ledger = await readLedger(id);
    const logged = Object.values(ledger).filter((e) => e.takenAt === model.generatedAt).length;
    nextRun.set(id, started + (soon ? FAST_MS : SLOW_MS));
    return `${name} ${logged} logged${soon ? ` (${soon} start within 3h)` : ''}`;
  } catch (error) {
    nextRun.set(id, started + FAST_MS);
    return `${name} failed: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function main() {
  console.log('Refreshing forecasts every 10 min while a game starts within 3 hours, otherwise every 45 min. Ctrl+C to stop.');
  for (;;) {
    const now = Date.now();
    const results = await Promise.all(LEAGUE_IDS.filter((id) => nextRun.get(id)! <= now).map(refresh));
    const next = Math.min(...nextRun.values());
    // Plain ASCII so the line survives being redirected to a log file on Windows.
    console.log(`${clock(now)}  ${results.join(' | ')} | next pass ${clock(next)}`);
    await new Promise((resolve) => setTimeout(resolve, Math.max(next - Date.now(), 5_000)));
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
