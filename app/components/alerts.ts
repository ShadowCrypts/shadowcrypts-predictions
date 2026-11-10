'use client';

import { useCallback, useSyncExternalStore } from 'react';
import { legId } from '../../lib/legs';
import type { AlertPrefs, WatchRequest } from '../../lib/push';

// Alerts when a tracked leg hits or misses, when a parlay cashes or busts,
// when a followed team's game is about to start or has finished, and when a
// followed player's lines are posted. Two ways:
//  - "push": the server watches and sends them through the browser's push
//    service, so they arrive with the site closed (needs the service worker,
//    which production builds install);
//  - "page": the page itself announces what it sees while it's open.
// Which one, and what to be told about, is kept in this browser.

const MODE = 'sc-alerts';
const PREFS = 'sc-alert-prefs';
const EVENT = 'sc-alerts-change';
export type AlertMode = 'push' | 'page' | 'off';

function read<T>(key: string, fallback: T, parse: (raw: string) => T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : parse(raw);
  } catch {
    return fallback;
  }
}
function write(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Private mode: the choice lasts until the page closes.
  }
  window.dispatchEvent(new Event(EVENT));
}

const mode = (): AlertMode => read(MODE, 'off' as AlertMode, (raw) => (raw === 'push' || raw === 'page' ? raw : raw === 'on' ? 'page' : 'off'));
let prefsCache: { raw: string; value: AlertPrefs } | null = null;
const prefs = (): AlertPrefs => {
  const raw = read(PREFS, '', (r) => r);
  if (prefsCache?.raw === raw) return prefsCache.value;
  let value: AlertPrefs = { legs: true, games: true };
  try {
    const p = raw ? (JSON.parse(raw) as Partial<AlertPrefs>) : {};
    value = { legs: p.legs !== false, games: p.games !== false };
  } catch {
    // Default: everything.
  }
  prefsCache = { raw, value };
  return value;
};
const DEFAULT_PREFS: AlertPrefs = { legs: true, games: true };

function subscribe(onChange: () => void) {
  window.addEventListener(EVENT, onChange);
  window.addEventListener('storage', onChange);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener('storage', onChange);
  };
}

const permission = (): NotificationPermission | 'unsupported' => ('Notification' in window ? Notification.permission : 'unsupported');

/** The service worker's registration, when there is one (production builds) and the browser does push. */
async function pushRegistration() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return null;
  return (await navigator.serviceWorker.getRegistration()) ?? null;
}

function keyBytes(base64url: string) {
  const text = atob(base64url.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (base64url.length % 4)) % 4));
  return Uint8Array.from(text, (c) => c.charCodeAt(0));
}

/** What this browser wants watched right now: open tracked parlays (newest first), followed teams and followed players. */
export function watchList(): Pick<WatchRequest, 'parlays' | 'teams' | 'players' | 'prefs'> {
  type Leg = { key: string; label: string; league: string; gameId: string; link?: unknown; line?: number };
  type Parlay = { id: string; price: number | null; legs: Leg[]; results: Record<string, unknown> };
  const log = read<Parlay[]>('sc-parlay-log', [], (raw) => JSON.parse(raw) as Parlay[]);
  const teams = read<string[]>('sc-favorites', [], (raw) => JSON.parse(raw) as string[]);
  const players = read<string[]>('sc-players', [], (raw) => JSON.parse(raw) as string[]);
  const parlays = (Array.isArray(log) ? log : [])
    .filter((p) => p.legs.some((l) => !p.results?.[l.key]))
    .slice(0, 30)
    .map((p) => ({
      id: p.id,
      price: p.price,
      legs: p.legs.flatMap((l) => {
        const id = legId(l as Parameters<typeof legId>[0]);
        return id ? [{ key: l.key, id, label: l.label }] : [];
      })
    }))
    .filter((p) => p.legs.length);
  return { parlays, teams: Array.isArray(teams) ? teams.slice(0, 40) : [], players: Array.isArray(players) ? players.slice(0, 40) : [], prefs: prefs() };
}

