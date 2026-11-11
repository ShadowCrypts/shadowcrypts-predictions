// Background alerts: what a browser asks the server to watch for it (its push
// address, its open parlays' legs, its followed teams), checked strictly, and
// which alerts are due given the latest results. Pure, so it's tested; the
// sending lives in lib/push-server.ts.

import { LegResult, parseLegId } from './legs';
import { injuryNews, newsText } from './model/injuryNews';
import { isAmerican } from './parlay';

/** A browser's push subscription, as `PushSubscription.toJSON()` gives it. */
export type PushAddress = { endpoint: string; keys: { p256dh: string; auth: string } };
export type WatchedLeg = { key: string; id: string; label: string };
export type WatchedParlay = { id: string; price: number | null; legs: WatchedLeg[] };
/** `games` covers followed teams' games and followed players' lines. */
export type AlertPrefs = { legs: boolean; games: boolean };
/** `players` are followed players' keys ("nba:3112335"); browsers that synced before players could be followed send none. */
export type WatchRequest = { subscription: PushAddress; parlays: WatchedParlay[]; teams: string[]; players?: string[]; prefs: AlertPrefs };

/** What the server keeps per browser: the request, plus what it has already said. */
export type Watch = WatchRequest & { createdAt: number; updatedAt: number; sent: Record<string, string> };

/** A followed player's lines for his next game, once the book has posted some. */
export type PlayerLines = {
  /** "nba:3112335" */
  key: string;
  league: string;
  playerId: string;
  name: string;
  gameId: string;
  game: string;
  start: number;
  lines: { label: string; line: number; over: number }[];
};

export type Note = { title: string; body: string; tag: string; url: string };

/** One game a followed team plays, as the alerts need it. */
export type TeamGame = {
  key: string;
  league: string;
  id: string;
  start: number;
  state: 'pre' | 'in' | 'post';
  completed: boolean;
  home: { teamId: string; abbr: string; name: string; score: number | null };
  away: { teamId: string; abbr: string; name: string; score: number | null };
  pick: 'home' | 'away';
  pickProb: number;
  correct: boolean | null;
  /** Key players the forecast counts as likely out (`keyAbsences`), for games still to come. */
  out?: string[];
  /** While it's on: the live home win chance, the share of the game left, and the clock ("4:12 4th"). */
  live?: { homeProb: number; remaining: number; status: string };
};

/** A followed team's game is a close finish when this little of it is left with neither side above the band's edge. */
export const CLUTCH = { remaining: 0.12, band: 0.3 };

/** How far ahead of a followed team's game injury news about it is announced. */
export const NEWS_WINDOW_MS = 48 * 3_600_000;

/**
 * Caps on what one alert list holds and on the store as a whole. `newPerHour` is how many browsers new to the
 * server one address can sign up in an hour (one person has a browser or three; more is someone trying to fill
 * the store so the oldest lists get pushed out), counted in memory only.
 */
export const PUSH_LIMITS = { parlays: 30, legs: 12, teams: 40, players: 40, label: 120, bytes: 32_768, watches: 2_000, newPerHour: 10 };

/** How long before the start a followed team's game is announced. */
export const START_WINDOW_MS = 35 * 60_000;

/**
 * The browsers' own push services, the only places the server will send to
 * (anything else in a subscription is refused, so it can't be pointed at an
 * internal address): Chrome and Edge via Google, Firefox via Mozilla, Safari
 * via Apple, and Windows' notification service.
 */
const PUSH_HOSTS = ['fcm.googleapis.com', 'updates.push.services.mozilla.com', '.push.services.mozilla.com', 'web.push.apple.com', '.push.apple.com', '.notify.windows.com'];

export function isPushEndpoint(endpoint: unknown) {
  if (typeof endpoint !== 'string' || endpoint.length > 1_000) return false;
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.port || url.username || url.password) return false;
  const host = url.hostname.toLowerCase();
  return PUSH_HOSTS.some((h) => (h.startsWith('.') ? host.endsWith(h) && host.length > h.length : host === h));
}

const BASE64URL = /^[A-Za-z0-9_-]+=*$/;
/** Free text kept to one line of printable characters, capped. */
const line = (text: unknown, max: number) => (typeof text === 'string' ? text.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '');

