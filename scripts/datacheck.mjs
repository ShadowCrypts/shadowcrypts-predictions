/**
 * Checks the numbers themselves, where the smoke test checks that pages load:
 * the site's figures against ESPN's own (standings, scores, the schedule, stat
 * leaders, player game logs), and arithmetic that has to hold whatever the
 * source (a forecast's factors add up to it, playoff odds add up to the number
 * of playoff spots, a graded record recounts). Exits 1 on any disagreement.
 *
 *   npm run build && npm run start      (or npm run serve), then:
 *   npm run datacheck
 *   npm run datacheck -- --base=https://… --only=nba
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
const BASE = (arg('base') ?? 'http://localhost:3000').replace(/\/$/, '');
const ONLY = arg('only');
const ESPN = 'https://site.api.espn.com/apis';
const GAMELOG = 'https://site.web.api.espn.com/apis/common/v3/sports';
const PATHS = { nba: 'basketball/nba', nfl: 'football/nfl', nhl: 'hockey/nhl', mlb: 'baseball/mlb' };
const LEAGUES = Object.keys(PATHS).filter((id) => !ONLY || id === ONLY);
/** Playoff teams per league, for the season simulation's odds to add up to. */
const PLAYOFF_SPOTS = { nba: 16, nfl: 14, nhl: 16, mlb: 12 };
const DIVISIONS = { nfl: 8, nhl: 4, mlb: 6 };
/** A game this recent may not have reached the model yet. */
const SETTLING_MS = 6 * 3_600_000;
/** Official scorers correct stats for days: the site re-reads at 72 hours, so only compare after that. */
const STATS_SETTLED_MS = 80 * 3_600_000;

// ---- reporting

let failures = 0;
let total = 0;
function tally(name, checked, problems) {
  total += checked;
  failures += problems.length;
  const head = problems.length ? `  ✗ ${name}: ${problems.length} of ${checked} disagree` : checked ? `  ✓ ${name}: ${checked} checked` : `  · ${name}: nothing to check`;
  console.log(head);
  for (const p of problems.slice(0, 12)) console.log(`      ${p}`);
  if (problems.length > 12) console.log(`      …and ${problems.length - 12} more`);
}
const near = (a, b, within) => Math.abs(a - b) <= within;

// ---- fetching

