/**
 * End-to-end checks against a running production server: every page loads
 * with its security headers and a nonce on every script, metadata sits in
 * <head>, each page has one main heading, unknown pages are real 404s, the
 * API answers and refuses what it should, and the static files and the
 * security report endpoint behave. Exits 1 on any failure.
 *
 *   npm run build && npm run start      (or npm run serve), then:
 *   npm run smoke
 *   npm run smoke -- --base=https://…
 */
const BASE = (process.argv.find((a) => a.startsWith('--base='))?.slice(7) ?? 'http://localhost:3000').replace(/\/$/, '');
const results = [];
const check = (name, ok, detail = '') => results.push({ name, ok: !!ok, detail });

const HEADERS = {
  'strict-transport-security': /^max-age=\d{8,}; includeSubDomains; preload$/,
  'x-content-type-options': /^nosniff$/,
  'x-frame-options': /^DENY$/,
  'referrer-policy': /^strict-origin-when-cross-origin$/,
  'permissions-policy': /camera=\(\)/,
  'cross-origin-opener-policy': /^same-origin$/,
  'x-permitted-cross-domain-policies': /^none$/
};

async function get(path, init) {
  const started = Date.now();
  const response = await fetch(`${BASE}${path}`, { redirect: 'manual', ...init });
  const body = await response.text();
  return { response, body, ms: Date.now() - started };
}

function headersOk(path, response) {
  for (const [name, pattern] of Object.entries(HEADERS)) check(`${path} header ${name}`, pattern.test(response.headers.get(name) ?? ''), response.headers.get(name) ?? 'missing');
  check(`${path} no x-powered-by`, !response.headers.has('x-powered-by'));
}

async function page(path, { status = 200 } = {}) {
  const { response, body, ms } = await get(path);
  check(`${path} → ${status}`, response.status === status, `got ${response.status} in ${ms} ms`);
  headersOk(path, response);
  const csp = response.headers.get('content-security-policy') ?? '';
  const nonce = csp.match(/'nonce-([^']+)'/)?.[1];
  check(`${path} CSP with nonce, no unsafe-inline scripts`, nonce && !/script-src[^;]*unsafe-inline/.test(csp), csp.slice(0, 60));
  const scripts = [...body.matchAll(/<script\b[^>]*>/g)].map((m) => m[0]);
  const unnonced = scripts.filter((s) => !s.includes(`nonce="${nonce}"`));
  check(`${path} all ${scripts.length} scripts carry the nonce`, nonce && unnonced.length === 0, unnonced[0]?.slice(0, 80) ?? '');
  const head = body.split('</head>')[0];
  check(`${path} <title> in head`, /<title>[^<]{3,}<\/title>/.test(head));
  check(`${path} meta description in head`, /<meta name="description" content="[^"]{20,}"/.test(head));
  check(`${path} html lang`, /<html[^>]* lang="en"/.test(body));
  if (status === 200) check(`${path} exactly one h1`, (body.match(/<h1\b/g) ?? []).length === 1, `${(body.match(/<h1\b/g) ?? []).length} found`);
  return body;
}

