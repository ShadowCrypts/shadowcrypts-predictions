import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { LEAGUES } from '../../lib/leagues';
import { getLeagueModel } from '../../lib/model';
import { NBA_FANTASY_CHECK } from '../../lib/model/nbaFantasy';
import { nbaFantasyBoardFor } from '../../lib/model/nbaFantasyBoard';
import { nbaFantasyForward } from '../../lib/model/nbaFantasyLedger';
import { formatLongDay, relativeDayLabel, renderedAt } from '../../lib/time';
import { FantasySportSwitch } from './FantasySportSwitch';
import { NbaFantasyBoardView } from './NbaFantasyBoardView';
import { NbaScheduleGrid } from './NbaScheduleGrid';
import { EmptyState, PageHeader, Section } from './Section';

/** Fantasy basketball: the next night's rankings, the rest of the week, the schedule grid and the record behind them. */
export async function NbaFantasyPage() {
  const league = LEAGUES.nba;
  const model = await getLeagueModel('nba');
  const [board, forward] = await Promise.all([nbaFantasyBoardFor(league, model), nbaFantasyForward(league, model)]);
  const label = board ? relativeDayLabel(board.day, renderedAt()) : null;
  const dayLabel = label === 'Today' ? 'Tonight' : label === 'Tomorrow' ? 'Tomorrow' : board ? formatLongDay(`${board.day}T16:00:00Z`).split(',')[0] : '';

  return (
    <div className="space-y-6">
      <Link href="/nba" className="inline-flex items-center gap-1 text-sm text-ink-2 hover:text-ink">
        <ChevronLeft className="h-4 w-4" aria-hidden /> NBA
      </Link>
      <FantasySportSwitch current="nba" />
      <PageHeader eyebrow={board ? `NBA · ${formatLongDay(`${board.day}T16:00:00Z`)}` : 'NBA'} title="Fantasy basketball rankings">
        <p>
          Projected fantasy points for every rotation player, from the same player model behind our NBA props: minutes from who&apos;s healthy, production from his own games, and the pace and scoring each matchup is expected to bring. Ranked by points, discounted for the chance he
          sits. Tap + on two players to compare them.
        </p>
        <p className="mt-2 text-xs text-ink-3">Scored the NBA&apos;s own way, which FanDuel uses too: 1 a point, 1.2 a rebound, 1.5 an assist, 3 a steal or block, −1 a turnover. Other formats can read the stat line.</p>
      </PageHeader>
      {board?.rows.length ? (
        <>
          {board.started.length > 0 && <p className="text-sm text-ink-3">Already tipped off, so these teams&apos; players show their next game: {board.started.join(', ')}.</p>}
          <NbaFantasyBoardView rows={board.rows} day={board.day} dayLabel={dayLabel} />

          <Section id="schedule" title="Games this week" subtitle={`${formatLongDay(`${board.week.start}T16:00:00Z`)} to ${formatLongDay(`${board.week.end}T16:00:00Z`)}. More games means more chances to score: the usual way to pick who to stream. Highlighted games are still to play.`}>
            <NbaScheduleGrid start={board.week.start} teams={board.week.teams} />
          </Section>

          <Section title="How much to trust this" subtitle="Run on every NBA regular-season night on file, with each projection using only earlier games, against the simplest alternative: the player's own average so far.">
            <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
              <table className="w-full min-w-[440px] text-sm tabular">
                <caption className="sr-only">Fantasy projections against each player&apos;s season average, by season</caption>
                <thead>
                  <tr className="border-b border-line text-left text-xs text-ink-3">
                    <th scope="col" className="py-2 pr-3 font-medium">
                      Season
                    </th>
                    <th scope="col" className="py-2 pr-3 text-right font-medium" title="Rank correlation within each night: 1 would be a perfect order">
                      Order: ours
                    </th>
                    <th scope="col" className="py-2 pr-3 text-right font-medium">
                      Order: his average
                    </th>
                    <th scope="col" className="py-2 pr-3 text-right font-medium">
                      Miss: ours
                    </th>
                    <th scope="col" className="py-2 text-right font-medium">
                      Miss: his average
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {NBA_FANTASY_CHECK.map((c) => (
                    <tr key={c.season} className="border-b border-line/60 last:border-0">
                      <th scope="row" className="py-2 pr-3 text-left font-medium text-ink">
                        {c.season}
                      </th>
                      <td className="py-2 pr-3 text-right font-semibold text-ink">{c.order.toFixed(2)}</td>
                      <td className="py-2 pr-3 text-right text-ink-2">{c.baseline.toFixed(2)}</td>
                      <td className="py-2 pr-3 text-right font-semibold text-ink">{c.miss.toFixed(2)}</td>
                      <td className="py-2 text-right text-ink-2">{c.baselineMiss.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-4 rounded-xl bg-raised/60 p-3 text-sm ring-1 ring-line">
              <p className="font-semibold text-ink">Locked before tip-off</p>
              {forward.players > 0 ? (
                <p className="mt-1 text-ink-2">
                  Saved before each game and graded after, the fairer test: {forward.players.toLocaleString()} players over {forward.nights} {forward.nights === 1 ? 'night' : 'nights'} so far, with the {forward.sat} expected to play who didn&apos;t counted as scoring nothing. Average miss{' '}
                  <span className="font-semibold text-ink tabular">{forward.miss.toFixed(2)}</span>, against <span className="tabular">{forward.averageMiss.toFixed(2)}</span> for their own averages
                  {forward.order !== null && forward.averageOrder !== null && (
                    <>
                      ; order <span className="font-semibold text-ink tabular">{forward.order.toFixed(2)}</span> against <span className="tabular">{forward.averageOrder.toFixed(2)}</span>
                    </>
                  )}
                  .{forward.nights < 7 && ' Too few nights to read much into yet.'}
                </p>
              ) : (
                <p className="mt-1 text-ink-2">Each night&apos;s numbers are saved before tip-off and graded here after the games, with no knowledge of who sat. First results follow tonight&apos;s games.</p>
              )}
            </div>
            <div className="mt-3 space-y-2 text-xs text-ink-3">
              <p>
                A smaller miss and a better order than his own average in every season, by a modest margin. Among regulars averaging 20 or more, the order is harder to call for both (about 0.6 for ours, 0.56 for his average), and ours still came out ahead every season. A projection
                still misses by about 7 to 8 points a player, and half of real scores land outside the Range column: one night is noisy, so treat these as a tiebreaker, not a verdict. We haven&apos;t compared them with experts&apos; rankings.
              </p>
              <p>
                The test scores only players who played, since past nights&apos; projections know who dressed; the locked record above doesn&apos;t. Threes, shooting and double-doubles aren&apos;t projected. For insight and fun, not betting advice.
              </p>
            </div>
          </Section>
        </>
      ) : (
        <EmptyState>No NBA games on the board right now. Rankings come back when the schedule does.</EmptyState>
      )}
    </div>
  );
}
