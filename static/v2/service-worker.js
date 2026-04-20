// Minimal service worker to satisfy PWA install criteria.
// We intentionally don't cache API responses — Helix is a live-data console.
// Static assets (HTML/CSS/JS/SVG) get cache-first; everything else network-first passthrough.

const CACHE = 'helix-console-v1';
const STATIC = [
  '/v2/',
  '/v2/index.html',
  '/v2/debug.html',
  '/v2/_debug-overlay.js',
  '/v2/manifest.json',
  '/v2/icon-192.png',
  '/v2/icon-512.png',
];

self.addEventListener('install', (ev) => {
  ev.waitUntil(caches.open(CACHE).then(c => c.addAll(STATIC).catch(() => null)));
  self.skipWaiting();
});

self.addEventListener('activate', (ev) => {
  ev.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (ev) => {
  const url = new URL(ev.request.url);
  if (url.pathname.startsWith('/api/')) return; // never cache API
  if (ev.request.method !== 'GET') return;

  // Cache-first for our static set; network-first for everything else same-origin.
  if (STATIC.includes(url.pathname)) {
    ev.respondWith(
      caches.match(ev.request).then(hit => hit || fetch(ev.request).then(r => {
        const clone = r.clone();
        caches.open(CACHE).then(c => c.put(ev.request, clone));
        return r;
      }))
    );
  }
});
