// Offline support: network first so updates arrive promptly, cache as a fallback.
const CACHE = 'bbl-v2';
const SHELL = ['./', './index.html', './app.js', './style.css', './manifest.webmanifest',
  './icons/icon-192.png', './icons/icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  if (e.request.url.startsWith('https://cdn.jsdelivr.net/')) {
    // versioned decoder: cache first so HEIC keeps working offline after the first use
    e.respondWith(caches.match(e.request).then((r) => r || fetch(e.request).then((res) => {
      caches.open(CACHE).then((c) => c.put(e.request, res.clone()));
      return res;
    })));
    return;
  }
  if (!e.request.url.startsWith(self.location.origin)) return;
  e.respondWith(
    fetch(e.request).then((res) => {
      if (res.ok) caches.open(CACHE).then((c) => c.put(e.request, res.clone()));
      return res;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match('./index.html')))
  );
});
