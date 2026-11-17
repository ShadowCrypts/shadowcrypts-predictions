import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ChevronLeft } from 'lucide-react';
import { LEAGUES } from '../../../lib/leagues';
import { getLeagueModel } from '../../../lib/model';
import { FANTASY_CHECK, type FantasyPosition } from '../../../lib/model/fantasy';
import { START_BANDS } from '../../../lib/model/startSit';
import { startSitWeekFor, type StartSitEntry } from '../../../lib/model/startSitWeek';
import { formatLongDay } from '../../../lib/time';
import { EmptyState, PageHeader, Section } from '../../components/Section';
import { StartSitPicker } from '../../components/StartSitPicker';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ league: string }>; searchParams?: Promise<{ a?: string }> };

const POSITION_NAMES: Record<FantasyPosition, string> = { QB: 'Quarterbacks', RB: 'Running backs', WR: 'Wide receivers', TE: 'Tight ends' };

async function load() {
  const model = await getLeagueModel('nfl');
  return { model, week: await startSitWeekFor(LEAGUES.nfl, model) };
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  if ((await params).league !== 'nfl') return {};
  const { model, week } = await load();
  const w = week?.week ? `Week ${week.week}` : 'This week';
  return {
    // As it's searched: "week 12 start em sit em", "who to start week 12".
    title: `${w} start 'em, sit 'em: fantasy football start/sit picks`,
    description: `Who to start and sit in ${w.toLowerCase()} of the ${model.season.label ?? model.season.year} NFL season: players projected well above or below their usual, starters on the injury report, a who-should-I-start picker, and how last week's calls did.`,
    alternates: { canonical: '/nfl/start-sit' }
  };
}

function Entry({ e, kind }: { e: StartSitEntry; kind: 'start' | 'sit' }) {
  const r = e.row;
  return (
    <li className="flex items-start justify-between gap-3 py-2">
      <span className="min-w-0">
        <Link href={`/nfl/player/${r.id}`} className="font-medium text-ink hover:underline">
          {r.name}
        </Link>
        <span className="block text-xs text-ink-3">
          {r.team.abbr} {r.home ? 'vs' : '@'} {r.opponent} · #{e.rank} {r.position} by season average{r.status ? ` · ${r.status}` : ''}
        </span>
      </span>
      <span className="shrink-0 text-right text-sm tabular">
        <span className={`font-semibold ${kind === 'start' ? 'text-good' : 'text-bad'}`}>{e.points.toFixed(1)}</span>
        <span className="block text-xs text-ink-3">
          usually {e.average!.toFixed(1)} ({e.gap > 0 ? '+' : '−'}
          {Math.abs(e.gap).toFixed(1)})
        </span>
      </span>
    </li>
  );
}