async function json(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} from ${url}`);
  return res.json();
}
async function text(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} from ${url}`);
  return res.text();
}
async function pool(items, size, work) {
  const queue = [...items];
  await Promise.all(Array.from({ length: size }, async () => {
    while (queue.length) await work(queue.shift());
  }));
}
function parseCsv(body) {
  const rows = body.trim().split(/\r?\n/).map((line) => {
    const cells = [];
    let cell = '';
    let quoted = false;
    for (let i = 0; i < line.length; i += 1) {
      const c = line[i];
      if (quoted && c === '"' && line[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (c === '"') quoted = !quoted;
      else if (c === ',' && !quoted) {
        cells.push(cell);
        cell = '';
      } else cell += c;
    }
    return [...cells, cell];
  });
  const [head, ...rest] = rows;
  return rest.map((cells) => Object.fromEntries(head.map((h, i) => [h, cells[i] ?? ''])));
}
const clean = (html) =>
  html
    .replace(/<!-- -->/g, '')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/<svg[\s\S]*?<\/svg>/g, '');
const textOf = (html) => html.replace(/<[^>]+>/g, '').trim();

// ---- ESPN

function standingsEntries(node, out = []) {
  for (const e of node?.standings?.entries ?? []) out.push(e);
  for (const c of node?.children ?? []) standingsEntries(c, out);
  return out;
}
const stat = (entry, name) => entry.stats?.find((s) => s.name === name || s.type === name);
const statValue = (entry, name) => {
  const s = stat(entry, name);
  return s === undefined ? undefined : Number(s.value ?? s.displayValue);
};
/** "12-3-2, 26 PTS" -> [12, 3, 2]. */
const recordOf = (display) => (display ?? '').split(',')[0].split(/[-–]/).map(Number);
/** Wins and everything else: hockey's overtime losses are losses here. */
const winsLosses = (parts, league) => (league === 'nfl' ? { w: parts[0], l: parts[1], t: parts[2] ?? 0 } : { w: parts[0], l: (parts[1] ?? 0) + (parts[2] ?? 0), t: 0 });
const sameRecord = (a, b) => a.w === b.w && a.l === b.l && a.t === b.t;
const show = (r) => `${r.w}-${r.l}${r.t ? `-${r.t}` : ''}`;

/** Every event in the months of the season so far, from ESPN's scoreboard, by id. */
async function seasonEvents(league, now) {
  const months = [];
  const start = league === 'mlb' ? new Date(Date.UTC(now.getUTCFullYear(), 2, 1)) : new Date(Date.UTC(now.getUTCMonth() < 6 ? now.getUTCFullYear() - 1 : now.getUTCFullYear(), 8, 1));
  for (let d = start; d <= now; d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1))) {
    months.push(`${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
  }
  // Next month too when near the end of this one, for the schedule check.
  const ahead = new Date(now.getTime() + 8 * 86_400_000);
  const aheadMonth = `${ahead.getUTCFullYear()}${String(ahead.getUTCMonth() + 1).padStart(2, '0')}`;
  if (!months.includes(aheadMonth)) months.push(aheadMonth);
  const events = new Map();
  for (const month of months) {
    const board = await json(`${ESPN}/site/v2/sports/${PATHS[league]}/scoreboard?dates=${month}&limit=1000`);
    for (const e of board.events ?? []) {
      const c = e.competitions?.[0];
      const side = (where) => c?.competitors?.find((x) => x.homeAway === where);
      const home = side('home');
      const away = side('away');
      if (!home || !away) continue;
      events.set(String(e.id), {
        id: String(e.id),
        date: e.date,
        year: e.season?.year,
        type: e.season?.type,
        neutral: !!c.neutralSite,
        completed: !!e.status?.type?.completed,
        state: e.status?.type?.state,
        home: { id: String(home.team?.id), abbr: home.team?.abbreviation, score: Number(home.score) },
        away: { id: String(away.team?.id), abbr: away.team?.abbreviation, score: Number(away.score) }
      });
    }
  }
  return events;
}

/** Home, road and last-ten records from the games themselves, neutral sites in neither of the first two. */
function recordsFromEvents(events, seasonYear) {
  const out = new Map();
  const of = (id) => out.get(id) ?? out.set(id, { home: { w: 0, l: 0, t: 0 }, road: { w: 0, l: 0, t: 0 }, played: [], neutral: 0 }).get(id);
  const add = (split, us, them) => {
    if (us > them) split.w += 1;
    else if (us < them) split.l += 1;
    else split.t += 1;
  };
  const games = [...events.values()].filter((e) => e.year === seasonYear && e.type === 2 && e.completed).sort((a, b) => a.date.localeCompare(b.date));
  for (const e of games) {
    const h = of(e.home.id);
    const a = of(e.away.id);
    if (e.neutral) {
      h.neutral += 1;
      a.neutral += 1;
    } else {
      add(h.home, e.home.score, e.away.score);
      add(a.road, e.away.score, e.home.score);
    }
    h.played.push([e.home.score, e.away.score]);
    a.played.push([e.away.score, e.home.score]);
  }
  return out;
}

// ---- the site's team stats table, as rendered

function teamStatsTable(html) {
  const at = html.indexOf('id="team-stats"');
  if (at < 0) return null;
  const section = html.slice(at, html.indexOf('</table>', at));
  const when = textOf(section.slice(section.indexOf('<p'), section.indexOf('</p>') + 4));
  const heads = [...section.slice(section.indexOf('<thead'), section.indexOf('</thead>')).matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)].map((m) => textOf(m[1]));
  const rows = [...section.slice(section.indexOf('<tbody')).matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map((m) => {
    const id = m[1].match(/\/team\/(\d+)/)?.[1];
    const cells = [...m[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) => textOf(c[1]));
    return { id, cells: Object.fromEntries(heads.map((h, i) => [h, cells[i]])) };
  });
  return { when, rows };
}
const parseSplit = (s) => {
  if (!s || s === '—') return null;
  const [w, l, t = 0] = s.split('–').map(Number);
  return { w, l, t };
};

// ---- checks

async function checkTeams(league, seasonYear, rankings, events) {
  const standings = standingsEntries(await json(`${ESPN}/v2/sports/${PATHS[league]}/standings`));
  const byId = new Map(standings.map((e) => [String(e.team?.id), e]));
  const live = [...events.values()].some((e) => e.state === 'in');

  const records = [];
  for (const r of rankings) {
    const e = byId.get(String(r.team.id));
    const espn = stat(e ?? {}, 'overall')?.displayValue?.split(',')[0];
    if (!espn) records.push(`${r.team.abbr}: not in ESPN's standings`);
    else if (r.record !== espn) records.push(`${r.team.abbr}: site ${r.record}, ESPN ${espn}`);
  }
  tally(`records on the rankings match ESPN's standings${live ? ' (games on now can run ahead of either)' : ''}`, rankings.length, records);

  const table = teamStatsTable(clean(await text(`${BASE}/${league}`)));
  if (!table) return tally('team stats table', 0, []);
  if (!table.when.startsWith('This season')) {
    console.log(`  · team stats show last season until every team has played a few: "${table.when.slice(0, 50)}…"; not compared with this season's standings`);
    return;
  }
  const ours = recordsFromEvents(events, seasonYear);
  const scoring = [];
  const splits = [];
  const recent = [];
  let recentChecked = 0;
  let espnSplits = 0;
  const espnSplitProblems = [];
  for (const row of table.rows) {
    const e = byId.get(row.id);
    const abbr = rankings.find((r) => r.team.id === row.id)?.team.abbr ?? row.id;
    if (!e) continue;
    const overall = recordOf(stat(e, 'overall')?.displayValue);
    const games = overall.reduce((s, v) => s + (v || 0), 0);
    const pf = statValue(e, 'pointsFor');
    const pa = statValue(e, 'pointsAgainst');
    if (games && pf !== undefined && pa !== undefined) {
      if (!near(Number(row.cells.Scored), pf / games, 0.051)) scoring.push(`${abbr} scored: site ${row.cells.Scored}, ESPN ${(pf / games).toFixed(2)} (${pf} in ${games})`);
      if (!near(Number(row.cells.Allowed), pa / games, 0.051)) scoring.push(`${abbr} allowed: site ${row.cells.Allowed}, ESPN ${(pa / games).toFixed(2)} (${pa} in ${games})`);
    }
    const expected = ours.get(row.id);
    if (!expected) continue;
    const zero = { w: 0, l: 0, t: 0 };
    for (const [label, key] of [['Home', 'home'], ['Road', 'road']]) {
      const site = parseSplit(row.cells[label]) ?? zero;
      if (!sameRecord(site, expected[key])) splits.push(`${abbr} ${label}: site ${show(site)}, ESPN's games ${show(expected[key])}`);
      // ESPN's own column counts neutral games for the listed home team, so it only lines up without any.
      if (!expected.neutral) {
        espnSplits += 1;
        const published = winsLosses(recordOf(stat(e, label)?.displayValue), league);
        if (!sameRecord(published, expected[key])) espnSplitProblems.push(`${abbr} ${label}: ESPN's standings ${show(published)}, ESPN's games ${show(expected[key])}`);
      }
    }
    if (row.cells['Last 10'] && row.cells['Last 10'] !== '—') {
      recentChecked += 1;
      const site = parseSplit(row.cells['Last 10']);
      const last = expected.played.slice(-10);
      const counted = { w: last.filter(([u, t]) => u > t).length, l: last.filter(([u, t]) => u < t).length, t: last.filter(([u, t]) => u === t).length };
      if (!sameRecord(site, counted)) recent.push(`${abbr}: site ${show(site)}, ESPN's games ${show(counted)}`);
    }
  }
  tally('points scored and allowed a game match ESPN', table.rows.length * 2, scoring);
  tally("home and road records match ESPN's games (neutral sites in neither)", table.rows.length * 2, splits);
  tally("ESPN's own home and road columns agree with its games (checks this checker)", espnSplits, espnSplitProblems);
  tally("last-10 records match ESPN's games", recentChecked, recent);
}

