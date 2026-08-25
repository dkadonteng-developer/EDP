// InfoPort — Service Worker
//
// Bump CACHE_VERSION whenever the HTML/CSS/JS in this site changes.
// Old caches from previous versions are deleted automatically on activate.
const CACHE_VERSION = 'infoport-v2';
const SHELL_CACHE = `${CACHE_VERSION}-shell`;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;

// Same-origin files only. caches.addAll() fails the *entire* install if even
// one request fails, so cross-origin CDN files (Font Awesome, Google Fonts,
// Firebase SDK, jsPDF, pdf.js, SheetJS, equipment manual PDFs, etc.) are
// deliberately left out here and picked up opportunistically at runtime
// instead — see the fetch handler below.
const SHELL_FILES = [
  '/',
  '/index.html',
  '/equipment.html',
  '/inventory.html',
  '/offline.html',
  '/manifest.json',
  '/equipment.json',
  '/assets/logo.png',
  '/assets/icons/icon-192.png',
  '/assets/icons/icon-512.png',
  '/assets/icons/icon-192-maskable.png',
  '/assets/icons/icon-512-maskable.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then((cache) => Promise.all(
        SHELL_FILES.map((url) =>
          cache.add(url).catch((err) => console.warn('[SW] Precache skipped:', url, err))
        )
      ))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(
        names
          .filter((name) => name.startsWith('infoport-') && name !== SHELL_CACHE && name !== RUNTIME_CACHE)
          .map((name) => caches.delete(name))
      ))
      .then(() => self.clients.claim())
  );
});

function isNavigationRequest(request) {
  return request.mode === 'navigate' ||
    (request.method === 'GET' && (request.headers.get('accept') || '').includes('text/html'));
}

// Live Firestore/Auth traffic must never be served from this cache — the
// Firestore SDK has its own offline persistence (enabled separately in each
// page's script) which understands the data far better than a generic
// request/response cache ever could. We just get out of its way entirely.
const LIVE_API_HOSTS = [
  'firestore.googleapis.com',
  'identitytoolkit.googleapis.com',
  'securetoken.googleapis.com',
  'firebaseinstallations.googleapis.com'
];

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (LIVE_API_HOSTS.includes(url.hostname)) return;

  // HTML pages: prefer the network (so people get the latest version when
  // online) but fall back to whatever we last cached, or the offline page,
  // when there's no connection.
  if (isNavigationRequest(request)) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(SHELL_CACHE).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(() =>
          caches.match(request).then((cached) => cached || caches.match('/offline.html'))
        )
    );
    return;
  }

  // Everything else — CDN CSS/JS/fonts, icons, and equipment manual PDFs
  // fetched from Firebase Storage: serve instantly from cache if we have
  // it, and refresh the cache in the background. First-ever request for a
  // file falls through to the network and gets cached for next time.
  event.respondWith(
    caches.match(request).then((cached) => {
      const networkFetch = fetch(request)
        .then((response) => {
          if (response && response.ok) {
            const copy = response.clone();
            caches.open(RUNTIME_CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached);
      return cached || networkFetch;
    })
  );
});
