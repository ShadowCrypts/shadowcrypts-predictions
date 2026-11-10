import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ChevronLeft } from 'lucide-react';
import { LEAGUES } from '../../../lib/leagues';
import { getLeagueModel } from '../../../lib/model';
import { FANTASY_CHECK } from '../../../lib/model/fantasy';
import { fantasyBoard } from '../../../lib/model/fantasyBoard';
import { fantasyForward } from '../../../lib/model/fantasyLedger';
import { formatLongDay } from '../../../lib/time';
import { FantasyBoardView } from '../../components/FantasyBoardView';
import { EmptyState, PageHeader, Section } from '../../components/Section';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ league: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { league } = await params;
  if (league !== 'nfl') return {};
  return {
    title: 'NFL fantasy football rankings this week',
    description: 'Projected fantasy points for every quarterback, running back, receiver and tight end this week, in PPR, half PPR or standard, with the record to back them.',
    alternates: { canonical: '/nfl/fantasy' }
  };
}

export default async function FantasyPage({ params }: Params) {
  const { league: id } = await params;
  // Football only: it's the one league with a stat model behind every position people draft.
  if (id !== 'nfl') notFound();
  const league = LEAGUES.nfl;
  const model = await getLeagueModel('nfl');
  const [board, forward] = await Promise.all([fantasyBoard(league, model), fantasyForward(league, model)]);

  return (
    <div className="space-y-6">
      <Link href="/nfl" className="inline-flex items-center gap-1 text-sm text-ink-2 hover:text-ink">
        <ChevronLeft className="h-4 w-4" aria-hidden /> NFL
      </Link>
      <PageHeader eyebrow={board ? `NFL · Week of ${formatLongDay(board.start)}` : 'NFL'} title="Fantasy rankings">
        <p>Projected points for this week&apos;s games, from the same player model behind our props. Ranked by points, discounted for the chance he sits. Tap + on two players to compare them.</p>
      </PageHeader>
      {board?.rows.length ? (
        <>
          {(board.byes.length > 0 || board.started.length > 0) && (
            <p className="text-sm text-ink-3">
              {board.byes.length > 0 && `On a bye: ${board.byes.join(', ')}. `}
              {board.started.length > 0 && `Already kicked off, so not listed: ${board.started.join(', ')}.`}
            </p>
          )}
          <FantasyBoardView rows={board.rows} />
          <Section title="How much to trust this" subtitle="Run on every NFL week on file, with each projection using only earlier games, against the simplest alternative: the player's own average so far.">
            <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
              <table className="w-full min-w-[440px] text-sm tabular">
                <caption className="sr-only">Fantasy projections against each player&apos;s season average, by season</caption>
                <thead>
                  <tr className="border-b border-line text-left text-xs text-ink-3">
                    <th scope="col" className="py-2 pr-3 font-medium">
                      Season
                    </th>
                    <th scope="col" className="py-2 pr-3 text-right font-medium" title="Rank correlation within each week and position: 1 would be a perfect order">
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
                  {FANTASY_CHECK.map((c) => (
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
              <p className="font-semibold text-ink">Locked before kickoff</p>
              {forward.players > 0 ? (
                <p className="mt-1 text-ink-2">
                  Saved before each game and graded after, the fairer test: {forward.players.toLocaleString()} players over {forward.weeks} {forward.weeks === 1 ? 'week' : 'weeks'} so far, with the {forward.sat} expected to play who didn&apos;t counted as scoring nothing. Average miss{' '}
                  <span className="font-semibold text-ink tabular">{forward.miss.toFixed(2)}</span>, against <span className="tabular">{forward.averageMiss.toFixed(2)}</span> for their own averages
                  {forward.order !== null && forward.averageOrder !== null && (
                    <>
                      ; order <span className="font-semibold text-ink tabular">{forward.order.toFixed(2)}</span> against <span className="tabular">{forward.averageOrder.toFixed(2)}</span>
                    </>
                  )}
                  .{forward.weeks < 4 && ' Too few weeks to read much into yet.'}
                </p>
              ) : (
                <p className="mt-1 text-ink-2">Each week&apos;s numbers are saved before kickoff and graded here after the games, with no knowledge of who was active. First results follow this week&apos;s games.</p>
              )}
            </div>
            <div className="mt-3 space-y-2 text-xs text-ink-3">
              <p>
                A smaller miss than his average every season, by a modest margin, and a better order in all but 2023, when the two were about even. Even so, a projection misses by about 5 points a player, and half of real scores land outside the Range column: one game is noisy, so treat
                these as a tiebreaker, not a verdict. We haven&apos;t compared them with experts&apos; rankings.
              </p>
              <p>
                The test scores only players who played, since the past games&apos; projections know who was active. We pull top backs and receivers down because the model ran high on them; that correction was fitted on the seasons before 2026, so 2026 is the clean test. Lost fumbles,
                two-point tries, kickers and defenses aren&apos;t projected. For insight and fun, not betting advice.
              </p>
            </div>
          </Section>
        </>
      ) : (
        <EmptyState>No NFL games on the board this week. Rankings come back when the schedule does.</EmptyState>
      )}
    </div>
  );
}
