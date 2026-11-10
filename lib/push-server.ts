// Background alerts, the server side: the browsers that asked for them, the
// keys the push services check the alerts against, and a scan every minute
// that works out what's due (lib/push.ts) and sends it. Runs inside the web
// server, started by instrumentation.ts.

import { createHash } from 'node:crypto';
import webpush from 'web-push';
import { readStore, writeStore } from './cache';
import type { Game } from './espn';
import { shortStatus } from './format';
import { isLeagueId, LeagueId, LEAGUES } from './leagues';
import { log } from './log';
import { getLeagueModel } from './model';
import { freshen } from './model/fresh';
import { liveNow } from './model/live';
import { legResults } from './model/legResults';
import { nextPropRow } from './model/playerLog';
import { propEngine } from './model/propEngines';
import { marketLabel } from './props';
import { keyAbsences } from './model/injuryNews';
import { alertsFor, NEWS_WINDOW_MS, Note, PlayerLines, PUSH_LIMITS, pruneSent, START_WINDOW_MS, TeamGame, Watch, WatchRequest } from './push';

const STORE = 'push-watches';
const KEYS = 'push-vapid';
const SCAN_MS = 60_000;
/** A browser that hasn't checked in (any visit re-sends its list) for this long drops off. */
const KEEP_MS = 30 * 86_400_000;
/** Most alerts one browser gets from a single scan; more would be a flood. */
const MAX_NOTES = 6;
/** Most distinct legs looked up in one scan. */
const MAX_LEGS_PER_SCAN = 5_000;

type Keys = { publicKey: string; privateKey: string };
const shared = globalThis as typeof globalThis & { __scVapid?: Promise<Keys>; __scAlerts?: boolean };

const idOf = (endpoint: string) => createHash('sha256').update(endpoint).digest('hex').slice(0, 32);

/**
 * The server's VAPID keys, which push services use to check an alert comes
 * from the site the browser subscribed to: from VAPID_PUBLIC_KEY and
 * VAPID_PRIVATE_KEY if set, else made once and kept in .cache.
 */
export function vapidKeys(): Promise<Keys> {
  shared.__scVapid ??= (async () => {
    const { VAPID_PUBLIC_KEY: publicKey, VAPID_PRIVATE_KEY: privateKey } = process.env;
    if (publicKey && privateKey) return { publicKey, privateKey };
    const stored = await readStore<Keys>(KEYS);
    if (stored?.publicKey && stored.privateKey) return stored;
    const made = webpush.generateVAPIDKeys();
    // The private key signs every alert: readable by the server's own user only.
    await writeStore(KEYS, made, { secret: true });
    return made;
  })();
  return shared.__scVapid;
}

/** Who the push services can contact about these alerts: VAPID_SUBJECT, the security contact, or the site's HTTPS address. */
function subject() {
  for (const candidate of [process.env.VAPID_SUBJECT, process.env.SECURITY_CONTACT, process.env.SITE_URL]) {
    if (candidate && /^(mailto:\S+@\S+|https:\/\/\S+)$/.test(candidate)) return candidate;
  }
  return 'mailto:alerts@shadowcrypts.invalid';
}

async function watches() {
  return (await readStore<Record<string, Watch>>(STORE)) ?? {};
}

/** Saves what a browser wants watched (replacing its last list) and says whether it's new. */
export async function upsertWatch(request: WatchRequest, now = Date.now()) {
  const all = await watches();
  const id = idOf(request.subscription.endpoint);
  const previous = all[id];
  all[id] = { ...request, createdAt: previous?.createdAt ?? now, updatedAt: now, sent: pruneSent(previous?.sent ?? {}, new Set(request.parlays.map((p) => p.id))) };
  const ids = Object.keys(all);
  if (ids.length > PUSH_LIMITS.watches) {
    for (const old of ids.sort((a, b) => all[a].updatedAt - all[b].updatedAt).slice(0, ids.length - PUSH_LIMITS.watches)) delete all[old];
  }
  await writeStore(STORE, all);
  return { created: !previous, watch: all[id] };
}

