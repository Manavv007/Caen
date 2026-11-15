/**
 * Cloudflare Turnstile widget for checkout (bot check). Loaded only when the
 * build has PUBLIC_TURNSTILE_SITE_KEY; otherwise every function is a no-op
 * and checkout works without it (the server only requires a token when
 * TURNSTILE_SECRET_KEY is set).
 */
const SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

let widgetId = null;
let pending = null; // resolvers waiting for a token

function loadScript() {
  return new Promise((resolve, reject) => {
    if (window.turnstile) return resolve();
    const s = document.createElement('script');
    s.src = SCRIPT;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Could not load the security check. Check your connection and reload the page.'));
    document.head.appendChild(s);
  });
}

/** Renders the widget into `container` (no-op without a site key). */
export async function initTurnstile(container, siteKey) {
  if (!siteKey || !container) return;
  await loadScript();
  widgetId = window.turnstile.render(container, {
    sitekey: siteKey,
    action: 'checkout',
    appearance: 'interaction-only', // invisible unless Cloudflare needs the customer to click
    callback: () => { if (pending) { pending.resolve(window.turnstile.getResponse(widgetId)); pending = null; } },
    'error-callback': () => { if (pending) { pending.reject(new Error('The security check failed. Please reload the page and try again.')); pending = null; } },
  });
}

/** The current token, waiting up to 30 s for the check to finish. Null without a widget. */
export function getTurnstileToken() {
  if (widgetId === null) return Promise.resolve(null);
  const token = window.turnstile.getResponse(widgetId);
  if (token) return Promise.resolve(token);
  return new Promise((resolve, reject) => {
    pending = { resolve, reject };
    setTimeout(() => {
      if (pending) { pending = null; reject(new Error('The security check is taking too long. Please try again.')); }
    }, 30000);
  });
}

/** Tokens are single-use: get a fresh one after every attempt. */
export function resetTurnstile() {
  if (widgetId !== null && window.turnstile) window.turnstile.reset(widgetId);
}
