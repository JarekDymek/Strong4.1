const CACHE_VERSION = 'v13-sync-conflict-version';
const PRECACHE = `precache-${CACHE_VERSION}`;
const RUNTIME = `runtime-${CACHE_VERSION}`;
const scopeUrl = (path) => new URL(path, self.registration.scope).toString();

const PRECACHE_URLS = [
  '',
  'index.html',
  'judge.html',
  'live.html',
  'manifest.json',
  'version.json',
  'favicon.ico',
  'css/main.css',
  'js/app-config.js',
  'js/checkpointsDb.js',
  'js/cloudSync.js',
  'js/competition.js',
  'js/db-dexie.js',
  'js/domain/scoring.js',
  'js/draw.js',
  'js/eventsDb.js',
  'js/eventsSelector.js',
  'js/focusMode.js',
  'js/handlers.js',
  'js/history.js',
  'js/initialData.js',
  'js/install.js',
  'js/judge.js',
  'js/liveDisplay.js',
  'js/main.js',
  'js/persistence.js',
  'js/pwa.js',
  'js/state.js',
  'js/stopwatch.js',
  'js/trialMode.js',
  'js/ui.js',
  'js/utils.js',
  'images/icon-192.png',
  'images/icon-512.png',
  'images/logo-strong-man.png?v=4'
].map(scopeUrl);

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(PRECACHE).then(cache => cache.addAll(PRECACHE_URLS))
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => ![PRECACHE, RUNTIME].includes(k)).map(k => caches.delete(k))
    )).then(() => self.clients.claim())
  );
});

async function networkFirst(req, timeoutMs = 4000) {
  const cache = await caches.open(RUNTIME);
  try {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeoutMs);
    const response = await fetch(req, { signal: controller.signal });
    clearTimeout(id);
    if (response && response.status === 200 && response.type !== 'opaque') {
      try {
        const responseForCache = response.clone(); // clone early
        cache.put(req, responseForCache).catch(()=>{/* swallow cache write errors */});
      } catch (err) {
        console.warn('Could not clone response for caching', err);
      }
    }
    return response;
  } catch (err) {
    const cached = await cache.match(req);
    if (cached) return cached;
    throw err;
  }
}

self.addEventListener('fetch', event => {
  const req = event.request;

  // Nawigacje SPA -> index.html jako fallback offline
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(() => caches.match(scopeUrl('index.html')))
    );
    return;
  }

  // API/JSON -> network-first
  if (req.url.includes('/api/') || (req.headers.get && req.headers.get('accept')?.includes('application/json'))) {
    event.respondWith(networkFirst(req));
    return;
  }

  // Zasoby statyczne -> cache-first, bezpieczne cachowanie
  event.respondWith(
    caches.match(req).then(cached => {
      if (cached) return cached;
      return fetch(req).then(response => {
        try {
          if (req.method === 'GET' && response && response.status === 200 && response.type !== 'opaque') {
            const forCache = response.clone();
            caches.open(RUNTIME).then(cache => cache.put(req, forCache)).catch(()=>{/* ignore cache errors */});
          }
        } catch (err) {
          console.warn('Cache/store error (ignored):', err);
        }
        return response;
      }).catch(() => {
        if (req.destination === 'image') return caches.match(scopeUrl('images/icon-192.png'));
      });
    })
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
