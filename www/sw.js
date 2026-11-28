// Spofy OTA (Over-The-Air) Auto-Update & Offline Cache Service Worker
// Strategy: Network-First for HTML/CSS/JS/Assets so any change pushed to GitHub
// appears on the user's phone immediately upon reopening the app, with full Offline cache fallback!

const CACHE_NAME = 'spofy-ota-cache-v1';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  // Network-first for same-origin app files (HTML, CSS, JS, Bulby sounds & icons)
  const url = new URL(req.url);
  if (url.origin === self.location.origin) {
    event.respondWith(
      fetch(req, { cache: 'no-store' })
        .then((networkRes) => {
          if (networkRes && networkRes.status === 200) {
            const clone = networkRes.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
          }
          return networkRes;
        })
        .catch(() => caches.match(req))
    );
  }
});
