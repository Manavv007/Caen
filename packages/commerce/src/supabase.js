/**
 * Minimal Supabase (PostgREST) client for the server, using the service-role
 * key. Never ship this key to the browser.
 */
export function createDb({ url, serviceKey }, fetchImpl = fetch) {
  const base = `${url.replace(/\/$/, '')}/rest/v1`;
  const headers = (extra = {}) => ({
    apikey: serviceKey,
    authorization: `Bearer ${serviceKey}`,
    'content-type': 'application/json',
    ...extra,
  });
  const qs = (filters = {}) => Object.entries(filters).map(([k, v]) => `${encodeURIComponent(k)}=eq.${encodeURIComponent(v)}`).join('&');

  async function call(method, path, { body, prefer } = {}) {
    const res = await fetchImpl(`${base}/${path}`, {
      method,
      headers: headers(prefer ? { prefer } : {}),
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Supabase ${method} ${path.split('?')[0]}: HTTP ${res.status} ${await res.text()}`);
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  }

  return {
    /** @returns {Promise<Object[]>} inserted rows */
    insert: (table, rows) => call('POST', table, { body: rows, prefer: 'return=representation' }),
    /** Inserts, silently skipping rows whose primary key exists. @returns {Promise<Object[]>} rows actually inserted */
    insertIgnoringDuplicates: (table, rows, onConflict) =>
      call('POST', `${table}?on_conflict=${encodeURIComponent(onConflict)}`, { body: rows, prefer: 'resolution=ignore-duplicates,return=representation' }),
    /** @returns {Promise<Object[]>} updated rows */
    update: (table, filters, patch) => call('PATCH', `${table}?${qs(filters)}`, { body: patch, prefer: 'return=representation' }),
    /** @returns {Promise<Object[]>} */
    select: (table, filters, columns = '*') => call('GET', `${table}?select=${encodeURIComponent(columns)}&${qs(filters)}`),
  };
}