async function checkGames(league, allEvents, graded, predictions, now, rankings) {
  // League teams only: all-star games and exhibitions aren't forecast.
  const teams = new Set(rankings.map((r) => String(r.team.id)));
  const events = new Map([...allEvents].filter(([, e]) => teams.has(e.home.id) && teams.has(e.away.id)));
  const mine = new Map(graded.map((r) => [r.game_id, r]));
  const wrong = [];
  let checked = 0;
  for (const row of graded) {
    const e = events.get(row.game_id);
    if (!e) continue;
    checked += 1;
    if (row.home !== e.home.abbr || row.away !== e.away.abbr) wrong.push(`${row.game_id}: site ${row.away} @ ${row.home}, ESPN ${e.away.abbr} @ ${e.home.abbr}`);
    else if (Number(row.home_score) !== e.home.score || Number(row.away_score) !== e.away.score) wrong.push(`${row.game_id} ${row.away} @ ${row.home}: site ${row.away_score}-${row.home_score}, ESPN ${e.away.score}-${e.home.score}`);
  }
  tally("final scores match ESPN's", checked, wrong);

  const missing = [...events.values()].filter((e) => {
    const old = now.getTime() - Date.parse(e.date) > SETTLING_MS;
    return e.completed && old && (e.type === 2 || e.type === 3) && e.home.score !== e.away.score && !mine.has(e.id);
  });
  const countable = [...events.values()].filter((e) => e.completed && (e.type === 2 || e.type === 3)).length;
  tally('every finished ESPN game is graded', countable, missing.map((e) => `${e.id} ${e.away.abbr} @ ${e.home.abbr} ${e.date}: finished, not in the graded file`));

  const schedule = [];
  let onSchedule = 0;
  for (const p of predictions) {
    if (p.state !== 'pre') continue;
    const e = events.get(p.id);
    if (!e) continue;
    onSchedule += 1;
    if (p.home.abbr !== e.home.abbr || p.away.abbr !== e.away.abbr) schedule.push(`${p.id}: site ${p.away.abbr} @ ${p.home.abbr}, ESPN ${e.away.abbr} @ ${e.home.abbr}`);
    // ESPN writes "…T00:00Z"; the site keeps the same text, so compare the instant.
    if (Date.parse(p.start) !== Date.parse(e.date)) schedule.push(`${p.id} ${p.away.abbr} @ ${p.home.abbr}: site ${p.start}, ESPN ${e.date}`);
    if (e.state !== 'pre' && now.getTime() - Date.parse(e.date) > SETTLING_MS) schedule.push(`${p.id} ${p.away.abbr} @ ${p.home.abbr}: site says upcoming, ESPN says ${e.state}`);
    if (p.neutralSite !== e.neutral) schedule.push(`${p.id} ${p.away.abbr} @ ${p.home.abbr}: neutral site, site ${p.neutralSite}, ESPN ${e.neutral}`);
  }
  tally("coming games match ESPN's schedule (teams, start, site)", onSchedule, schedule);

  const onSlate = new Set(predictions.map((p) => p.id));
  const horizon = Math.max(0, ...predictions.map((p) => Date.parse(p.start)));
  const absent = [...events.values()].filter((e) => e.state === 'pre' && (e.type === 2 || e.type === 3) && Date.parse(e.date) < horizon && !onSlate.has(e.id));
  tally('no coming ESPN game is missing from the site', onSchedule, absent.map((e) => `${e.id} ${e.away.abbr} @ ${e.home.abbr} ${e.date}`));
}

function checkForecastLogic(predictions, elo) {
  const pick = [];
  const fair = [];
  const market = [];
  const follows = [];
  const score = [];
  const adds = [];
  let withMarket = 0;
  let followChecked = 0;
  let scoreChecked = 0;
  let addChecked = 0;
  const american = (p) => (p >= 0.5 ? (-100 * p) / (1 - p) : (100 * (1 - p)) / p);
  const implied = (ml) => (ml < 0 ? -ml / (100 - ml) : 100 / (100 + ml));
  for (const p of predictions) {
    const label = `${p.id} ${p.away.abbr} @ ${p.home.abbr}`;
    const home = p.homeWinProbability;
    const picked = home >= 0.5 ? p.home.abbr : p.away.abbr;
    if (!(home > 0 && home < 1)) pick.push(`${label}: chance ${home}`);
    if (p.state === 'pre' && (p.pick !== picked || !near(p.pickProbability, Math.max(home, 1 - home), 0.0002))) pick.push(`${label}: home ${home}, pick ${p.pick} ${p.pickProbability}`);
    if (!near(p.fairMoneyline.home, american(home), 1.5) || !near(p.fairMoneyline.away, american(1 - home), 1.5)) fair.push(`${label}: at ${home}, fair odds ${p.fairMoneyline.home}/${p.fairMoneyline.away}`);

    const m = p.market;
    if (m?.homeMoneyline != null && m?.awayMoneyline != null && p.state === 'pre') {
      withMarket += 1;
      const raw = implied(m.homeMoneyline);
      const fairHome = raw / (raw + implied(m.awayMoneyline));
      if (!near(m.homeWinProbability, fairHome, 0.006)) market.push(`${label}: moneylines ${m.homeMoneyline}/${m.awayMoneyline} make ${fairHome.toFixed(3)}, site ${m.homeWinProbability}`);
      // A real favorite has to be favored both ways. Near even they can differ: hockey and baseball's ±1.5 is fixed, so someone has to carry it in a pick'em.
      if (m.homeSpread != null && Math.abs(m.homeSpread) > 1 && Math.abs(m.homeSpread) < 40 && Math.abs(fairHome - 0.5) > 0.03 && m.homeSpread < 0 !== fairHome > 0.5) market.push(`${label}: spread ${m.homeSpread} and moneylines ${m.homeMoneyline}/${m.awayMoneyline} name different favorites`);
      if (p.basis === 'market') {
        followChecked += 1;
        if (!near(home, m.homeWinProbability, 0.03)) follows.push(`${label}: forecast ${home}, market ${m.homeWinProbability}`);
      }
    }

    const s = p.projectedScore;
    if (s && p.state === 'pre') {
      scoreChecked += 1;
      if (s.totalFrom === 'market' && m?.total != null && !near(s.home + s.away, m.total, 0.11)) score.push(`${label}: projected total ${s.home + s.away}, posted ${m.total}`);
      if (s.marginFrom === 'spread' && m?.homeSpread != null && !near(s.home - s.away, -m.homeSpread, 0.11)) score.push(`${label}: projected margin ${s.home - s.away}, spread ${m.homeSpread}`);
      if (s.marginFrom === 'forecast' && Math.abs(home - 0.5) > 0.01 && s.home > s.away !== home > 0.5) score.push(`${label}: projected ${s.away}-${s.home}, forecast home ${home}`);
    }

    // The table on the game page: its factors, added up, make the ratings' number.
    if (p.factors?.length && p.ratingModel?.homeWinProbability != null && p.state === 'pre') {
      addChecked += 1;
      const net = p.factors.reduce((sum, f) => sum + f.home - f.away, 0);
      const fromTable = elo(net);
      if (!near(fromTable, p.ratingModel.homeWinProbability, 0.006)) adds.push(`${label}: factors net ${net.toFixed(1)} Elo make ${fromTable.toFixed(3)}, site says ${p.ratingModel.homeWinProbability}`);
    }
  }
  tally('picks follow their chances', predictions.length, pick);
  tally('fair odds are the chance as odds', predictions.length, fair);
  tally('market chances come from the moneylines, and spread and moneyline agree', withMarket, market);
  tally('forecasts follow the line once one is posted', followChecked, follows);
  tally('projected scores match the spread, total and pick', scoreChecked, score);
  tally('the factor table adds up to the ratings number', addChecked, adds);
}