/** Sends the server this browser's push address and watch list. "none" when push isn't set up here (any more). */
export async function syncPush(): Promise<'ok' | 'none' | 'error'> {
  const registration = await pushRegistration();
  const subscription = await registration?.pushManager.getSubscription();
  if (!subscription) return 'none';
  const response = await fetch('/api/push/watch', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ subscription: subscription.toJSON(), ...watchList() })
  }).catch(() => null);
  return response?.ok ? 'ok' : 'error';
}

/**
 * Keeps the server's copy of the watch list current while push is on: on
 * every visit (which also tells the server this browser is still around) and
 * a few seconds after a parlay is tracked or a team followed. Returns a stop function.
 */
export function keepPushInSync() {
  let timer: number | undefined;
  const later = (delay: number) => {
    window.clearTimeout(timer);
    timer = window.setTimeout(async () => {
      if (mode() !== 'push' || permission() !== 'granted') return;
      // The subscription is gone (cleared site data, browser reset): fall back to alerts from the page.
      if ((await syncPush()) === 'none') write(MODE, 'page');
    }, delay);
  };
  const onChange = () => later(3_000);
  const events = ['sc-parlay-log-change', 'sc-favorites-change', 'sc-players-change', EVENT, 'storage'];
  for (const e of events) window.addEventListener(e, onChange);
  later(5_000);
  return () => {
    window.clearTimeout(timer);
    for (const e of events) window.removeEventListener(e, onChange);
  };
}

async function enablePush() {
  const registration = await pushRegistration();
  if (!registration) return false;
  const { publicKey } = (await fetch('/api/push/key').then((r) => r.json())) as { publicKey: string };
  const subscription =
    (await registration.pushManager.getSubscription()) ?? (await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) }));
  if (!subscription) return false;
  write(MODE, 'push');
  return (await syncPush()) === 'ok';
}

async function disablePush() {
  const registration = await pushRegistration();
  const subscription = await registration?.pushManager.getSubscription();
  if (subscription) {
    await fetch('/api/push/unwatch', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ endpoint: subscription.endpoint }) }).catch(() => undefined);
    await subscription.unsubscribe().catch(() => false);
  }
}

export function useAlerts() {
  const current = useSyncExternalStore(subscribe, () => (permission() === 'granted' ? mode() : 'off'), () => 'off' as AlertMode);
  const state = useSyncExternalStore(subscribe, permission, () => 'default' as const);
  const chosen = useSyncExternalStore(subscribe, prefs, () => DEFAULT_PREFS);
  /** Turns alerts off, or asks the browser's permission and turns them on: through the push service where it can, else from the page. */
  const toggle = useCallback(async () => {
    if (current !== 'off') {
      if (current === 'push') await disablePush();
      return write(MODE, null);
    }
    if (permission() === 'unsupported') return;
    const answer = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission;
    if (answer !== 'granted') return write(MODE, null);
    const pushed = await enablePush().catch(() => false);
    if (!pushed) write(MODE, 'page');
  }, [current]);
  const setPrefs = useCallback((next: AlertPrefs) => write(PREFS, JSON.stringify(next)), []);
  return { mode: current, permission: state, prefs: chosen, toggle, setPrefs };
}

/** Shows an alert from the page itself, only when the page is how alerts arrive (with push on, the server sends them). */
export async function notify(title: string, body: string, tag: string) {
  if (mode() !== 'page' || permission() !== 'granted') return;
  const options: NotificationOptions = { body, tag, icon: '/brand-icon/192', badge: '/brand-icon/192', data: { url: '/live' } };
  try {
    const registration = await navigator.serviceWorker?.getRegistration();
    if (registration) return await registration.showNotification(title, options);
  } catch {
    // Fall through to a page notification.
  }
  try {
    new Notification(title, options);
  } catch {
    // Some browsers allow notifications only from a service worker.
  }
}