/** A watch request checked field by field; null when anything essential is wrong. Extra or malformed items are dropped. */
export function readWatchRequest(body: unknown): WatchRequest | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  const sub = b.subscription as Record<string, unknown> | undefined;
  const keys = sub?.keys as Record<string, unknown> | undefined;
  if (!sub || !isPushEndpoint(sub.endpoint) || !keys) return null;
  const { p256dh, auth } = keys;
  if (typeof p256dh !== 'string' || typeof auth !== 'string' || !BASE64URL.test(p256dh) || !BASE64URL.test(auth) || p256dh.length < 60 || p256dh.length > 120 || auth.length < 16 || auth.length > 40) return null;
  const parlays: WatchedParlay[] = (Array.isArray(b.parlays) ? b.parlays : [])
    .slice(0, PUSH_LIMITS.parlays)
    .flatMap((p: unknown) => {
      const r = p as Record<string, unknown> | null;
      if (!r || typeof r.id !== 'string' || !/^[a-z0-9-]{4,40}$/i.test(r.id)) return [];
      const price = typeof r.price === 'number' && isAmerican(r.price) ? r.price : null;
      const legs: WatchedLeg[] = (Array.isArray(r.legs) ? r.legs : []).slice(0, PUSH_LIMITS.legs).flatMap((l: unknown) => {
        const x = l as Record<string, unknown> | null;
        if (!x || typeof x.id !== 'string' || !parseLegId(x.id)) return [];
        const key = line(x.key, 200);
        const label = line(x.label, PUSH_LIMITS.label);
        return key && label ? [{ key, id: x.id, label }] : [];
      });
      return legs.length ? [{ id: r.id, price, legs }] : [];
    });
  const teams = [...new Set((Array.isArray(b.teams) ? b.teams : []).filter((t): t is string => typeof t === 'string' && /^(nfl|nba|mlb|nhl):\d{1,10}$/.test(t)))].slice(0, PUSH_LIMITS.teams);
  // Only leagues with player pages (and lines) have players to follow.
  const players = [...new Set((Array.isArray(b.players) ? b.players : []).filter((p): p is string => typeof p === 'string' && /^(nfl|nba|nhl):\d{1,15}$/.test(p)))].slice(0, PUSH_LIMITS.players);
  const prefs = (b.prefs ?? {}) as Record<string, unknown>;
  return {
    subscription: { endpoint: sub.endpoint as string, keys: { p256dh, auth } },
    parlays,
    teams,
    players,
    prefs: { legs: prefs.legs !== false, games: prefs.games !== false }
  };
}

/** Where a leg stands for alerts: settled for good (graded, or a count already past its line), or not yet. */
function legState(r: LegResult | undefined): 'won' | 'lost' | 'push' | 'void' | null {
  if (!r) return null;
  if (r.state !== 'pending') return r.state;
  return r.live?.decided ?? null;
}

const pctText = (p: number) => `${Math.round(p * 100)}%`;
const priceText = (american: number) => (american > 0 ? `+${american}` : `−${Math.abs(american)}`);

/**
 * The alerts due for one browser, and what's been said once they're sent.
 * A parlay's legs are announced as they hit or miss, and the parlay when it
 * cashes or busts (in place of the leg that busted it). A parlay's first look
 * only takes note of where things stand, so nothing settled earlier is
 * announced late. Followed teams: once shortly before each game, once when
 * it's final (games that started before the alerts were turned on are
 * skipped), when a key player in it is ruled out or back within two days
 * of it (the first look at a game only notes who's out), and once if it's
 * close late (a close finish). Followed players: once when the book first posts his lines for a
 * game still to come (lines already up when he was first watched aren't
 * announced late).
 */