export default async function StartSitPage({ params, searchParams }: Params) {
  if ((await params).league !== 'nfl') notFound();
  const { week } = await load();
  // From a player's page: "compare him with anyone" opens the picker with him chosen.
  const first = (await searchParams)?.a;
  const initial = first && /^\d{1,15}$/.test(first) && week?.players.some((p) => p.id === first) ? first : undefined;
  const latest = FANTASY_CHECK[FANTASY_CHECK.length - 1];
  const name = week?.week ? `Week ${week.week}` : 'This week';

  return (
    <div className="space-y-6">
      <Link href="/nfl/fantasy" className="inline-flex items-center gap-1 text-sm text-ink-2 hover:text-ink">
        <ChevronLeft className="h-4 w-4" aria-hidden /> Fantasy rankings
      </Link>
      <PageHeader eyebrow={week ? `NFL · Fantasy · week of ${formatLongDay(week.start)}` : 'NFL · Fantasy'} title={`${name} start 'em, sit 'em`}>
        <p>
          Players whose projection this week is well above, or well below, what they usually score, among those whose start is actually in question. PPR points,
          from the same model as our fantasy rankings and props.
        </p>
      </PageHeader>

      {!week ? (
        <EmptyState>No NFL games on the board this week. Start/sit picks come back when the schedule does.</EmptyState>
      ) : (
        <>
          {(week.byes.length > 0 || week.started.length > 0) && (
            <p className="text-sm text-ink-3">
              {week.byes.length > 0 && `On a bye: ${week.byes.join(', ')}. `}
              {week.started.length > 0 && `Already kicked off, so not listed: ${week.started.join(', ')}.`}
            </p>
          )}

          <Section id="picker" title="Who should I start?" subtitle="Any two players on this week's board, with how often that call has come out right.">
            <StartSitPicker players={week.players} initial={initial} />
          </Section>

          {(['QB', 'RB', 'WR', 'TE'] as FantasyPosition[]).map((pos) => {
            const { start, sit } = week.picks[pos];
            return (
              <Section key={pos} title={POSITION_NAMES[pos]}>
                <div className="grid gap-6 md:grid-cols-2">
                  <div>
                    <h3 className="text-sm font-semibold text-good">Start &apos;em</h3>
                    {start.length ? (
                      <ul className="mt-1 divide-y divide-line">
                        {start.map((e) => (
                          <Entry key={e.id} e={e} kind="start" />
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-2 text-sm text-ink-3">Nobody in the start-or-sit range is projected well above his usual this week.</p>
                    )}
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-bad">Sit &apos;em</h3>
                    {sit.length ? (
                      <ul className="mt-1 divide-y divide-line">
                        {sit.map((e) => (
                          <Entry key={e.id} e={e} kind="sit" />
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-2 text-sm text-ink-3">No regular starter is projected well below his usual this week.</p>
                    )}
                  </div>
                </div>
              </Section>
            );
          })}

          {week.injuries.length > 0 && (
            <Section title="Injury watch" subtitle="Regular starters (by season average) on this week's injury report. Check the final word before kickoff.">
              <ul className="divide-y divide-line">
                {week.injuries.map(({ row, rank }) => (
                  <li key={row.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                    <span>
                      <Link href={`/nfl/player/${row.id}`} className="font-medium text-ink hover:underline">
                        {row.name}
                      </Link>{' '}
                      <span className="text-ink-3">
                        {row.team.abbr} · #{rank} {row.position}
                      </span>
                    </span>
                    <span className="font-semibold text-bad">{row.status}</span>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          <Section title="How these are picked, and how they've done">
            <div className="space-y-3 text-sm text-ink-2">
              {week.lastWeek && week.lastWeek.grade.starts + week.lastWeek.grade.sits > 0 ? (
                <p className="rounded-xl bg-raised/60 p-3 ring-1 ring-line">
                  <span className="font-semibold text-ink">{week.lastWeek.week ? `Week ${week.lastWeek.week}` : 'Last week'}&apos;s calls</span>, made again from the
                  projections locked before its games: {week.lastWeek.grade.startsBeat} of {week.lastWeek.grade.starts} starts beat their season average
                  {week.lastWeek.grade.sat > 0 ? ` (${week.lastWeek.grade.sat} didn't play, counted as misses)` : ''}, and {week.lastWeek.grade.sitsShort} of{' '}
                  {week.lastWeek.grade.sits} sits fell short of theirs.
                </p>
              ) : (
                <p className="rounded-xl bg-raised/60 p-3 ring-1 ring-line">Each week&apos;s calls are graded here once its games are over, against what they claimed.</p>
              )}
              <p>
                A <span className="text-good">start</span> is a fringe starter or bench player (for example, running backs ranked {START_BANDS.RB.start[0]}–
                {START_BANDS.RB.start[1]} by season average) projected at least 2 points, or 15%, above his own average. A <span className="text-bad">sit</span> is a regular
                starter projected that far below his. Studs start every week whatever anyone says, so they&apos;re left out; so are players with fewer than three games or
                a real doubt about playing, and nobody on the injury report is ever a start.
              </p>
              <p className="text-xs text-ink-3">
                The projections beat each player&apos;s own average in every season tested ({latest.season}: an average miss of {latest.miss.toFixed(2)} points against{' '}
                {latest.baselineMiss.toFixed(2)}), but they still miss by about 5 points a player: one game is noisy, so use these as a tiebreaker, not a verdict. Full
                details on the{' '}
                <Link href="/nfl/fantasy" className="underline underline-offset-2">
                  fantasy rankings
                </Link>{' '}
                page. For insight and fun, not betting advice.
              </p>
            </div>
          </Section>
        </>
      )}
    </div>
  );
}
