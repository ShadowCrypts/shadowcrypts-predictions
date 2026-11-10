import type { LeagueId } from '../../lib/leagues';
import { SPREAD_NAME, Tally, tallyText, TeamTrends, TREND_CHECK } from '../../lib/model/trends';
import { ChanceBar } from './ChanceBar';
import { TeamBadge } from './TeamColors';

const share = (t: Tally) => (t.w + t.l ? t.w / (t.w + t.l) : null);

function Cell({ tally }: { tally: Tally }) {
  const s = share(tally);
  return (
    <span className="inline-flex flex-col items-end">
      <span className="font-semibold text-ink tabular">{tally.w + tally.l + tally.p ? tallyText(tally) : '—'}</span>
      {s !== null && <ChanceBar chance={s} />}
    </span>
  );
}

/** The line in plain words under a trends table: what it counts, and that it doesn't predict. */
export function TrendsNote() {
  return (
    <p className="mt-3 text-xs text-ink-3">
      Against each game&apos;s closing line. Books set every line knowing these records: across {TREND_CHECK.games.toLocaleString()} past games, the team
      with the better record against the spread so far that season covered {((TREND_CHECK.covered / TREND_CHECK.games) * 100).toFixed(1)}%, short of the
      52.4% a standard −110 bet needs, and over/under streaks held {((TREND_CHECK.held / TREND_CHECK.totals) * 100).toFixed(1)}% of the time. They describe
      the past.
    </p>
  );
}

/** One team's records against the closing lines. */
export function TeamTrendsPanel({ league, trends }: { league: LeagueId; trends: TeamTrends }) {
  const rows: [string, Tally][] = [
    [SPREAD_NAME[league], trends.ats],
    ['Last 10', trends.atsLast10],
    ['As the favorite', trends.atsFavorite],
    ['As the underdog', trends.atsUnderdog],
    ['Overs–unders', trends.ou],
    ['Overs–unders, last 10', trends.ouLast10]
  ];
  return (
    <div>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
        {rows.map(([label, tally]) => (
          <div key={label} className="flex items-center justify-between gap-3 border-b border-line/60 py-1.5">
            <dt className="text-ink-2">{label}</dt>
            <dd>
              <Cell tally={tally} />
            </dd>
          </div>
        ))}
      </dl>
      <TrendsNote />
    </div>
  );
}

type Side = { abbr: string; shortName: string; logo: string | null; color: string };

/** Both teams' records against the closing lines, side by side. */
export function GameTrends({
  league,
  away,
  home,
  awayTrends,
  homeTrends,
  season = 'This season'
}: {
  league: LeagueId;
  away: Side;
  home: Side;
  awayTrends: TeamTrends;
  homeTrends: TeamTrends;
  season?: string;
}) {
  const rows: [string, (t: TeamTrends) => Tally][] = [
    [SPREAD_NAME[league], (t) => t.ats],
    ['Last 10', (t) => t.atsLast10],
    ['Favorite', (t) => t.atsFavorite],
    ['Underdog', (t) => t.atsUnderdog],
    ['Overs–unders', (t) => t.ou],
    ['Overs–unders, last 10', (t) => t.ouLast10]
  ];
  return (
    <div className="max-w-2xl">
      <table className="w-full text-sm tabular">
        <thead>
          <tr className="text-xs text-ink-3">
            <th className="pb-2 text-left font-medium">{season}</th>
            {[away, home].map((s) => (
              <th key={s.abbr} className="pb-2 text-right font-medium">
                <span className="inline-flex items-center gap-1.5">
                  <TeamBadge side={s} size={16} />
                  {s.abbr}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, get]) => (
            <tr key={label} className="border-t border-line/60">
              <th scope="row" className="py-2 text-left font-normal text-ink-2">
                {label}
              </th>
              <td className="py-2 text-right">
                <Cell tally={get(awayTrends)} />
              </td>
              <td className="py-2 text-right">
                <Cell tally={get(homeTrends)} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <TrendsNote />
    </div>
  );
}