function checkGraded(graded, record) {
  const rows = graded.filter((r) => r.correct === 'true' || r.correct === 'false');
  const wrong = [];
  let hits = 0;
  let loss = 0;
  let brier = 0;
  for (const r of rows) {
    const homeWon = Number(r.home_score) > Number(r.away_score);
    const p = Number(r.home_win_probability);
    const pickedHome = r.pick === r.home;
    const right = pickedHome === homeWon;
    if ((r.correct === 'true') !== right) wrong.push(`${r.game_id} ${r.away} ${r.away_score} @ ${r.home} ${r.home_score}: pick ${r.pick}, graded ${r.correct}`);
    if (Number(r.pick_probability) < 0.5) wrong.push(`${r.game_id}: pick at ${r.pick_probability}`);
    if (right) hits += 1;
    const said = homeWon ? p : 1 - p;
    loss -= Math.log(Math.max(1e-6, said));
    brier += (1 - said) ** 2;
  }
  tally('every graded pick is right or wrong by its own final score', rows.length, wrong);
  const o = record.overall;
  const sums = [];
  if (rows.length !== o.games) sums.push(`games: file ${rows.length}, record ${o.games}`);
  if (hits !== o.correct) sums.push(`correct: file ${hits}, record ${o.correct}`);
  if (!near(loss / rows.length, o.logLoss, 0.002)) sums.push(`log loss: file ${(loss / rows.length).toFixed(4)}, record ${o.logLoss.toFixed(4)}`);
  if (!near(brier / rows.length, o.brier, 0.002)) sums.push(`Brier: file ${(brier / rows.length).toFixed(4)}, record ${o.brier.toFixed(4)}`);
  const parts = [
    ['seasons', record.seasons.reduce((s, x) => s + x.metrics.games, 0)],
    ['bands', record.bands.reduce((s, x) => s + x.games, 0)],
    ['calibration buckets', record.calibration.reduce((s, x) => s + x.games, 0)]
  ];
  for (const [name, count] of parts) if (count !== o.games) sums.push(`${name} add to ${count}, record ${o.games}`);
  const logged = rows.filter((r) => r.logged_home_win_probability !== '');
  if (logged.length !== record.live.metrics.games) sums.push(`logged picks: file ${logged.length}, record ${record.live.metrics.games}`);
  const calledLogged = logged.filter(calledIt).length;
  if (calledLogged !== record.live.metrics.correct) sums.push(`logged picks called: file ${calledLogged}, record ${record.live.metrics.correct}`);
  tally('the track record recounts from the graded file', 4 + parts.length + 2, sums);
}

/** ESPN game-log stat names behind each prop market. */
const NAMES = {
  pts: ['points'], reb: ['totalRebounds'], ast: ['assists'], stl: ['steals'], blk: ['blocks'], tov: ['turnovers'],
  pra: ['points', 'totalRebounds', 'assists'], pr: ['points', 'totalRebounds'], pa: ['points', 'assists'], ar: ['assists', 'totalRebounds'],
  goals: ['goals'], sog: ['shotsTotal'], saves: ['saves'],
  pass_yds: ['passingYards'], pass_cmp: ['completions'], pass_att: ['passingAttempts'], pass_td: ['passingTouchdowns'], pass_int: ['interceptions'],
  pass_rush_yds: ['passingYards', 'rushingYards'], rush_yds: ['rushingYards'], rush_att: ['rushingAttempts'], rec_yds: ['receivingYards'], rec: ['receptions'], rush_rec_yds: ['rushingYards', 'receivingYards']
};
const NHL_NAMES = { ...NAMES, pts: ['points'], ast: ['assists'], blk: ['blockedShots'] };

async function checkProps(league, props, now, playersWanted = 14) {
  const results = [];
  for (const r of props) {
    const actual = Number(r.actual);
    const line = Number(r.line);
    const expected = actual === line ? 'push' : (r.side === 'over' ? actual > line : actual < line) ? 'won' : 'lost';
    if (r.result !== expected) results.push(`${r.player} ${r.side} ${line} ${r.market}: actual ${actual}, graded ${r.result}`);
  }
  tally('every graded prop is won or lost by its own line', props.length, results);

  const settled = props.filter((r) => now.getTime() - Date.parse(r.start_utc) > STATS_SETTLED_MS);
  const byPlayer = new Map();
  for (const r of settled) byPlayer.set(r.player_id, [...(byPlayer.get(r.player_id) ?? []), r]);
  const sample = [...byPlayer.values()].sort((a, b) => b.length - a.length).slice(0, playersWanted);
  const names = league === 'nhl' ? NHL_NAMES : NAMES;
  const wrong = [];
  let checked = 0;
  let notInLog = 0;
  await pool(sample, 4, async (rows) => {
    let log;
    try {
      log = await json(`${GAMELOG}/${PATHS[league]}/athletes/${rows[0].player_id}/gamelog`);
    } catch {
      return;
    }
    const events = new Map();
    for (const type of log.seasonTypes ?? []) for (const cat of type.categories ?? []) for (const e of cat.events ?? []) events.set(String(e.eventId), e.stats);
    for (const r of rows) {
      const stats = events.get(r.game_id);
      const wanted = names[r.market];
      if (!stats || !wanted) {
        notInLog += 1;
        continue;
      }
      const indexes = wanted.map((n) => log.names?.indexOf(n));
      if (indexes.some((i) => i === undefined || i < 0)) {
        notInLog += 1;
        continue;
      }
      checked += 1;
      const value = indexes.reduce((s, i) => s + Number(String(stats[i]).replace(/,/g, '')), 0);
      if (value !== Number(r.actual)) wrong.push(`${r.player} ${r.market} in ${r.game_id}: site ${r.actual}, ESPN game log ${value}`);
    }
  });
  tally(`graded props match ESPN's player game logs (${sample.length} players; ${notInLog} not comparable)`, checked, wrong);
}

/** The record's won, lost and profit, recounted bet by bet from the graded file at the prices logged. */
function checkPropMoney(props, live) {
  const problems = [];
  const count = (result) => props.filter((r) => r.result === result).length;
  let profit = 0;
  for (const r of props) {
    if (r.result === 'lost') profit -= 1;
    if (r.result !== 'won') continue;
    const price = Number(r.side === 'over' ? r.over_price : r.under_price);
    profit += price > 0 ? price / 100 : 100 / -price;
  }
  const settled = count('won') + count('lost');
  if (count('won') !== live.won) problems.push(`won: file ${count('won')}, record ${live.won}`);
  if (count('lost') !== live.lost) problems.push(`lost: file ${count('lost')}, record ${live.lost}`);
  if (count('push') !== live.pushes) problems.push(`pushes: file ${count('push')}, record ${live.pushes}`);
  if (settled !== live.bets) problems.push(`bets: file ${settled}, record ${live.bets}`);
  if (!near(profit, live.profit, 0.01)) problems.push(`profit: recounted ${profit.toFixed(2)} units, record ${live.profit.toFixed(2)}`);
  if (settled && !near(profit / settled, live.returnPerBet, 0.0001)) problems.push(`return a bet: recounted ${(profit / settled).toFixed(4)}, record ${live.returnPerBet.toFixed(4)}`);
  tally('the live prop record recounts, profit included, from the graded file', 6, problems);
}

/**
 * Each player's stats as the site has them against ESPN's game log, a separate
 * feed from the box scores the site reads. Leaders of every board, so each
 * stat line parsed for each position gets looked at.
 */