/** Whether the server already keeps this push address. */
export async function isWatched(endpoint: string) {
  return idOf(endpoint) in (await watches());
}

export async function removeWatch(endpoint: string) {
  const all = await watches();
  const id = idOf(endpoint);
  if (!all[id]) return false;
  delete all[id];
  await writeStore(STORE, all);
  return true;
}

/** Sends one alert. "gone" means the browser unsubscribed or the address expired, so it should be forgotten. */
export async function send(watch: Pick<Watch, 'subscription'>, note: Note): Promise<'ok' | 'gone' | 'failed'> {
  const keys = await vapidKeys();
  try {
    await webpush.sendNotification(watch.subscription, JSON.stringify(note), {
      vapidDetails: { subject: subject(), publicKey: keys.publicKey, privateKey: keys.privateKey },
      TTL: 6 * 3_600,
      urgency: 'high',
      // A newer alert on the same thing replaces one still waiting to be delivered.
      topic: createHash('sha256').update(note.tag).digest('base64url').slice(0, 32),
      timeout: 15_000
    });
    return 'ok';
  } catch (error) {
    const status = (error as { statusCode?: number }).statusCode;
    log('warn', 'push-refused', {
      status: status ?? null,
      service: new URL(watch.subscription.endpoint).hostname,
      reason: status ? String((error as { body?: unknown }).body ?? '').slice(0, 160) : error instanceof Error ? error.message.slice(0, 160) : null
    });
    return status === 404 || status === 410 ? 'gone' : 'failed';
  }
}

/** The first alert to a brand-new subscription: push services can take a moment to recognize it, so one retry. */
export async function sendFirst(watch: Pick<Watch, 'subscription'>, note: Note) {
  const first = await send(watch, note);
  if (first === 'ok') return first;
  await new Promise((resolve) => setTimeout(resolve, 2_500));
  return send(watch, note);
}

/** How long a new subscription is given before a push service's "gone" is believed. */
const SETTLING_MS = 10 * 60_000;

/** A game in progress as the close-finish alert needs it: the live win chance, how much is left, the clock. */
function liveFor(league: LeagueId, game: Game, pregameHomeProb: number): TeamGame['live'] {
  const now = liveNow(league, game, pregameHomeProb);
  return now ? { homeProb: now.homeProb, remaining: now.remaining, status: shortStatus(game.statusDetail) } : undefined;
}

/** The games followed teams play from 12 hours ago to two days ahead (injury news is announced that far out). */
async function teamGames(teams: Set<string>, now: number): Promise<TeamGame[]> {
  const out = new Map<string, TeamGame>();
  for (const league of new Set([...teams].map((t) => t.split(':')[0]))) {
    if (!isLeagueId(league)) continue;
    const model = await getLeagueModel(league).catch(() => null);
    if (!model) continue;
    // The followed teams' games in the window, with the latest scores and status so finals are announced promptly.
    const ids = new Set(
      [...teams]
        .filter((t) => t.startsWith(`${league}:`))
        .flatMap((t) => model.teamGames[t.split(':')[1]] ?? [])
        .filter((id) => {
          const start = Date.parse(model.predictions[id]?.game.date ?? '');
          return start <= now + Math.max(START_WINDOW_MS + 60_000, NEWS_WINDOW_MS) && start >= now - 12 * 3_600_000;
        })
    );
    const fresh = await freshen(league, [...ids].map((id) => model.predictions[id]), now);
    for (const prediction of fresh) {
      const { game, pick, pickProb, correct } = prediction;
      const side = (s: typeof game.home) => ({ teamId: s.teamId, abbr: s.abbr, name: s.shortName, score: s.score });
      out.set(`${league}:${game.id}`, {
        key: `${league}:${game.id}`,
        league,
        id: game.id,
        start: Date.parse(game.date),
        state: game.state,
        completed: game.completed,
        home: side(game.home),
        away: side(game.away),
        pick,
        pickProb,
        correct,
        out: game.state === 'pre' ? keyAbsences(prediction) : undefined,
        live: liveFor(league, game, prediction.homeProb)
      });
    }
  }
  return [...out.values()];
}

