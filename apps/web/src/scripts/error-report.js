/**
 * Reports errors from customers' browsers to /api/report-error (stored in
 * Supabase: client_errors). No personal data: page path, message, code
 * location, browser. At most 5 distinct reports per page load; errors from
 * browser extensions and other sites' scripts are ignored.
 */
const ENDPOINT = '/api/report-error';
const MAX_PER_PAGE = 5;
const seen = new Set();
let sent = 0;

function send(report) {
  const key = `${report.kind}|${report.message}`;
  if (sent >= MAX_PER_PAGE || seen.has(key)) return;
  seen.add(key);
  sent++;
  const body = JSON.stringify({ reports: [{ ...report, page: location.pathname }] });
  try {
    if (navigator.sendBeacon && navigator.sendBeacon(ENDPOINT, new Blob([body], { type: 'application/json' }))) return;
    fetch(ENDPOINT, { method: 'POST', body, headers: { 'content-type': 'application/json' }, keepalive: true }).catch(() => {});
  } catch {
    // never let reporting itself throw
  }
}

/**
 * Report a handled problem explicitly (e.g. try-on failed to load).
 * @param {'tryon'|'checkout'|'error'} kind
 * @param {unknown} error - Error or message
 */
export function reportError(kind, error) {
  const message = String((error && error.message) || error || 'unknown').slice(0, 500);
  send({ kind, message, stack: error && error.stack ? String(error.stack).slice(0, 2000) : undefined });
}

const ours = (src) => {
  if (!src) return true; // inline/unknown: keep
  try {
    return new URL(src, location.href).origin === location.origin;
  } catch {
    return false;
  }
};
const NOISE = [/^Script error\.?$/i, /ResizeObserver loop/i];

if (typeof window !== 'undefined' && !window.__caenErrorReport) {
  window.__caenErrorReport = true;
  window.addEventListener('error', (e) => {
    const message = e.message || (e.error && e.error.message) || '';
    if (!message || NOISE.some((r) => r.test(message)) || !ours(e.filename)) return;
    send({
      kind: 'error',
      message,
      source: e.filename ? `${new URL(e.filename, location.href).pathname}:${e.lineno}:${e.colno}` : undefined,
      stack: e.error && e.error.stack ? String(e.error.stack) : undefined,
    });
  });
  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason;
    const message = String((r && r.message) || r || '');
    if (!message || NOISE.some((x) => x.test(message))) return;
    if (r && r.stack && /(chrome|moz|safari)-extension:/.test(r.stack)) return;
    send({ kind: 'rejection', message, stack: r && r.stack ? String(r.stack) : undefined });
  });
}
