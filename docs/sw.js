// Offline support: network first so updates arrive promptly, cache as a fallback.
const CACHE = 'bbl-v5';
const SHELL = ['./', './index.html', './app.js', './pinouts.js', './style.css', './manifest.webmanifest',
  './icons/icon-192.png', './icons/icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// Store a copy of a network response. The clone MUST happen synchronously,
// before the original is returned to the page, or its body is already consumed.
function store(e, res) {
  if (!res.ok) return res;
  const copy = res.clone();
  e.waitUntil(caches.open(CACHE).then((c) => c.put(e.request, copy)));
  return res;
}

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  if (e.request.url.startsWith('https://cdn.jsdelivr.net/')) {
    // versioned libraries (HEIC decoder, MathJax): cache first so they keep working offline after the first use
    e.respondWith(caches.match(e.request).then((r) => r || fetch(e.request).then((res) => store(e, res)))
      .catch(() => Response.error()));   // offline and not cached yet: fail quietly, like a normal failed fetch
    return;
  }
  if (!e.request.url.startsWith(self.location.origin)) return;
  e.respondWith(
    fetch(e.request).then((res) => store(e, res))
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match('./index.html')))
  );
});