async function main() {
  // Real ids to visit, from the site's own API.
  const nba = await get('/api/predictions?league=nba');
  check('/api/predictions?league=nba → 200 JSON', nba.response.status === 200 && nba.response.headers.get('content-type')?.includes('json'));
  check('/api/* rate-limit headers', nba.response.headers.has('ratelimit-limit') && nba.response.headers.has('ratelimit-remaining'));
  check('/api/* same-origin resource policy', nba.response.headers.get('cross-origin-resource-policy') === 'same-origin');
  const game = JSON.parse(nba.body).leagues?.[0]?.predictions?.[0];

  for (const path of ['/', '/live', '/nfl', '/nba', '/mlb', '/nhl', '/props?league=nfl', '/parlay', '/record', '/matchup', '/results', '/picks', '/plans', '/data', '/privacy', '/feedback', '/nba/players', '/nfl/players', '/nba/player/3112335', '/nfl/team/6']) {
    await page(path);
  }
  if (game) {
    const body = await page(`/nba/game/${game.id}`);
    const ld = [...body.matchAll(/<script type="application\/ld\+json"[^>]*>([^<]*)<\/script>/g)].map((m) => {
      try {
        return JSON.parse(m[1]);
      } catch {
        return null;
      }
    });
    check('game page JSON-LD SportsEvent', ld.some((d) => d?.['@type'] === 'SportsEvent' && d.homeTeam && d.startDate));
    check('site JSON-LD WebSite', ld.some((d) => d?.['@graph']?.some((n) => n['@type'] === 'WebSite')));
  }
  const teamImage = await fetch(`${BASE}/nba/team/7/opengraph-image`);
  const teamBytes = (await teamImage.arrayBuffer()).byteLength;
  check('team share image renders', teamImage.status === 200 && teamImage.headers.get('content-type') === 'image/png' && teamBytes > 10_000, `${teamImage.status} ${teamBytes} bytes`);
  // Teams and players carry structured data too.
  for (const [path, type] of [['/nba/team/7', 'SportsTeam'], ['/nba/player/3112335', 'Person']]) {
    const { body } = await get(path);
    const found = [...body.matchAll(/<script type="application\/ld\+json"[^>]*>([^<]*)<\/script>/g)].some((m) => {
      try {
        return JSON.parse(m[1])['@type'] === type;
      } catch {
        return false;
      }
    });
    check(`${path} JSON-LD ${type}`, found);
  }
  // Records against the line, schedule strength, closing line value and hit rates, where there's data for them.
  {
    const team = (await get('/nba/team/7')).body;
    check('team page shows its record against the line', team.includes('Against the line') && /Against the spread/.test(team));
    check('team page rates the coming schedule', !team.includes('Forecasts for their next games') || /opponents average \d+ Elo/.test(team.replace(/<!-- -->/g, '')));
    const record = (await get('/record')).body;
    check('record page reports closing line value', record.includes('Closing line value'));
    check("record page runs the head-to-head against ESPN's forecasts", record.includes("Against ESPN&#x27;s forecasts") || record.includes("Against ESPN's forecasts"));
    const props = (await get('/props?league=nba')).body;
    // The finder (and its table) only renders when lines are posted.
    check('props board counts hit rates when it has lines', !props.includes('id="prop-search"') || props.includes('>L10<'));
    check('props board shows how its chances held up', props.includes('Do these chances hold up?'));
    if (game) {
      const gamePage = (await get(`/nba/game/${game.id}`)).body;
      check('game page compares both teams against the line', gamePage.includes('Against the line'));
      check('a coming game says in plain words why its forecast is what it is', game.state !== 'pre' || (gamePage.includes('The short version') && /(forecast follows it|No betting line is up yet)/.test(gamePage)));
      const leagueStats = (await get('/nba')).body;
      const hockey = (await get('/nhl')).body;
      const compare = (await get('/nba/compare?a=3112335&b=3059318')).body;
      check('player comparison lines two players up stat by stat', /vs Joel Embiid: stats and props compared/.test(compare) && compare.includes('Last 10') && compare.includes('Over the line'));
      check('player comparison charts their last games, with a table too', compare.includes('Last 10 games') && compare.includes('See every game as a table') && compare.includes('aria-label="Stat to chart"'));
      check('player comparison picker loads without players', (await get('/nba/compare')).body.includes('Second player'));
      check('player comparison keeps a chosen player and offers someone comparable', /a=3112335&amp;b=\d+/.test((await get('/nba/compare?a=3112335')).body));
      check('game page links its matchup to the machine', /\/matchup\?league=nba&amp;a=\d+&amp;b=\d+&amp;venue=(b|neutral)/.test(gamePage));
      check('team page links to the machine with the team set', team.includes('/matchup?league=nba&amp;a=7'));
      check('team page gives its numbers with league ranks', team.includes('By the numbers') && team.includes('Points scored') && team.includes('On the road'));
      check('league page has the sortable team stats table', leagueStats.includes('id="team-stats"') && leagueStats.includes('aria-sort="descending"'));
      check('team stats offer the box-score numbers', leagueStats.includes('>Efficiency<') && hockey.includes('>Shots<'));
      check('the tale of the tape ranks offense and defense per possession', gamePage.includes('Offense rating') && gamePage.includes('Defense rating'));
      check('hockey says how its records treat overtime losses', hockey.includes('Overtime and shootout losses count as losses'));
      for (const id of ['nfl', 'nba', 'nhl']) {
        const machine = (await get(`/${id}/playoffs`)).body;
        check(`${id} playoff machine lists games to pick and the standings`, machine.includes('Pick your winners') && machine.includes('aria-pressed') && machine.includes('Playoffs'));
      }
      check('playoff machine reads a shared scenario and a team from the address', (await get('/nfl/playoffs?team=2')).body.includes('Win out'));
      const offseason = await get('/mlb/playoffs');
      check('playoff machine answers in the offseason, picks or none', offseason.response.status === 200 && (offseason.body.includes('nothing to pick') || offseason.body.includes('Pick your winners')));
      const fantasy = await get('/nfl/fantasy');
      check('fantasy rankings list players with their record behind them', fantasy.response.status === 200 && fantasy.body.includes('Fantasy rankings') && (fantasy.body.includes('How much to trust this') || fantasy.body.includes('No NFL games on the board')));
      check('fantasy rankings are football only', (await get('/nba/fantasy')).response.status === 404);
      for (const id of ['nba', 'nfl', 'mlb', 'nhl']) {
        const injuries = await get(`/${id}/injuries`);
        check(`${id} injury report loads`, injuries.response.status === 200 && injuries.body.includes(`${id.toUpperCase()} injury report`));
        const standings = await get(`/${id}/standings`);
        check(`${id} standings load`, standings.response.status === 200 && standings.body.includes(`${id.toUpperCase()} standings`));
      }
      check('player page has his splits', (await get('/nba/player/3112335')).body.includes('On the road'));
      for (const id of ['nba', 'nfl', 'nhl']) {
        const players = (await get(`/${id}/players`)).body;
        check(`${id} players page has stat leaders`, players.includes('Stat leaders') && players.includes('Compare top two'));
      }
      const reversed = (await get('/nba/compare?a=3059318&b=3112335')).body;
      const canonical = (html) => html.match(/<link rel="canonical" href="([^"]+)"/)?.[1];
      check('either order of a comparison has one canonical address', !!canonical(compare) && canonical(compare) === canonical(reversed));
      // A link naming one team must not put that team on both sides, even for the league's best.
      const best = JSON.parse((await get('/api/rankings?league=nba')).body).leagues?.[0]?.rankings?.[0]?.team?.id;
      check('matchup machine never fills the other side with the same team', !!best && !(await get(`/matchup?league=nba&a=${best}`)).body.includes('Pick two different teams'));
      const matchup = (await get('/matchup?league=nba&venue=b')).body;
      check('matchup machine has the tale of the tape, turned to the venue', matchup.includes('Tale of the tape') && matchup.includes('Road vs home'));
      check('game page has the tale of the tape with league ranks', gamePage.includes('Tale of the tape') && /Points scored/.test(gamePage) && /\d+(st|nd|rd|th)<span class="sr-only"> of <!-- -->\d+/.test(gamePage));
    }
  }
  // A shared pick'em record: its page (kept out of search) and preview image.
  {
    const picks = await page('/picks/s/12-8-11-9');
    check('shared pick’em record shows both sides, noindex', picks.includes('The model') && /<meta name="robots" content="noindex"/.test(picks));
    const image = await fetch(`${BASE}/picks/s/12-8-11-9/opengraph-image`);
    const bytes = (await image.arrayBuffer()).byteLength;
    check('shared pick’em image renders', image.status === 200 && image.headers.get('content-type') === 'image/png' && bytes > 10_000, `${image.status} ${bytes} bytes`);
  }
  const share = await page('/parlay/s/w~nfl~1~1');
  check('shared parlay is noindex', /<meta name="robots" content="noindex"/.test(share));

  // Addresses the site can't have: a whole not-found page, rendered on the server, with a 404.
  for (const path of ['/zzz', '/wp-admin', '/nba/player/abc', '/xyz/team/1', '/nba/game/1/extra']) {
    const body = await page(path, { status: 404 });
    check(`${path} not-found page rendered on the server`, body.includes('Nothing in this crypt') && /<meta name="robots" content="noindex"/.test(body));
  }
  // Addresses with a dot in them go through the same checks (they used to slip past the proxy).
  for (const path of ['/live.php', '/.env', '/wp-login.php', '/nba/game/1.json']) {
    const body = await page(path, { status: 404 });
    check(`${path} not-found page rendered on the server`, body.includes('Nothing in this crypt'));
  }
  // API addresses that don't exist: a JSON 404, never the HTML app.
  for (const path of ['/api/nope', '/api/predictions/extra', '/api/.env']) {
    const { response, body } = await get(path);
    let parsed = null;
    try {
      parsed = JSON.parse(body);
    } catch {}
    check(`${path} → JSON 404`, response.status === 404 && /json/.test(response.headers.get('content-type') ?? '') && typeof parsed?.error === 'string', `got ${response.status} ${response.headers.get('content-type')}`);
    check(`${path} 404 not kept`, response.headers.get('cache-control') === 'no-store');
  }
  for (const path of ['/api/predictions?league=nba', '/api/rankings?league=nba', '/api/record?league=nba', '/api/cards?ids=nba:1', '/api/health']) {
    const { response } = await get(path);
    check(`${path} says how long to keep it`, /^(public, max-age=\d+|no-store)$/.test(response.headers.get('cache-control') ?? ''), response.headers.get('cache-control') ?? 'missing');
  }
  // UFC: the section, and an event, a fight and a fighter from it.
  {
    const ufc = await page('/ufc');
    check('UFC page shows a card with chances', /UFC/.test(ufc) && />\d{1,2}%</.test(ufc) && ufc.includes('/ufc/fight/'));
    check('UFC page says where its chances come from', ufc.includes('the market') && ufc.includes('How the forecasts have done'));
    const eventId = ufc.match(/href="\/ufc\/event\/(\d+)"/)?.[1];
    const fightId = ufc.match(/href="\/ufc\/fight\/(\d+)"/)?.[1];
    const fighterId = ufc.match(/href="\/ufc\/fighter\/(\d+)"/)?.[1];
    check('UFC page links an event, a fight and a fighter', eventId && fightId && fighterId, `${eventId} ${fightId} ${fighterId}`);
    if (eventId) check('UFC event page lists its fights', (await page(`/ufc/event/${eventId}`)).includes('/ufc/fight/'));
    if (fightId) {
      const fight = await page(`/ufc/fight/${fightId}`);
      check('UFC fight page has the tale of the tape', fight.includes('Tale of the tape') && /"@type":"SportsEvent"/.test(fight));
    }
    if (fighterId) check('UFC fighter page has the fight history', (await page(`/ufc/fighter/${fighterId}`)).includes('UFC record'));
    // A well-formed id nothing matches: a 404, drawn once the page's scripts run (like an unknown game).
    for (const path of ['/ufc/fight/999999999999', '/ufc/fighter/999999999999', '/ufc/event/999999999999']) check(`${path} → 404`, (await get(path)).response.status === 404);
  }
  // Feedback: refusals only, so a run against the live site never leaves a message behind (the trap answers
  // "ok" and keeps nothing).
  {
    const send = (body, type = 'application/json') => get('/api/feedback', { method: 'POST', headers: { 'content-type': type }, body });
    const good = { kind: 'idea', message: 'Smoke test', page: '/nba', website: '', elapsedMs: 5_000 };
    check('feedback refuses anything but JSON', (await send('message=hi', 'application/x-www-form-urlencoded')).response.status === 415);
    check('feedback refuses broken JSON', (await send('{')).response.status === 400);
    const empty = await send(JSON.stringify({ ...good, message: ' ' }));
    check('feedback refuses an empty message, saying why', empty.response.status === 422 && /few words/.test(JSON.parse(empty.body).error ?? ''));
    check('feedback refuses a form sent instantly', (await send(JSON.stringify({ ...good, elapsedMs: 10 }))).response.status === 422);
    check('feedback trap answers ok', (await send(JSON.stringify({ ...good, website: 'spam' }))).response.status === 201);
    check('feedback not taken by GET', (await get('/api/feedback')).response.status === 405);
    const form = (await get('/feedback?from=/nba/game/401909960')).body;
    const shown = (body) => body.replace(/<!-- -->/g, '').match(/Sent along with it: you came from ([^,<]*)/)?.[1] ?? null;
    check('feedback page notes where it was opened', shown(form) === '/nba/game/401909960', shown(form) ?? 'nothing');
    // (The address itself is in Next.js's own router data either way; what matters is it's never taken as the page.)
    check('feedback page ignores a page that isn’t ours', shown((await get('/feedback?from=https://evil.example/')).body) === null);
    check('feedback page is noindex', /<meta name="robots" content="noindex/.test(form));
  }
  // Pages are only read: other methods are refused before the app runs.
  for (const method of ['POST', 'PUT', 'DELETE']) {
    const { response } = await get('/', { method, body: method === 'DELETE' ? undefined : 'x' });
    check(`${method} / → 405`, response.status === 405 && response.headers.get('allow') === 'GET, HEAD', `got ${response.status}`);
  }
  // A body streamed in without a declared length is cut off at the cap, not read whole.
  const huge = new ReadableStream({
    pull(controller) {
      controller.enqueue(new Uint8Array(64 * 1024).fill(97));
      if (++huge.sent > 160) controller.close();
    }
  });
  huge.sent = 0;
  const streamed = await fetch(`${BASE}/api/csp-report`, { method: 'POST', headers: { 'content-type': 'application/csp-report' }, body: huge, duplex: 'half' });
  check('10 MB streamed report refused', streamed.status === 413, `got ${streamed.status}`);
  const calendar = await get('/api/calendar?teams=nba:13');
  check('calendar feed is never kept by shared caches', (calendar.response.headers.get('cache-control') ?? '').startsWith('private'));

  // Search's player list, and API answers compressed once, by Next.js (a route that compresses its own gets
  // compressed again on top since 16.4.6, under one label: unreadable).
  const players = await get('/api/players', { headers: { 'accept-encoding': 'br, gzip' } });
  let list = [];
  try {
    list = JSON.parse(players.body).players ?? [];
  } catch {}
  check('/api/players reads as JSON once decompressed', list.length > 0, players.body.slice(0, 20));
  check('/api/players lists players with pages', players.response.status === 200 && list.length > 0 && list.every((p) => p.league && /^\d+$/.test(p.id) && p.name), `${list.length} players`);
  check('/api/players compressed', players.response.headers.get('content-encoding') === 'gzip', players.response.headers.get('content-encoding') ?? 'none');
  if (list[0]) {
    const top = list[0];
    const { response, body } = await get(`/${top.league}/player/${top.id}`);
    check(`listed player ${top.name} has a page`, response.status === 200, `got ${response.status}`);
    const og = body.match(/<meta property="og:image" content="[^"]*?(\/[a-z]+\/player\/\d+\/opengraph-image[^"]*)"/)?.[1];
    check('player page names its share image', !!og);
    if (og) {
      const image = await fetch(`${BASE}${og.replace(/&amp;/g, '&')}`);
      const bytes = (await image.arrayBuffer()).byteLength;
      check('player share image renders', image.status === 200 && image.headers.get('content-type') === 'image/png' && bytes > 10_000, `${image.status} ${bytes} bytes`);
    }
  }
  if (list.length) {
    const ids = list.slice(0, 3).map((p) => `${p.league}:${p.id}`);
    const next = await get(`/api/players/next?ids=${ids.join(',')},mlb:1,junk`);
    const followed = JSON.parse(next.body).players ?? [];
    check('/api/players/next answers followed players, junk dropped', next.response.status === 200 && followed.length === 3 && followed.every((p) => p.name && Array.isArray(p.lines)), `${followed.length} players`);
  }
  // The graded games download adds up to the record it backs.
  const csv = await get('/api/graded?league=nba');
  const csvRows = csv.body.trimEnd().split('\r\n').slice(1);
  const nbaRecord = JSON.parse((await get('/api/record?league=nba')).body).leagues?.[0]?.record?.overall;
  check(
    'graded CSV matches the NBA record',
    csv.response.headers.get('content-type')?.startsWith('text/csv') && nbaRecord && csvRows.length === nbaRecord.games && csvRows.filter((r) => r.split(',')[11] === 'true').length === nbaRecord.correct,
    `${csvRows.length} rows vs ${nbaRecord?.games}`
  );
  const picksCsv = await get('/api/graded-props?league=nba');
  const pickRows = picksCsv.body.trimEnd().split('\r\n').slice(1);
  const nbaProps = JSON.parse((await get('/api/record?league=nba')).body).leagues?.[0]?.record?.propsLive;
  check(
    'prop picks CSV matches the NBA forward record',
    picksCsv.response.status === 200 && nbaProps && pickRows.filter((r) => r.endsWith(',won')).length === nbaProps.won && pickRows.filter((r) => r.endsWith(',lost')).length === nbaProps.lost,
    `${pickRows.length} rows`
  );
  check('prop picks CSV refuses a league without props', (await get('/api/graded-props?league=mlb')).response.status === 400);
  const gz = await get('/api/predictions', { headers: { 'accept-encoding': 'gzip' } });
  check('/api/predictions gzip-compressed', gz.response.headers.get('content-encoding') === 'gzip' && /accept-encoding/i.test(gz.response.headers.get('vary') ?? ''));
  const raw = await get('/api/predictions', { headers: { 'accept-encoding': 'identity' } });
  check('/api/predictions plain when nothing is accepted', !raw.response.headers.has('content-encoding') && JSON.parse(raw.body).leagues?.length === 4);

  // Well-formed ids nothing matches: Next answers 404 and draws the page once its scripts run.
  for (const path of ['/nba/game/999999999999', '/nba/team/999999']) {
    const { response } = await get(path);
    check(`${path} → 404`, response.status === 404, `got ${response.status}`);
  }

  const health = await get('/api/health');
  check('/api/health ok', health.response.status === 200 && JSON.parse(health.body).ok === true);
  check('/api/live → 200 with live, soon and final', (() => {
    return get('/api/live').then(({ response, body }) => response.status === 200 && ['live', 'soon', 'final'].every((k) => Array.isArray(JSON.parse(body)[k])));
  })());
  const bad = await get('/api/predictions?league=xyz');
  check('/api/predictions bad league → 400', bad.response.status === 400);
  const post = await get('/api/predictions', { method: 'POST' });
  check('API refuses methods it has no handler for', post.response.status === 405, `got ${post.response.status}`);

  // Background alerts: the public key is served, and only JSON from the site's own pages naming a real push service is taken.
  const key = await get('/api/push/key');
  check('/api/push/key serves a public key', key.response.status === 200 && /^[A-Za-z0-9_-]{80,}$/.test(JSON.parse(key.body).publicKey ?? ''));
  const watch = (body, headers = {}) => get('/api/push/watch', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body });
  const fakeKeys = { p256dh: 'B'.repeat(87), auth: 'a'.repeat(22) };
  check('push watch refuses form posts', (await watch('{}', { 'content-type': 'text/plain' })).response.status === 415);
  check('push watch refuses other sites', (await watch('{}', { origin: 'https://evil.example' })).response.status === 415);
  check('push watch refuses addresses that aren’t push services', (await watch(JSON.stringify({ subscription: { endpoint: 'https://169.254.169.254/latest', keys: fakeKeys } }))).response.status === 422);
  check('push watch refuses oversize bodies', (await watch(JSON.stringify({ pad: 'x'.repeat(40_000) }))).response.status === 413);
  check('push unwatch refuses non-push addresses', (await get('/api/push/unwatch', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ endpoint: 'http://localhost/x' }) })).response.status === 422);

  const report = (body, type = 'application/csp-report') => get('/api/csp-report', { method: 'POST', headers: { 'content-type': type }, body });
  check('CSP report accepted', (await report(JSON.stringify({ 'csp-report': { 'document-uri': `${BASE}/smoke?x=1`, 'effective-directive': 'script-src-elem', 'blocked-uri': 'https://evil.example/x.js' } }))).response.status === 204);
  check('CSP report wrong type → 415', (await report('{}', 'text/plain')).response.status === 415);
  check('CSP report oversize → 413', (await report(JSON.stringify({ 'csp-report': { pad: 'x'.repeat(20_000) } }))).response.status === 413);

  for (const path of ['/robots.txt', '/sitemap.xml', '/manifest.webmanifest', '/icon', '/brand-icon/192']) {
    const { response } = await get(path);
    check(`${path} → 200`, response.status === 200, `got ${response.status}`);
  }
  const sitemap = await get('/sitemap.xml');
  const urls = [...sitemap.body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  check('sitemap lists teams, players and upcoming games', urls.some((u) => /\/team\/\d+$/.test(u)) && urls.some((u) => /\/player\/\d+$/.test(u)) && urls.some((u) => /\/game\/\d+$/.test(u)), `${urls.length} urls`);
  check('sitemap rate-limited like a page', sitemap.response.headers.has('ratelimit-remaining'));
  const sw = await get('/sw.js');
  check('/sw.js checked fresh on every visit', /^(no-cache|public, max-age=0, must-revalidate)$/.test(sw.response.headers.get('cache-control') ?? ''));
  for (const size of [360, 720]) {
    const signature = await fetch(`${BASE}/signature-${size}.webp`);
    check(`signature image ${size} is served, typed and hardened`, signature.status === 200 && signature.headers.get('content-type') === 'image/webp' && signature.headers.get('x-content-type-options') === 'nosniff' && signature.headers.get('cache-control') === 'public, max-age=86400');
  }
  check('only the real signature sizes are files', (await fetch(`${BASE}/signature-999.webp`)).status === 404);
  for (const name of ['wide-dark', 'wide-light', 'tall-dark', 'tall-light']) {
    const backdrop = await fetch(`${BASE}/backdrop-${name}.webp`);
    check(`backdrop ${name} is served, typed and hardened`, backdrop.status === 200 && backdrop.headers.get('content-type') === 'image/webp' && backdrop.headers.get('x-content-type-options') === 'nosniff' && backdrop.headers.get('cache-control') === 'public, max-age=86400');
  }
  check('only the real backdrops are files', (await fetch(`${BASE}/backdrop-wide-blue.webp`)).status === 404);
  // Plans stays reachable but hidden until billing exists; privacy is linked from every page.
  const front = await get('/');
  check('plans page not linked from the site', !front.body.includes('href="/plans"'));
  check('privacy page linked from every page', front.body.includes('href="/privacy"'));
  check('plans page kept out of search engines', /<meta name="robots" content="noindex/.test((await get('/plans')).body));
  const map = await (await fetch(`${BASE}/sitemap.xml`)).text();
  check('sitemap lists the privacy page and not the plans page', map.includes('/privacy</loc>') && !map.includes('/plans</loc>'));
  const offline = await get('/offline.html');
  check('/offline.html locked-down CSP', (offline.response.headers.get('content-security-policy') ?? '').startsWith("default-src 'none'"));
  // Whether the server has a contact set is its own business (this machine's settings say nothing about it):
  // either nothing is published, or a well-formed file is (RFC 9116: a Contact and an Expires line).
  const securityTxt = await get('/.well-known/security.txt');
  check(
    'security.txt absent, or well-formed with a contact',
    securityTxt.response.status === 404 || (securityTxt.response.status === 200 && /^Contact: (mailto|https):/m.test(securityTxt.body) && /^Expires: \d{4}-/m.test(securityTxt.body))
  );

  const settled = await Promise.all(results.map(async (r) => ({ ...r, ok: await r.ok })));
  const failed = settled.filter((r) => !r.ok);
  for (const r of failed) console.log(`FAIL  ${r.name}${r.detail ? `  (${r.detail})` : ''}`);
  console.log(`${settled.length - failed.length}/${settled.length} checks passed against ${BASE}`);
  if (failed.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
