/**
 * asset-cache.js
 *
 * Page side of the try-on asset cache (asset-cache-sw.js, served at
 * SERVICE_WORKER_URL by the host app). Registration failures are ignored:
 * without the service worker everything still loads from the network / HTTP
 * cache as before.
 */

export const SERVICE_WORKER_URL = '/try-on-sw.js';

const supported = () => typeof navigator !== 'undefined' && 'serviceWorker' in navigator
  && typeof window !== 'undefined' && window.isSecureContext;

const isOurs = (reg) => [reg.active, reg.waiting, reg.installing]
  .some((w) => w && new URL(w.scriptURL).pathname === SERVICE_WORKER_URL);

/**
 * @param {{enabled?: boolean}} [opts] - enabled: false unregisters it instead (?sw=0)
 * @returns {Promise<ServiceWorkerRegistration|null>}
 */
export async function registerAssetCache({ enabled = true } = {}) {
  if (!supported()) return null;
  try {
    if (!enabled) {
      for (const reg of await navigator.serviceWorker.getRegistrations()) {
        if (isOurs(reg)) await reg.unregister();
      }
      return null;
    }
    // Scope '/': see asset-cache-sw.js (the vision worker must be controlled too).
    return await navigator.serviceWorker.register(SERVICE_WORKER_URL, { scope: '/' });
  } catch {
    return null;
  }
}

/**
 * Asks the service worker to store files this visit fetched before it was in
 * control (first visit). Same-origin /mediapipe/ and /models/ URLs only; the
 * worker ignores anything else.
 * @param {string[]} urls
 */
export async function warmAssetCache(urls) {
  if (!supported() || !urls.length) return;
  try {
    const reg = await Promise.race([
      navigator.serviceWorker.ready,
      new Promise((resolve) => setTimeout(() => resolve(null), 15000)),
    ]);
    if (reg && reg.active && isOurs(reg)) reg.active.postMessage({ type: 'warm', urls: [...new Set(urls)] });
  } catch {
    // Not fatal: the next visit's fetches populate the cache instead.
  }
}

/** For the debug panel. */
export function assetCacheStatus() {
  if (!supported()) return 'unsupported';
  const c = navigator.serviceWorker.controller;
  return c && new URL(c.scriptURL).pathname === SERVICE_WORKER_URL ? 'controlling' : 'not controlling';
}
