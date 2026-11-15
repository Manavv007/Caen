/**
 * POST /api/report-error — stores browser errors reported by
 * apps/web/src/scripts/error-report.js in Supabase (client_errors).
 *
 * Public endpoint, so it is strict: small bodies only, at most 5 reports per
 * request, fields truncated, unknown kinds dropped. Always answers 204 so a
 * reporting problem never shows up as a second error in the browser.
 */
import { createDb } from './supabase.js';

const MAX_BODY_BYTES = 8_000;
const MAX_REPORTS = 5;
const KINDS = new Set(['error', 'rejection', 'tryon', 'checkout']);
const clip = (v, n) => (typeof v === 'string' ? v.slice(0, n) : null);

/** @returns {Array<Object>} rows ready to insert (possibly empty) */
export function sanitizeReports(body, userAgent) {
  const list = body && Array.isArray(body.reports) ? body.reports.slice(0, MAX_REPORTS) : [];
  return list
    .filter((r) => r && KINDS.has(r.kind) && typeof r.message === 'string' && r.message.trim())
    .map((r) => ({
      kind: r.kind,
      // Path only: query strings could carry anything.
      page: clip(typeof r.page === 'string' ? r.page.split(/[?#]/)[0] : '', 200) || '/',
      message: clip(r.message.trim(), 500),
      source: clip(r.source, 300),
      stack: clip(r.stack, 2000),
      user_agent: clip(userAgent, 300),
    }));
}

const noContent = () => new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });

export async function handleReportError(request, env, { fetch: fetchImpl = fetch } = {}) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return noContent();
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return noContent();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    return noContent();
  }
  const rows = sanitizeReports(body, request.headers.get('user-agent'));
  if (!rows.length) return noContent();
  try {
    await createDb({ url: env.SUPABASE_URL, serviceKey: env.SUPABASE_SERVICE_ROLE_KEY }, fetchImpl).insert('client_errors', rows);
  } catch (err) {
    console.error('report-error insert failed', err);
  }
  return noContent();
}
