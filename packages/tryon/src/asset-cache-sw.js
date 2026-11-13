/**
 * asset-cache-sw.js  (classic Service Worker, served as /try-on-sw.js)
 *
 * Cache-first for the try-on's heavy, immutable assets, so a second visit
 * starts without downloading ~25–45 MB again:
 *   /mediapipe/<version>/wasm/*         versioned by the tasks-vision release
 *   /mediapipe/models/<name>-v<n>.*     pinned model versions
 *   /models/<name>.<hash>.glb           content-hashed jewellery models
 * Cache-first is safe because a changed file always gets a new URL.
 *
 * Nothing else is touched: no HTML, no navigations, no /_astro/ bundles
 * (those have their own immutable HTTP caching). Responses that are not a
 * plain same-origin 200 (errors, ranges, an HTML fallback page) are never
 * stored.
 *
 * Registered only by the try-on page (asset-cache.js), at scope '/': the
 * MediaPipe files are fetched from inside the vision Web Worker, whose
 * controller is matched by the worker's own URL (/_astro/...), so a narrower
 * scope would miss them. Where the static routing API exists, navigations
 * and every other request bypass this worker without even starting it.
 *
 * When a file gets a new version/hash, older versions of the same file are
 * deleted from the cache as the new one is stored.
 */

const CACHE = 'caen-tryon-assets-v1';
const CACHE_PREFIX = 'caen-tryon-assets-';
const CACHEABLE_PATH = /^\/(mediapipe|models)\//;
/** Upper bound on URLs accepted per warm-up message. */
const MAX_WARM_URLS = 16;

self.addEventListener('install', (event) => {
  self.skipWaiting();
  if (typeof event.addRoutes === 'function') {
    event.waitUntil((async () => {
      try {
        // Only the cached asset paths reach the fetch handler.
        await event.addRoutes({
          condition: { not: { or: [{ urlPattern: '/mediapipe/*' }, { urlPattern: '/models/*' }] } },
          source: 'network',
        });
      } catch {
        try {
          await event.addRoutes({ condition: { requestMode: 'navigate' }, source: 'network' });
        } catch {
          // Static routing unsupported: the fetch handler ignores these anyway.
        }
      }
    })());
  }
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith(CACHE_PREFIX) && key !== CACHE) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

/** @param {Request} request */
function isCacheable(request) {
  if (request.method !== 'GET' || request.mode === 'navigate' || request.headers.has('range')) return false;
  const url = new URL(request.url);
  return url.origin === self.location.origin && CACHEABLE_PATH.test(url.pathname);
}

/** @param {Response} response */
function isStorable(response) {
  return !!response
    && response.status === 200
    && response.type === 'basic'
    && !/text\/html/i.test(response.headers.get('content-type') || '');
}

/** Same file regardless of version/hash, for pruning old versions. */
function fileFamily(pathname) {
  let m = pathname.match(/^\/models\/(.+)\.[0-9a-f]{8,}\.glb$/);
  if (m) return `models/${m[1]}`;
  m = pathname.match(/^\/mediapipe\/models\/(.+)-v\d+\.(\w+)$/);
  if (m) return `mediapipe-models/${m[1]}.${m[2]}`;
  m = pathname.match(/^\/mediapipe\/[^/]+\/wasm\/(.+)$/);
  if (m) return `mediapipe-wasm/${m[1]}`;
  return null;
}

async function store(cache, request, response) {
  const path = new URL(request.url).pathname;
  const family = fileFamily(path);
  if (family) {
    for (const old of await cache.keys()) {
      const oldPath = new URL(old.url).pathname;
      if (oldPath !== path && fileFamily(oldPath) === family) await cache.delete(old);
    }
  }
  await cache.put(request, response);
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (!isCacheable(request)) return; // browser handles it as if there were no service worker
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(request);
    if (hit) return hit;
    const response = await fetch(request);
    if (isStorable(response)) event.waitUntil(store(cache, request, response.clone()).catch(() => {}));
    return response;
  })());
});

/**
 * {type:'warm', urls:[...]} from the try-on page, once everything is loaded:
 * stores files that were fetched before this worker took control (the first
 * visit). They normally come straight from the HTTP cache, so nothing is
 * downloaded twice.
 */
self.addEventListener('message', (event) => {
  const data = event.data;
  if (!data || data.type !== 'warm' || !Array.isArray(data.urls)) return;
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    for (const u of data.urls.slice(0, MAX_WARM_URLS)) {
      if (typeof u !== 'string') continue;
      let request;
      try {
        request = new Request(new URL(u, self.location.origin).href);
      } catch {
        continue;
      }
      if (!isCacheable(request) || await cache.match(request)) continue;
      try {
        const response = await fetch(request);
        if (isStorable(response)) await store(cache, request, response);
      } catch {
        // Offline or gone: try again on the next visit.
      }
    }
  })());
});
