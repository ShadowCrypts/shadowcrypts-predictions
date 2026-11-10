import type { Metadata } from 'next';
import Link from 'next/link';
import { LIMITS } from '../../lib/security';
import { PageHeader, Section } from '../components/Section';

export const metadata: Metadata = {
  title: 'Data and API',
  description: 'Every forecast, ranking and graded result as JSON or CSV: the endpoints, their parameters and their limits.'
};

type Endpoint = { path: string; example: string; what: string; params?: string; costly?: boolean };

const JSON_ENDPOINTS: Endpoint[] = [
  {
    path: '/api/predictions',
    example: '/api/predictions?league=nba',
    what: 'Every game on the board: the forecast, the pick, fair odds, the posted line, the rating model on its own, the projected score, and the live score and clock for games on now.',
    params: 'league: nfl, nba, mlb or nhl (leave it out for all four)'
  },
  {
    path: '/api/rankings',
    example: '/api/rankings?league=nhl',
    what: 'Power rankings: each team’s Elo rating and rank, its market-implied rating and rank, its record and its change this season.',
    params: 'league, as above'
  },
  {
    path: '/api/record',
    example: '/api/record?league=nfl',
    what: 'The track record: accuracy, Brier score and log loss overall, by season, by confidence band and against the market, plus the logged forward record and the player props record.',
    params: 'league, as above'
  },
  { path: '/api/live', example: '/api/live', what: 'Games on now (with live win chances), starting soon and just finished.' },
  { path: '/api/teams', example: '/api/teams', what: 'Every team in the four leagues: id, name, short name, abbreviation and logo.' },
  { path: '/api/players', example: '/api/players', what: 'Every player with a page (NBA, NHL, NFL): id, name, team and how much he plays, busiest first.' },
  {
    path: '/api/players/next',
    example: '/api/players/next?ids=nba:3112335',
    what: 'Players’ next games and their main prop lines with the site’s chance of each over.',
    params: 'ids: up to 40 "league:playerId" keys, comma-separated; lines=all for every market'
  },
  {
    path: '/api/cards',
    example: '/api/cards?ids=nba:401909907',
    what: 'Games by id, as the site’s cards show them (finished ones too).',
    params: 'ids: "league:gameId" keys, comma-separated',
    costly: true
  }
];

const FILES: Endpoint[] = [
  {
    path: '/api/graded',
    example: '/api/graded?league=nba',
    what: 'Every graded game as a spreadsheet: the forecast it was graded on, the pick, the result and whether it was right. Reconciles exactly with the track record.',
    params: 'league, as above'
  },
  {
    path: '/api/graded-props',
    example: '/api/graded-props?league=nhl',
    what: 'Every logged prop pick (the model’s 10+ point disagreements, logged before the game) with the line, price and result.',
    params: 'league: nba, nhl or nfl'
  },
  {
    path: '/api/calendar',
    example: '/api/calendar?teams=nba:13',
    what: 'A calendar feed (iCalendar) of followed teams’ games with the forecast in each event, for any calendar app.',
    params: 'teams: "league:teamId" keys, comma-separated',
    costly: true
  }
];

function Row({ e }: { e: Endpoint }) {
  return (
    <li className="py-4">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <code className="rounded-md bg-raised px-2 py-0.5 font-mono text-sm text-ink ring-1 ring-line">{e.path}</code>
        <a href={e.example} className="break-all font-mono text-xs text-accent-strong underline underline-offset-2">
          {e.example}
        </a>
        {e.costly && <span className="rounded-full bg-warn/15 px-2 py-0.5 text-[11px] font-semibold text-warn">{LIMITS.expensive} a minute</span>}
      </div>
      <p className="mt-1.5 max-w-3xl text-sm text-ink-2">{e.what}</p>
      {e.params && <p className="mt-1 text-xs text-ink-3">Parameters: {e.params}</p>}
    </li>
  );
}

/** What the site's data endpoints return, and the rules for using them. */
export default function DataPage() {
  return (
    <div className="space-y-8">
      <PageHeader eyebrow="Data" title="Data and API">
        <p className="max-w-2xl">
          Everything the site shows comes from these endpoints, and they&apos;re open: no key, no sign-up. Responses are compressed JSON (or CSV
          and iCalendar files below), read-only, and refreshed as the model updates through the day.
        </p>
      </PageHeader>

      <Section title="JSON" subtitle="Plain GET requests. Leagues are nfl, nba, mlb and nhl; ids are ESPN's, the same ones in the site's addresses.">
        <ul className="divide-y divide-line">
          {JSON_ENDPOINTS.map((e) => (
            <Row key={e.path} e={e} />
          ))}
        </ul>
      </Section>

      <Section title="Spreadsheets and calendars" subtitle="Files you can open as they are.">
        <ul className="divide-y divide-line">
          {FILES.map((e) => (
            <Row key={e.path} e={e} />
          ))}
        </ul>
      </Section>

      <Section title="The rules">
        <ul className="max-w-3xl list-disc space-y-2 pl-5 text-sm text-ink-2">
          <li>
            Up to {LIMITS.api} requests a minute from one address, and {LIMITS.expensive} a minute for the calls marked so (they reach the live
            feeds). Past that you get a <code className="font-mono">429</code> with a <code className="font-mono">Retry-After</code> header;
            every response carries <code className="font-mono">RateLimit-Limit</code> and <code className="font-mono">RateLimit-Remaining</code>.
          </li>
          <li>
            For scripts, servers and spreadsheets: browsers on other sites can&apos;t call it directly (no cross-origin access), so fetch it from
            your own code and cache what you need. Forecasts change at most every few minutes.
          </li>
          <li>
            Schedules, scores, injuries and lines come from ESPN&apos;s public feeds; the forecasts and everything derived from them are ours. For
            insight and fun, not betting advice. How each number is made is on the{' '}
            <Link href="/record#methodology" className="text-accent-strong underline underline-offset-2">
              track record page
            </Link>
            .
          </li>
        </ul>
      </Section>
    </div>
  );
}
