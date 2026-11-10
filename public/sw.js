// ShadowCrypts Predictions service worker: pages you've seen stay readable offline.
// Pages: network first, falling back to the last copy, then a self-contained offline page.
// Build assets and images: cache first, since their URLs change when they do.
// Other same-origin files (icon, manifest): network first, cached copy when offline.
// API calls and other sites are left alone.

const PAGES = 'sc-pages-v1';
const ASSETS = 'sc-assets-v2';
// Plain HTML with inline styles: an app page would need scripts that may not be cached.
const OFFLINE = '/offline.html';
const MAX_PAGES = 60;
const MAX_ASSETS = 400;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(ASSETS).then((cache) => cache.addAll([OFFLINE, '/icon', '/manifest.webmanifest'])));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== PAGES && key !== ASSETS).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

/** Oldest entries go first once a cache passes its limit. */
async function trim(cache, max) {
  const keys = await cache.keys();
  for (const request of keys.slice(0, Math.max(0, keys.length - max))) await cache.delete(request);
}

async function page(request) {
  const cache = await caches.open(PAGES);
  try {
    const response = await fetch(request);
    if (response.ok) {
      // Re-adding moves the page to the newest end, so trimming drops the least recently seen.
      await cache.delete(request);
      await cache.put(request, response.clone());
      trim(cache, MAX_PAGES);
    }
    return response;
  } catch {
    return (await cache.match(request)) || (await caches.match(OFFLINE)) || Response.error();
  }
}

async function asset(request) {
  const cache = await caches.open(ASSETS);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok) {
    await cache.put(request, response.clone());
    trim(cache, MAX_ASSETS);
  }
  return response;
}

async function file(request) {
  try {
    return await fetch(request);
  } catch {
    return (await caches.match(request, { ignoreSearch: true })) || Response.error();
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  if (request.mode === 'navigate') {
    event.respondWith(page(request));
  } else if (url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/_next/image') || url.pathname.startsWith('/brand-icon') || url.pathname.startsWith('/signature-') || url.pathname.startsWith('/backdrop-')) {
    event.respondWith(asset(request));
  } else if (!url.searchParams.has('_rsc')) {
    event.respondWith(file(request));
  }
});

// An alert from the server (lib/push-server.ts): { title, body, tag, url }. Shown as sent, with the site's icon;
// a newer alert about the same thing replaces the older one.
self.addEventListener('push', (event) => {
  let note = {};
  try {
    note = event.data ? event.data.json() : {};
  } catch {
    note = { title: 'ShadowCrypts', body: event.data ? event.data.text() : '' };
  }
  // A path on this site only ("/x", never "//other.site/x").
  const url = typeof note.url === 'string' && /^\/(?![/\\])/.test(note.url) ? note.url : '/live';
  event.waitUntil(
    self.registration.showNotification(String(note.title || 'ShadowCrypts').slice(0, 120), {
      body: String(note.body || '').slice(0, 300),
      tag: String(note.tag || 'alert').slice(0, 120),
      icon: '/brand-icon/192',
      badge: '/brand-icon/192',
      data: { url }
    })
  );
});

// Tapping an alert opens its page (live mode for parlays, the game for teams), or brings forward a tab that has it
// open. Only pages on this site.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || '/live', self.location.origin);
  if (target.origin !== self.location.origin) return;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      const open = windows.find((w) => new URL(w.url).pathname === target.pathname);
      return open ? open.focus() : self.clients.openWindow(target.href);
    })
  );
});
