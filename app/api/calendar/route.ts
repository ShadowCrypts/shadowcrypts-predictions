import { isLeagueId, LeagueId, LEAGUES } from '../../../lib/leagues';
import { getLeagueModel } from '../../../lib/model';
import { BRAND } from '../../../lib/brand';
import { pct } from '../../../lib/format';
import { send } from '../../../lib/http';

export const dynamic = 'force-dynamic';

// Typical length of a game, for the calendar block.
const HOURS: Record<LeagueId, number> = { nfl: 3.25, nba: 2.5, nhl: 2.5, mlb: 3 };
const PAST_DAYS = 14;

const stamp = (date: Date) => date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
// Every character with meaning in iCalendar text is escaped, line breaks of any kind included, so no value can
// start a property of its own.
const escape = (text: string) => text.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r\n|\r|\n/g, '\\n');

/** Lines over 75 octets are folded with a leading space, as the iCalendar spec requires (counted in bytes, so accents are safe). */
function fold(line: string) {
  const parts: string[] = [];
  let current = '';
  let bytes = 0;
  for (const char of line) {
    const size = Buffer.byteLength(char);
    // The first line may hold 75 octets; continuation lines lose one to the leading space.
    if (bytes + size > (parts.length ? 74 : 75)) {
      parts.push(current);
      current = '';
      bytes = 0;
    }
    current += char;
    bytes += size;
  }
  parts.push(current);
  return parts.join('\r\n ');
}

/**
 * GET /api/calendar?teams=nba:2,nfl:21 — an iCalendar feed of those teams'
 * games with the forecast in each event. Subscribe once and the calendar app
 * re-checks it, so new forecasts and final scores flow in.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const teams = (url.searchParams.get('teams') ?? '')
    .split(',')
    .map((s) => s.trim().split(':'))
    .filter((p): p is [LeagueId, string] => p.length === 2 && isLeagueId(p[0]) && /^\d+$/.test(p[1]))
    .slice(0, 30);
  if (!teams.length) return new Response('Add ?teams=league:teamId, e.g. ?teams=nba:2', { status: 400 });

  const origin = (process.env.SITE_URL ?? url.origin).replace(/\/$/, '');
  const leagues = [...new Set(teams.map(([l]) => l))];
  const models = new Map(await Promise.all(leagues.map(async (id) => [id, await getLeagueModel(id)] as const)));
  const since = Date.now() - PAST_DAYS * 86_400_000;
  const seen = new Set<string>();
  const names: string[] = [];
  const events: string[] = [];
  const now = stamp(new Date());

  for (const [league, teamId] of teams) {
    const model = models.get(league)!;
    const team = model.teams[teamId];
    if (!team) continue;
    names.push(team.shortName);
    for (const id of model.teamGames[teamId] ?? []) {
      const p = model.predictions[id];
      if (!p || Date.parse(p.game.date) < since || seen.has(`${league}:${id}`)) continue;
      seen.add(`${league}:${id}`);
      const { game } = p;
      const pickSide = p.pick === 'home' ? game.home : game.away;
      const start = new Date(game.date);
      const end = new Date(start.getTime() + HOURS[league] * 3_600_000);
      const final = game.completed && game.home.score !== null && game.away.score !== null;
      const summary = final
        ? `${game.away.abbr} ${game.away.score} @ ${game.home.abbr} ${game.home.score} (forecast ${p.correct ? 'hit' : 'missed'})`
        : `${game.away.abbr} @ ${game.home.abbr} · ${pickSide.abbr} ${pct(p.pickProb)}`;
      const description = [
        `${LEAGUES[league].name}: ${game.away.name} at ${game.home.name}`,
        `Forecast: ${pickSide.name} ${pct(p.pickProb)} (${p.band})`,
        p.market ? `Betting line on file: ${p.market.details ?? 'posted'}` : 'No betting line yet',
        game.broadcast ? `TV: ${game.broadcast}` : null,
        `${origin}/${league}/game/${game.id}`
      ]
        .filter(Boolean)
        .join('\n');
      events.push(
        [
          'BEGIN:VEVENT',
          `UID:${league}-${game.id}@shadowcrypts`,
          `DTSTAMP:${now}`,
          `DTSTART:${stamp(start)}`,
          `DTEND:${stamp(end)}`,
          `SUMMARY:${escape(summary)}`,
          `DESCRIPTION:${escape(description)}`,
          game.venue ? `LOCATION:${escape(game.venue)}` : null,
          `URL:${origin}/${league}/game/${game.id}`,
          'END:VEVENT'
        ]
          .filter((l): l is string => l !== null)
          .map(fold)
          .join('\r\n')
      );
    }
  }

  const body = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:-//${BRAND.name}//Forecasts//EN`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    fold(`X-WR-CALNAME:${escape(`${BRAND.shortName}: ${names.join(', ') || 'your teams'}`)}`),
    fold('X-WR-CALDESC:Game times with ShadowCrypts forecasts. Updates as forecasts and scores change.'),
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
    'X-PUBLISHED-TTL:PT1H',
    ...events,
    'END:VCALENDAR'
  ].join('\r\n');

  return send(request, body + '\r\n', {
    headers: {
      'content-type': 'text/calendar; charset=utf-8',
      'content-disposition': 'inline; filename="shadowcrypts.ics"',
      // Links in it are built from the request when SITE_URL isn't set, so no shared cache may keep it.
      'cache-control': 'private, max-age=900'
    }
  });
}
