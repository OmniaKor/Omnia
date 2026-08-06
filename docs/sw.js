/**
 * sw.js — offline support.
 *
 * A basement gym with no signal is a normal place to do this workout, so the
 * app shell is precached and exercise photographs are kept after their first
 * view. Nothing here is required for Omnia to work; if registration fails the
 * app simply needs a connection.
 *
 * Bump CACHE when shipping changed assets — the old cache is dropped on
 * activate, which is the whole update mechanism.
 */

const CACHE = 'omnia-v1';

const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './assets/css/omnia.css',
  './assets/img/hero.svg',
  './assets/img/icon.svg',
  './assets/data/exercises.json',
  './assets/data/routines.json',
  './assets/js/app.js',
  './assets/js/calendar.js',
  './assets/js/catalog.js',
  './assets/js/player.js',
  './assets/js/routines.js',
  './assets/js/store.js',
  './assets/js/timer.js',
  './assets/js/ui.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    // addAll is all-or-nothing, and one 404 would leave the app with no cache
    // at all. Each asset is added on its own so a single miss costs only itself.
    caches.open(CACHE).then((cache) =>
      Promise.all(SHELL.map((url) => cache.add(url).catch(() => {})))
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Exercise photographs: cache-first and kept. They are pinned to an immutable
  // upstream commit, so a cached copy can never be stale.
  if (url.hostname === 'cdn.jsdelivr.net' && url.pathname.includes('free-exercise-db')) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // Everything else same-origin: network-first, falling back to the cache, so
  // a push deploys immediately when there is a connection.
  if (url.origin === location.origin) {
    event.respondWith(networkFirst(request));
  }
});

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok || response.type === 'opaque') {
      (await caches.open(CACHE)).put(request, response.clone());
    }
    return response;
  } catch {
    return Response.error();
  }
}

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      (await caches.open(CACHE)).put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    // A navigation with nothing cached still has to land somewhere real.
    return cached || caches.match('./index.html') || Response.error();
  }
}