export function alertsFor(
  watch: Watch,
  legs: Record<string, LegResult>,
  games: TeamGame[],
  now: number,
  playerLines: PlayerLines[] = []
): { notes: Note[]; sent: Record<string, string> } {
  const sent = { ...watch.sent };
  const notes: Note[] = [];
  if (watch.prefs.legs) {
    for (const parlay of watch.parlays) {
      const states = parlay.legs.map((l) => legState(legs[l.id]));
      const overall = states.includes('lost') ? 'lost' : states.every((s) => s && s !== 'lost') && states.includes('won') ? 'won' : states.every((s) => s === 'push' || s === 'void') ? 'void' : 'open';
      const firstLook = !sent[`seen|${parlay.id}`];
      sent[`seen|${parlay.id}`] = '1';
      const changed = parlay.legs.flatMap((l, i) => {
        const key = `leg|${parlay.id}|${l.key}`;
        const s = states[i];
        if (!s || sent[key] === s) return [];
        sent[key] = s;
        return firstLook ? [] : [{ leg: l, state: s }];
      });
      const parlayKey = `parlay|${parlay.id}`;
      const parlayChanged = (overall === 'won' || overall === 'lost') && sent[parlayKey] !== overall;
      if (parlayChanged) sent[parlayKey] = overall;
      if (firstLook) continue;
      const url = '/live';
      for (const { leg, state } of changed) {
        // The leg that busted the parlay is told as the bust itself.
        if (parlayChanged && overall === 'lost' && state === 'lost') continue;
        if (state === 'won') notes.push({ title: 'Leg hit ✓', body: leg.label, tag: `${parlay.id}|${leg.key}`, url });
        else if (state === 'lost') notes.push({ title: 'Leg missed', body: leg.label, tag: `${parlay.id}|${leg.key}`, url });
      }
      if (parlayChanged && overall === 'won') {
        notes.push({ title: 'Parlay cashed! 🎉', body: `${parlay.legs.length} legs, all in${parlay.price !== null ? ` at ${priceText(parlay.price)}` : ''}.`, tag: parlay.id, url });
      } else if (parlayChanged && overall === 'lost') {
        const miss = parlay.legs.find((_, i) => states[i] === 'lost');
        notes.push({ title: 'Parlay busted', body: `${miss?.label ?? 'A leg'} missed.`, tag: parlay.id, url });
      }
    }
  }
  if (watch.prefs.games) {
    const followed = new Set(watch.teams);
    for (const g of games) {
      if (!followed.has(`${g.league}:${g.home.teamId}`) && !followed.has(`${g.league}:${g.away.teamId}`)) continue;
      const url = `/${g.league}/game/${g.id}`;
      const pickSide = g.pick === 'home' ? g.home : g.away;
      const startKey = `start|${g.key}`;
      const minutes = Math.round((g.start - now) / 60_000);
      if (g.state === 'pre' && g.start > now && g.start - now <= START_WINDOW_MS && !sent[startKey]) {
        sent[startKey] = '1';
        notes.push({ title: `${g.away.abbr} @ ${g.home.abbr} in ${Math.max(1, minutes)} min`, body: `Forecast: ${pickSide.name} ${pctText(g.pickProb)} to win.`, tag: startKey, url });
      }
      // Injury news: a key player ruled out or back. The first look at a game only notes who's out.
      const newsKey = `news|${g.key}`;
      if (g.state === 'pre' && g.start > now && g.start - now <= NEWS_WINDOW_MS && g.out) {
        const current = JSON.stringify(g.out);
        const before = sent[newsKey];
        if (before !== current) {
          sent[newsKey] = current;
          let previous: string[] | undefined;
          try {
            previous = before === undefined ? undefined : (JSON.parse(before) as string[]);
          } catch {
            previous = undefined;
          }
          const news = injuryNews(previous, g.out);
          if (news) notes.push({ title: `Injury news: ${g.away.abbr} @ ${g.home.abbr}`, body: `${newsText(news)}. Forecast now: ${pickSide.name} ${pctText(g.pickProb)} to win.`, tag: newsKey, url });
        }
      }
      // A close finish: once per game, late in it, with the outcome still in doubt.
      const clutchKey = `clutch|${g.key}`;
      if (g.state === 'in' && g.live && g.live.remaining <= CLUTCH.remaining && Math.abs(g.live.homeProb - 0.5) <= 0.5 - CLUTCH.band && !sent[clutchKey]) {
        sent[clutchKey] = '1';
        const ahead = g.live.homeProb >= 0.5 ? g.home : g.away;
        notes.push({
          title: `Close finish: ${g.away.abbr} ${g.away.score ?? 0}, ${g.home.abbr} ${g.home.score ?? 0}`,
          body: `${g.live.status} · ${ahead.name} ${pctText(Math.max(g.live.homeProb, 1 - g.live.homeProb))} to win now.`,
          tag: clutchKey,
          url
        });
      }
      const finalKey = `final|${g.key}`;
      if (g.completed && g.start >= watch.createdAt && !sent[finalKey] && g.home.score !== null && g.away.score !== null) {
        sent[finalKey] = '1';
        const winner = g.home.score > g.away.score ? g.home : g.away;
        const called = g.correct === null ? '' : g.correct ? ' · the forecast called it' : ' · the forecast missed';
        notes.push({ title: `Final: ${g.away.abbr} ${g.away.score}, ${g.home.abbr} ${g.home.score}`, body: `${winner.name} won${called} (${pickSide.abbr} ${pctText(g.pickProb)}).`, tag: finalKey, url });
      }
    }
    // A player's first look (posted lines or not) takes whatever's already up as known, so nothing is announced late.
    const followedPlayers = new Set(watch.players ?? []);
    const firstLooks = new Set([...followedPlayers].filter((key) => !sent[`seenp|${key}`]));
    for (const key of followedPlayers) sent[`seenp|${key}`] = '1';
    for (const p of playerLines) {
      if (!followedPlayers.has(p.key) || !p.lines.length || p.start <= now) continue;
      const linesKey = `lines|${p.key}:${p.gameId}`;
      if (sent[linesKey]) continue;
      sent[linesKey] = '1';
      if (firstLooks.has(p.key)) continue;
      const summary = p.lines.map((l) => `${l.label} ${l.line} (${pctText(l.over)} over)`).join(' · ');
      notes.push({ title: `Lines are up: ${p.name}`, body: `${p.game} · ${summary}`, tag: linesKey, url: `/${p.league}/player/${p.playerId}` });
    }
  }
  return { notes, sent };
}

/** Keeps only what still matters: notes on parlays still watched, players seen, and game and lines notes (the newest few hundred). */
export function pruneSent(sent: Record<string, string>, parlayIds: Set<string>) {
  const out: Record<string, string> = {};
  const games: string[] = [];
  for (const [key, value] of Object.entries(sent)) {
    const [kind, id] = key.split('|');
    if (kind === 'start' || kind === 'final' || kind === 'lines' || kind === 'news' || kind === 'clutch') games.push(key);
    else if (kind === 'seenp' || parlayIds.has(id)) out[key] = value;
  }
  for (const key of games.slice(-400)) out[key] = sent[key];
  return out;
}