async function checkPlayerStats(league, events, now) {
  const page = clean(await text(`${BASE}/${league}/players`));
  const ids = [...new Set([...page.slice(page.indexOf('id="leaders"')).matchAll(/id="leaders-[a-z_]+"[\s\S]*?<\/ol>/g)].flatMap((m) => [...m[0].matchAll(/\/player\/(\d+)"/g)].map((x) => x[1])))];
  const names = league === 'nhl' ? NHL_NAMES : NAMES;
  const wrong = [];
  const byMarket = {};
  let checked = 0;
  // The comparison page lists each player's last ten games in full, two players to a page.
  const pairs = ids.flatMap((id, i) => (i % 2 === 0 ? [[id, ids[i + 1] ?? ids[0]]] : []));
  await pool(pairs, 3, async ([a, b]) => {
    let series;
    try {
      series = comparedSeries(await text(`${BASE}/${league}/compare?a=${a}&b=${b}`));
    } catch {
      return;
    }
    for (const [id, player] of [a, b].map((x, i) => [x, series?.[i]])) {
      if (!player) continue;
      let log;
      try {
        log = await json(`${GAMELOG}/${PATHS[league]}/athletes/${id}/gamelog`);
      } catch {
        continue;
      }
      const logged = new Map();
      for (const type of log.seasonTypes ?? []) for (const cat of type.categories ?? []) for (const e of cat.events ?? []) logged.set(String(e.eventId), e.stats);
      for (const game of player.games) {
        const event = events.get(game.gameId);
        const stats = logged.get(game.gameId);
        if (!event || !stats || now.getTime() - Date.parse(event.date) < STATS_SETTLED_MS) continue;
        for (const [market, value] of Object.entries(game.stats)) {
          const wanted = names[market];
          const indexes = wanted?.map((n) => log.names?.indexOf(n));
          if (!indexes || indexes.some((i) => i === undefined || i < 0)) continue;
          checked += 1;
          byMarket[market] = (byMarket[market] ?? 0) + 1;
          const theirs = indexes.reduce((s, i) => s + Number(String(stats[i]).replace(/,/g, '')), 0);
          if (value !== theirs) wrong.push(`${player.name} ${market} in ${game.gameId}: site ${value}, ESPN game log ${theirs}`);
        }
      }
    }
  });
  tally(`player stats match ESPN's game logs (${ids.length} players; ${Object.keys(byMarket).sort().join(', ')})`, checked, wrong);
}

/** A JSON array in a page's React data, by the key it follows. */
function dataArray(flat, key) {
  const at = flat.indexOf(`"${key}":[`);
  if (at < 0) return null;
  const start = at + key.length + 3;
  let depth = 0;
  let quoted = false;
  for (let i = start; i < flat.length; i += 1) {
    const c = flat[i];
    if (quoted) {
      if (c === '\\') i += 1;
      else if (c === '"') quoted = false;
    } else if (c === '"') quoted = true;
    else if (c === '[') depth += 1;
    else if (c === ']') {
      depth -= 1;
      if (depth === 0) return JSON.parse(flat.slice(start, i + 1));
    }
  }
  return null;
}

/**
 * The standings page reads ESPN's standings feed; the rest of the site reads its scoreboard. Two feeds, one truth,
 * so each team's record has to match, except where the standings feed hasn't caught up with a game yet.
 */
async function checkStandings(league, rankings) {
  const conferences = dataArray(pageData(await text(`${BASE}/${league}/standings`)), 'conferences');
  if (!conferences?.length) {
    console.log('  · no standings on the page; not compared');
    return;
  }
  const rows = conferences.flatMap((c) => c.rows);
  const parts = (record) => String(record ?? '').split('-').map(Number);
  const wrong = [];
  let behind = 0;
  let checked = 0;
  for (const r of rankings) {
    const row = rows.find((x) => x.teamId === String(r.team.id));
    const ours = parts(r.record);
    if (!row || !r.record || ours.some(Number.isNaN)) continue;
    const theirs = league === 'nhl' ? [row.wins, row.losses, row.otLosses] : row.ties ? [row.wins, row.losses, row.ties] : [row.wins, row.losses];
    const played = (list) => list.reduce((s, x) => s + x, 0);
    if (played(ours) !== played(theirs)) {
      behind += 1;
      continue;
    }
    checked += 1;
    if (ours.join('-') !== theirs.join('-')) wrong.push(`${r.team.abbr}: site ${ours.join('-')}, standings ${theirs.join('-')}`);
  }
  if (behind) console.log(`  · ${behind} team${behind === 1 ? '' : 's'} not compared: the two feeds have counted different numbers of games`);
  tally("standings match the records on the rest of the site", checked, wrong);
  const unordered = conferences.flatMap((c) =>
    c.divisions.flatMap((d) =>
      d.rows.slice(1).flatMap((x, i) => {
        const prev = d.rows[i];
        const worse = league === 'nhl' ? (x.points ?? 0) > (prev.points ?? 0) : (x.pct ?? 0) > (prev.pct ?? 0);
        return worse ? [`${d.name}: ${x.abbr} ahead of ${prev.abbr} on record but listed below`] : [];
      })
    )
  );
  tally('every division is in order', conferences.flatMap((c) => c.divisions).length, unordered);
}

/** Fantasy rankings: every player's team and position against ESPN's rosters, byes against its schedule, and what he's scored against its game logs. */
async function checkFantasy(rankings) {
  const flat = pageData(await text(`${BASE}/nfl/fantasy`));
  const rows = dataArray(flat, 'rows');
  if (!rows?.length) {
    console.log('  · no fantasy rankings up this week; not compared');
    return;
  }
  const roster = new Map();
  await pool(rankings, 6, async (r) => {
    try {
      const data = await json(`${ESPN}/site/v2/sports/football/nfl/teams/${r.team.id}/roster`);
      for (const a of (data.athletes ?? []).flatMap((x) => x.items ?? [x])) roster.set(String(a.id), { team: String(r.team.id), position: a.position?.abbreviation });
    } catch {
      // A team that didn't answer is simply not compared.
    }
  });
  const wrongTeam = [];
  const wrongPosition = [];
  let known = 0;
  for (const r of rows) {
    const espn = roster.get(r.id);
    if (!espn) continue;
    known += 1;
    if (espn.team !== r.team.id) wrongTeam.push(`${r.name}: site ${r.team.abbr}, ESPN's team ${espn.team}`);
    const position = espn.position === 'FB' ? 'RB' : espn.position;
    if (position !== r.position) wrongPosition.push(`${r.name}: site ${r.position}, ESPN ${espn.position}`);
  }
  tally("fantasy players are on the team ESPN's roster has them on", known, wrongTeam);
  tally("fantasy players are at the position ESPN's roster has them at", known, wrongPosition);

  // Byes: every team without a game in ESPN's schedule for those days, and only those.
  const end = new Date(rows.map((r) => r.start).sort().at(-1));
  const first = new Date(rows.map((r) => r.start).sort()[0]);
  const stamp = (d) => d.toISOString().slice(0, 10).replace(/-/g, '');
  const day = 86_400_000;
  const playing = new Set();
  // (One day at a time: the NFL scoreboard turns down a range of dates.)
  for (let t = first.getTime() - 3 * day; t <= end.getTime() + day; t += day) {
    const board = await json(`${ESPN}/site/v2/sports/football/nfl/scoreboard?dates=${stamp(new Date(t))}`);
    for (const e of board.events ?? []) for (const c of e.competitions?.[0]?.competitors ?? []) playing.add(c.team?.abbreviation);
  }
  const espnByes = rankings.map((r) => r.team.abbr).filter((a) => !playing.has(a)).sort().join();
  const byes = (flat.match(/On a bye: ([A-Z, ]+)\./)?.[1] ?? '').replace(/ /g, '');
  tally("fantasy byes match ESPN's schedule", 1, byes === espnByes ? [] : [`site ${byes || 'none'}, ESPN ${espnByes || 'none'}`]);

  // What he's done: the season line against ESPN's game log. The leaders of each position, most exposed to a mistake.
  const year = new Date().getUTCFullYear();
  const top = [...rows].sort((a, b) => b.games - a.games || b.projected.rec + b.projected.passYds / 30 - (a.projected.rec + a.projected.passYds / 30)).slice(0, 60);
  const fields = [
    ['passYds', ['passingYards']],
    ['passTd', ['passingTouchdowns']],
    ['passInt', ['interceptions']],
    ['rushYds', ['rushingYards']],
    ['recYds', ['receivingYards']],
    ['rec', ['receptions']],
    ['tds', ['rushingTouchdowns', 'receivingTouchdowns']]
  ];
  const wrongLine = [];
  let checked = 0;
  await pool(top, 4, async (r) => {
    if (!r.season) return;
    let log;
    try {
      log = await json(`${GAMELOG}/football/nfl/athletes/${r.id}/gamelog`);
    } catch {
      return;
    }
    const type = (log.seasonTypes ?? []).find((t) => /regular/i.test(t.displayName ?? '') && String(t.displayName).includes(String(year)));
    const events = (type?.categories ?? []).flatMap((c) => c.events ?? []);
    if (!events.length) return;
    checked += 1;
    if (events.length !== r.games) wrongLine.push(`${r.name} games: site ${r.games}, ESPN ${events.length}`);
    for (const [field, names] of fields) {
      const indexes = names.map((n) => log.names?.indexOf(n)).filter((i) => i >= 0);
      if (!indexes.length) continue;
      const theirs = events.reduce((s, e) => s + indexes.reduce((t, i) => t + (Number(String(e.stats[i]).replace(/,/g, '')) || 0), 0), 0);
      const ours = r.season[field] * r.games;
      checked += 1;
      if (Math.abs(ours - theirs) > 0.01) wrongLine.push(`${r.name} ${field}: site ${ours.toFixed(0)}, ESPN ${theirs}`);
    }
  });
  tally("fantasy season lines add up to ESPN's game logs", checked, wrongLine);
}

/** The React data on a page, joined back up across the chunks it streams in. */
const pageData = (html) => html.replace(/"\]\)<\/script><script[^>]*>self\.__next_f\.push\(\[1,"/g, '').replace(/\\\\/g, '\\').replace(/\\"/g, '"');

/** The two players' games from the comparison chart's data. */
function comparedSeries(html) {
  const flat = pageData(html);
  const at = flat.indexOf('"series":[');
  if (at < 0) return null;
  const start = at + '"series":'.length;
  let depth = 0;
  for (let i = start; i < flat.length; i += 1) {
    if (flat[i] === '[') depth += 1;
    else if (flat[i] === ']') {
      depth -= 1;
      if (depth === 0) return JSON.parse(flat.slice(start, i + 1));
    }
  }
  return null;
}

/**
 * The team metrics, every team, against ESPN's season totals. A feed separate
 * from the box scores they're built from, with the same formulas applied. Where
 * a metric needs the opponent's numbers too, its own-side version is compared.
 */
async function checkTeamMetrics(league, rankings, now, events) {
  const flat = pageData(await text(`${BASE}/${league}`));
  const rows = new Map();
  // Each row's own numbers come before the next row starts; its records in between have braces of their own.
  const starts = [...flat.matchAll(/"id":"(\d+)","abbr":"([^"]+)","shortName":"[^"]*","logo"/g)];
  starts.forEach((m, i) => {
    const row = flat.slice(m.index, starts[i + 1]?.index ?? m.index + 2000);
    const found = row.match(/"metrics":(\{[^{}]*\})/);
    if (found) rows.set(m[1], { abbr: m[2], games: Number(row.match(/"games":(\d+)/)?.[1]), metrics: JSON.parse(found[1]) });
  });
  let behind = 0;
  // A game inside the scorers' window can still differ from ESPN's latest.
  const fresh = [...events.values()].filter((e) => e.type === 2 && e.completed && now.getTime() - Date.parse(e.date) < STATS_SETTLED_MS);
  const wrong = [];
  let checked = 0;
  await pool(rankings, 6, async (r) => {
    const mine = rows.get(String(r.team.id));
    if (!mine) return;
    let cats;
    try {
      cats = (await json(`${ESPN}/site/v2/sports/${PATHS[league]}/teams/${r.team.id}/statistics`)).results?.stats?.categories ?? [];
    } catch {
      return;
    }
    const of = (name) => {
      for (const c of cats) {
        const s = (c.stats ?? []).find((x) => x.name === name);
        if (s) return Number(s.value ?? String(s.displayValue).replace(/,/g, ''));
      }
      return undefined;
    };
    // ESPN's season totals trail its box scores too: only compare once they cover the same games.
    const theirGames = of('gamesPlayed') ?? of('games') ?? of('teamGamesPlayed');
    if (theirGames !== mine.games) {
      behind += 1;
      return;
    }
    const compare = (label, site, theirs, within) => {
      if (site === undefined || theirs === undefined || !Number.isFinite(theirs)) return;
      checked += 1;
      // Rounding plus a game's corrections still settling: a small allowance when the team played lately.
      const slack = fresh.some((e) => e.home.id === String(r.team.id) || e.away.id === String(r.team.id)) ? within * 2.5 : within;
      if (!near(site, theirs, slack)) wrong.push(`${mine.abbr} ${label}: site ${site.toFixed(3)}, ESPN's totals make ${theirs.toFixed(3)}`);
    };
    const m = mine.metrics;
    if (league === 'nba') {
      const [pts, fga, fta, oreb, tov] = ['points', 'fieldGoalsAttempted', 'freeThrowsAttempted', 'offensiveRebounds', 'turnovers'].map(of);
      const own = fga + 0.44 * fta - oreb + tov;
      compare('TS%', m.ts, pts / (2 * (fga + 0.44 * fta)), 0.002);
      compare('TOV%', m.tov, tov / own, 0.002);
      compare('Off (own possessions)', m.off, (100 * pts) / own, 4);
    } else if (league === 'nhl') {
      const games = of('games');
      compare('SF', m.sf, of('shotsTotal') / games, 0.2);
      compare('SA', m.sa, of('shotsAgainst') / games, 0.2);
      compare('SH%', m.sh, of('goals') / of('shotsTotal'), 0.003);
      compare('SV%', m.sv, of('savePct'), 0.003);
    } else if (league === 'nfl') {
      const net = of('netPassingYards');
      const rush = of('rushingYards');
      const carries = of('rushingAttempts');
      const plays = of('totalOffensivePlays');
      compare('Off Y/P', m.off, (net + rush) / plays, 0.02);
      compare('Rush Y/A', m.rush, rush / carries, 0.01);
      compare('Pass Y/A', m.pass, net / (plays - carries), 0.02);
    }
  });
  tally(`team metrics match ESPN's season totals (${rows.size - behind} of ${rows.size} teams; the rest have games ESPN's totals haven't counted yet)`, checked, wrong);
}

/** A feed that parses to nothing is silent, so look: each finished game's page has its performers and plays. */
async function checkGameCenters(league, graded) {
  const latest = graded.slice(-6);
  const empty = [];
  await pool(latest, 3, async (r) => {
    const page = clean(await text(`${BASE}/${league}/game/${r.game_id}`));
    const label = `${r.game_id} ${r.away} @ ${r.home}`;
    if (!page.includes('Top performers') || /No stats on file|Stats appear/.test(page)) empty.push(`${label}: no top performers`);
    if (!/Scoring summary|Last plays/.test(page) || page.includes('No plays to show')) empty.push(`${label}: no plays`);
  });
  tally('finished games show their performers and plays', latest.length * 2, empty);
}

/** Who plays where: a player the site lists on one team, or projects for one, and ESPN's current roster has elsewhere. */
async function checkRosters(league, rankings, players, predictions) {
  const wrong = [];
  const where = new Map();
  await pool(rankings, 6, async (r) => {
    try {
      const data = await json(`${ESPN}/site/v2/sports/${PATHS[league]}/teams/${r.team.id}/roster`);
      // Some leagues list a flat roster; others group it by position.
      const flat = (data.athletes ?? []).flatMap((a) => (a.items ? a.items : [a]));
      for (const a of flat) where.set(String(a.id), r.team.abbr);
    } catch {
      // A team that didn't answer is simply not compared.
    }
  });
  // Regulars only: a name from the end of last season's bench can sit anywhere without anyone noticing.
  const regulars = players.filter((p) => p.league === league && p.usage >= 40 && where.has(p.id));
  for (const p of regulars) {
    if (p.team !== where.get(p.id)) wrong.push(`${p.name}: site ${p.team || 'none'}, ESPN's roster ${where.get(p.id)}`);
  }
  tally("regular players are on the team ESPN's roster has them on", regulars.length, wrong);

  // Everyone the next games project: a player gone from a team still takes a share of its production otherwise.
  const abbrOf = new Map(rankings.map((r) => [String(r.team.id), r.team.abbr]));
  const coming = predictions.filter((p) => p.state === 'pre').slice(0, 16);
  const seen = new Map();
  await pool(coming, 3, async (p) => {
    const flat = pageData(await text(`${BASE}/${league}/game/${p.id}`));
    for (const m of flat.matchAll(/"id":"(\d+)","name":"([^"]+)","teamId":"(\d+)","detail":"[^"]*","available":[\d.]+/g)) seen.set(`${m[1]}|${m[3]}`, { id: m[1], name: m[2], team: abbrOf.get(m[3]) });
  });
  const projected = [];
  for (const r of seen.values()) {
    const actual = where.get(r.id);
    if (actual && actual !== r.team) projected.push(`${r.name}: projected for ${r.team}, ESPN's roster ${actual}`);
    else if (!actual && where.size) projected.push(`${r.name}: projected for ${r.team}, on no ESPN roster`);
  }
  tally(`players projected for coming games are on those teams (${coming.length} games)`, seen.size, projected);
}

/** Whether what the site showed before the game called it: the locked forecast where there is one, else the one graded. */
function calledIt(r) {
  const shown = r.logged_home_win_probability !== '' ? Number(r.logged_home_win_probability) : Number(r.home_win_probability);
  return shown >= 0.5 === Number(r.home_score) > Number(r.away_score);
}

/**
 * Each date's results page, recounted from the graded file. Late games start
 * after midnight UTC but belong to the evening before. The page grades what was
 * shown at the time, so a game with a locked forecast counts by that.
 */
async function checkResultsPages(allGraded, now) {
  const easternDay = (iso) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(iso));
  const byDay = new Map();
  for (const r of allGraded) {
    if (r.correct !== 'true' && r.correct !== 'false') continue;
    const day = easternDay(r.start_utc);
    const seen = byDay.get(day) ?? byDay.set(day, { hits: 0, graded: 0 }).get(day);
    seen.graded += 1;
    if (calledIt(r)) seen.hits += 1;
  }
  const days = [...byDay.keys()].filter((d) => d < easternDay(now.toISOString())).sort().slice(-10);
  const wrong = [];
  for (const day of days) {
    const page = clean(await text(`${BASE}/results?date=${day}`));
    const m = page.match(/(\d+) of (\d+) winners called/);
    const want = byDay.get(day);
    if (!m) wrong.push(`${day}: no tally on the page`);
    else if (Number(m[1]) !== want.hits || Number(m[2]) !== want.graded) wrong.push(`${day}: page ${m[1]} of ${m[2]}, graded file ${want.hits} of ${want.graded}`);
  }
  tally('the results page for each date recounts from the graded file', days.length, wrong);
}

const LEADER_CATEGORIES = {
  nba: { pts: 'pointsPerGame', reb: 'reboundsPerGame', ast: 'assistsPerGame', stl: 'stealsPerGame', blk: 'blocksPerGame' },
  nfl: { pass_yds: 'passingYards', pass_td: 'passingTouchdowns', rush_yds: 'rushingYards', rec_yds: 'receivingYards', rec: 'receptions' },
  nhl: { pts: 'points', goals: 'goals', ast: 'assists' }
};

async function checkLeaders(league, events, now) {
  const categories = LEADER_CATEGORIES[league];
  if (!categories) return;
  // ESPN's leaders feed trails its box scores by hours, so right after games the site is simply ahead of it.
  const lately = [...events.values()].filter((e) => e.type === 2 && (e.state === 'in' || (e.completed && now.getTime() - Date.parse(e.date) < 12 * 3_600_000)));
  if (lately.length) {
    console.log(`  · stat leaders not compared with ${lately.length} game${lately.length === 1 ? '' : 's'} just played: ESPN's leaders feed trails its box scores`);
    return;
  }
  const page = clean(await text(`${BASE}/${league}/players`));
  if (!page.includes('id="leaders"') || !/This season/.test(page.slice(page.indexOf('id="leaders"'), page.indexOf('id="leaders"') + 900))) {
    console.log('  · stat leaders show last season for now; not compared');
    return;
  }
  const espn = await json(`${ESPN}/site/v3/sports/${PATHS[league]}/leaders?limit=5`);
  const cats = espn.leaders?.categories ?? [];
  const wrong = [];
  let checked = 0;
  for (const [market, name] of Object.entries(categories)) {
    const cat = cats.find((c) => c.name === name);
    const at = page.indexOf(`id="leaders-${market}"`);
    if (!cat || at < 0) continue;
    const board = page.slice(at, page.indexOf('</ol>', at));
    const values = [...board.matchAll(/games?<\/span><\/span><span[^>]*>([\d.,]+)</g)].map((m) => Number(m[1].replace(/,/g, '')));
    const theirs = (cat.leaders ?? []).slice(0, 5).map((l) => Number(String(l.displayValue ?? l.value).replace(/,/g, '')));
    checked += 1;
    // By the values at each place: players level on a number can be listed in either order.
    if (values.join() !== theirs.join()) wrong.push(`${name}: site ${values.join(' ')}, ESPN ${theirs.join(' ')}`);
  }
  tally("stat leaders' top fives match ESPN's", checked, wrong);
}

function checkSeason(league, standings, events) {
  const dir = '.cache';
  let files;
  try {
    files = readdirSync(dir).filter((f) => new RegExp(`^season-v\\d+-${league}\\.json$`).test(f));
  } catch {
    return;
  }
  const latest = files.sort((a, b) => Number(b.match(/v(\d+)/)[1]) - Number(a.match(/v(\d+)/)[1]))[0];
  if (!latest) return;
  const view = JSON.parse(readFileSync(join(dir, latest), 'utf8')).value;
  if (view?.status !== 'ready') {
    console.log(`  · no season simulation running (${view?.status ?? 'none'})`);
    return;
  }
  const teams = view.teams;
  const sum = (f) => teams.reduce((s, t) => s + (f(t) ?? 0), 0);
  const totals = [];
  const close = (name, got, want, within) => {
    if (!near(got, want, within)) totals.push(`${name} add to ${got.toFixed(3)}, should be ${want}`);
  };
  close('playoff chances', sum((t) => t.playoffs), PLAYOFF_SPOTS[league], 0.01);
  close('title chances', sum((t) => t.title), 1, 0.005);
  close('finals chances', sum((t) => t.final), 2, 0.01);
  if (DIVISIONS[league]) close('division title chances', sum((t) => t.divisionTitle), DIVISIONS[league], 0.01);
  if (league === 'nfl') close('top seed chances', sum((t) => t.bye), 2, 0.01);
  close('wins and losses', sum((t) => t.wins), sum((t) => t.losses + t.otLosses), 0.5 + teams.length * 0.02);
  tally('season simulation odds add up', 5, totals);

  const each = [];
  for (const t of teams) {
    const final = t.wins + t.losses + t.ties + t.otLosses;
    if (!near(final, t.games, 0.02)) each.push(`${t.id}: final record adds to ${final.toFixed(2)} of ${t.games} games`);
    if (t.wins < t.current.wins - 1e-6) each.push(`${t.id}: projected ${t.wins.toFixed(1)} wins, already has ${t.current.wins}`);
    if (t.title > t.final + 1e-9 || t.final > t.playoffs + 1e-9) each.push(`${t.id}: title ${t.title}, final ${t.final}, playoffs ${t.playoffs}`);
    if (!(t.winsLow <= t.wins && t.wins <= t.winsHigh)) each.push(`${t.id}: ${t.wins.toFixed(1)} wins outside ${t.winsLow}-${t.winsHigh}`);
  }
  tally('each team\'s projection hangs together', teams.length, each);

  const current = [];
  const byId = new Map(standings.map((e) => [String(e.team?.id), e]));
  // The simulation re-runs every 15 minutes, so a game that ended since the last run is in ESPN's record and not yet in its.
  // Anything that started within five hours of the run could have been unfinished when it ran.
  const ranAt = Date.parse(view.generatedAt);
  const stillPlaying = new Set(
    [...events.values()].filter((g) => g.state !== 'pre' && Date.parse(g.date) > ranAt - 5 * 3_600_000).flatMap((g) => [g.home.id, g.away.id])
  );
  let waiting = 0;
  for (const t of teams) {
    const e = byId.get(String(t.id));
    if (!e) continue;
    if (stillPlaying.has(String(t.id))) {
      waiting += 1;
      continue;
    }
    const espn = winsLosses(recordOf(stat(e, 'overall')?.displayValue), league);
    const c = { w: t.current.wins, l: t.current.losses + (t.current.otLosses ?? 0), t: t.current.ties ?? 0 };
    if (!sameRecord(c, espn)) current.push(`${t.id}: simulation starts from ${show(c)}, ESPN ${show(espn)}`);
  }
  if (waiting) console.log(`  · ${waiting} team${waiting === 1 ? '' : 's'} not compared with the simulation: playing around or since its last run`);
  tally("simulations start from ESPN's records", teams.length - waiting, current);
}

// ---- run

const now = new Date();
console.log(`Checking ${BASE} against ESPN, ${now.toISOString()}\n`);
const allGraded = [];
const { players: directory } = await json(`${BASE}/api/players?v=2`);
for (const league of LEAGUES) {
  console.log(league.toUpperCase());
  try {
    const { leagues: [{ rankings, season }], generatedAt } = await json(`${BASE}/api/rankings?league=${league}`);
    const { leagues: [{ predictions }] } = await json(`${BASE}/api/predictions?league=${league}`);
    const { leagues: [{ record }] } = await json(`${BASE}/api/record?league=${league}`);
    const graded = parseCsv(await text(`${BASE}/api/graded?league=${league}`));
    allGraded.push(...graded);
    const events = await seasonEvents(league, now);
    tally('the data is fresh', 1, now.getTime() - Date.parse(generatedAt) > 45 * 60_000 ? [`generated ${generatedAt}`] : []);

    await checkTeams(league, season.year, rankings, events);
    await checkGames(league, events, graded, predictions, now, rankings);
    // The site's Elo win chance: 400 points is ten to one.
    checkForecastLogic(predictions, (net) => 1 / (1 + 10 ** (-net / 400)));
    checkGraded(graded, record);
    await checkGameCenters(league, graded);
    if (league !== 'mlb') {
      const props = parseCsv(await text(`${BASE}/api/graded-props?league=${league}`));
      await checkProps(league, props, now);
      if (record.propsLive) checkPropMoney(props, record.propsLive);
      await checkLeaders(league, events, now);
      await checkPlayerStats(league, events, now);
      await checkRosters(league, rankings, directory, predictions);
      await checkTeamMetrics(league, rankings, now, events);
      if (league === 'nfl') await checkFantasy(rankings);
    }
    await checkStandings(league, rankings);
    checkSeason(league, standingsEntries(await json(`${ESPN}/v2/sports/${PATHS[league]}/standings`)), events);
  } catch (err) {
    failures += 1;
    console.log(`  ✗ couldn't finish ${league}: ${err.message}`);
  }
  console.log('');
}
if (!ONLY) {
  console.log('ACROSS LEAGUES');
  await checkResultsPages(allGraded, now);
  console.log('');
}
console.log(failures ? `${failures} disagreements in ${total.toLocaleString()} checks.` : `All ${total.toLocaleString()} checks agree.`);
process.exit(failures ? 1 : 0);
