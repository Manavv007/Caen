/**
 * In-memory stand-in for the subset of Supabase PostgREST, Razorpay and
 * Resend that the handlers use. Pass `backend.fetch` as the fetch impl.
 */
import { PRODUCTS } from '../src/catalog.js';

/** Catalogue rows as stored in Supabase (seeded from the original catalogue). */
export const productRows = () => PRODUCTS.map((p) => ({
  sku: p.sku, slug: p.slug, name: p.name, category: p.category, price_inr: p.priceInr, active: true,
}));
export const settingsRow = () => ({
  id: 1, email: 'shop@example.com', phone: '+91 00000 00000', whatsapp: '910000000000',
  free_shipping_above_inr: 10000, shipping_fee_inr: 250, return_days: 15,
});

export class FakeBackend {
  constructor() {
    this.tables = {
      orders: [], order_items: [], payment_events: [], client_errors: [],
      products: productRows(), site_settings: [settingsRow()], profiles: [],
    };
    /** access token -> user, for /auth/v1/user */
    this.users = { 'token-a': { id: 'user-a', email: 'Buyer@Example.com' } };
    this.deletedUsers = [];
    this.razorpayOrders = [];
    this.emails = [];
    this.nextId = 1;
    this.fetch = this.fetch.bind(this);
  }

  _filters(search) {
    const f = {};
    for (const [k, v] of new URLSearchParams(search)) {
      if (v.startsWith('eq.')) f[k] = { eq: v.slice(3) };
      else if (v.startsWith('in.(')) f[k] = { in: v.slice(4, -1).split(',').map((x) => x.replace(/^"|"$/g, '')) };
    }
    return f;
  }

  _match(row, filters) {
    return Object.entries(filters).every(([k, c]) => (c.in ? c.in.includes(String(row[k])) : String(row[k]) === c.eq));
  }

  async fetch(url, init = {}) {
    const u = new URL(url);
    const method = init.method || 'GET';
    const body = init.body && typeof init.body === 'string' && /^[\[{]/.test(init.body) ? JSON.parse(init.body) : undefined;
    const ok = (data, status = 200) => new Response(data === undefined ? '' : JSON.stringify(data), { status });

    if (u.hostname === 'api.razorpay.com' && u.pathname === '/v1/orders' && method === 'POST') {
      const order = { id: `order_${this.nextId++}`, amount: body.amount, currency: body.currency, receipt: body.receipt, status: 'created' };
      this.razorpayOrders.push(order);
      return ok(order);
    }
    if (u.hostname === 'challenges.cloudflare.com' && u.pathname === '/turnstile/v0/siteverify') {
      const form = new URLSearchParams(init.body);
      this.turnstileCalls = (this.turnstileCalls || 0) + 1;
      return ok({ success: form.get('secret') === 'ts-secret' && form.get('response') === 'good-token' });
    }
    if (u.hostname === 'api.resend.com') {
      this.emails.push(body);
      return ok({ id: `email_${this.nextId++}` });
    }
    if (u.hostname === 'db.test' && u.pathname === '/auth/v1/user') {
      const token = (init.headers.authorization || '').replace('Bearer ', '');
      const user = this.users[token];
      return user ? ok(user) : ok({ message: 'invalid token' }, 401);
    }
    if (u.hostname === 'db.test' && u.pathname.startsWith('/auth/v1/admin/users/') && method === 'DELETE') {
      if (init.headers.authorization !== 'Bearer service-key') return ok({ message: 'unauthorized' }, 401);
      this.deletedUsers.push(decodeURIComponent(u.pathname.split('/').pop()));
      return ok({});
    }
    if (u.hostname === 'db.test' && u.pathname.startsWith('/rest/v1/')) {
      if (init.headers.authorization !== 'Bearer service-key') return ok({ message: 'unauthorized' }, 401);
      const table = this.tables[u.pathname.slice('/rest/v1/'.length)];
      if (!table) return ok({ message: 'no table' }, 404);
      const filters = this._filters(u.search);
      if (method === 'GET') return ok(table.filter((r) => this._match(r, filters)));
      if (method === 'POST') {
        const ignoreDup = (init.headers.prefer || '').includes('ignore-duplicates');
        const merge = (init.headers.prefer || '').includes('merge-duplicates');
        const conflictKey = u.searchParams.get('on_conflict');
        const inserted = [];
        for (const row of body) {
          if (merge && conflictKey) {
            const existing = table.find((r) => r[conflictKey] === row[conflictKey]);
            if (existing) { Object.assign(existing, row); inserted.push(existing); continue; }
            table.push({ ...row }); inserted.push(row); continue;
          }
          if (row.id !== undefined && table.some((r) => r.id === row.id)) {
            if (ignoreDup) continue;
            return ok({ message: 'duplicate key' }, 409);
          }
          const full = { id: row.id ?? `id_${this.nextId++}`, ...row };
          table.push(full);
          inserted.push(full);
        }
        return ok(inserted, 201);
      }
      if (method === 'PATCH') {
        const rows = table.filter((r) => this._match(r, filters));
        rows.forEach((r) => Object.assign(r, body));
        return ok(rows);
      }
    }
    return ok({ message: `unexpected ${method} ${url}` }, 500);
  }
}