/** Followed players' lines for their next games still to come, where the book has posted any. */
async function linesFor(players: Set<string>, now: number): Promise<PlayerLines[]> {
  const out: PlayerLines[] = [];
  for (const league of new Set([...players].map((p) => p.split(':')[0]))) {
    if (!isLeagueId(league)) continue;
    const engine = propEngine(LEAGUES[league]);
    const model = engine ? await getLeagueModel(league).catch(() => null) : null;
    if (!engine || !model) continue;
    for (const key of players) {
      const [l, playerId] = key.split(':');
      if (l !== league) continue;
      const next = nextPropRow(model, playerId);
      if (!next || next.game.state !== 'pre' || Date.parse(next.game.date) <= now) continue;
      const lines = engine.markets
        .flatMap((m) => {
          const line = next.row.cells[m]?.line;
          return line ? [{ label: marketLabel(m).short, line: line.line, over: line.forecastOver }] : [];
        })
        .slice(0, 3);
      if (!lines.length) continue;
      out.push({ key, league, playerId, name: next.row.name, gameId: next.game.id, game: `${next.game.away.abbr} @ ${next.game.home.abbr}`, start: Date.parse(next.game.date), lines });
    }
  }
  return out;
}

/** One pass: every browser's alerts worked out from the latest results and sent. */
export async function scan(now = Date.now()) {
  const all = await watches();
  for (const [id, w] of Object.entries(all)) if (now - w.updatedAt > KEEP_MS) delete all[id];
  const list = Object.entries(all);
  if (!list.length) return { watches: 0, sent: 0 };
  // A bounded amount of work per pass, however many browsers there are: the most recently active first.
  const legIds = [
    ...new Set(
      [...list]
        .sort((a, b) => b[1].updatedAt - a[1].updatedAt)
        .flatMap(([, w]) => (w.prefs.legs ? w.parlays.flatMap((p) => p.legs.map((l) => l.id)) : []))
    )
  ].slice(0, MAX_LEGS_PER_SCAN);
  const results = legIds.length ? await legResults(legIds) : {};
  const teams = new Set(list.flatMap(([, w]) => (w.prefs.games ? w.teams : [])));
  const games = teams.size ? await teamGames(teams, now) : [];
  const players = new Set(list.flatMap(([, w]) => (w.prefs.games ? (w.players ?? []) : [])));
  const playerLines = players.size ? await linesFor(players, now) : [];
  let sent = 0;
  for (const [id, w] of list) {
    const { notes, sent: after } = alertsFor(w, results, games, now, playerLines);
    // The browser may have re-sent its list while this pass ran: record what was said on whichever copy is current.
    const current = all[id];
    if (current) current.sent = { ...current.sent, ...Object.fromEntries(Object.entries(after).filter(([k, v]) => w.sent[k] !== v)) };
    for (const note of notes.slice(0, MAX_NOTES)) {
      const outcome = await send(w, note);
      if (outcome === 'gone' && now - w.createdAt > SETTLING_MS) {
        delete all[id];
        break;
      }
      if (outcome === 'ok') sent += 1;
    }
  }
  await writeStore(STORE, all);
  return { watches: Object.keys(all).length, sent };
}

/** The scan, every minute for the life of the server (once per process, however often it's asked to start). */
export function startAlerts() {
  if (shared.__scAlerts) return;
  shared.__scAlerts = true;
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const result = await scan();
      if (result.sent) log('info', 'alerts-sent', result);
    } catch (error) {
      log('error', 'alerts-failed', { message: error instanceof Error ? error.message : String(error) });
    } finally {
      running = false;
    }
  };
  setInterval(tick, SCAN_MS).unref();
  setTimeout(tick, 15_000).unref();
}
