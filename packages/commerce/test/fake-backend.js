/**
 * In-memory stand-in for the subset of Supabase PostgREST, Razorpay and
 * Resend that the handlers use. Pass `backend.fetch` as the fetch impl.
 */
export class FakeBackend {
  constructor() {
    this.tables = { orders: [], order_items: [], payment_events: [] };
    this.razorpayOrders = [];
    this.emails = [];
    this.nextId = 1;
    this.fetch = this.fetch.bind(this);
  }

  _filters(search) {
    const f = {};
    for (const [k, v] of new URLSearchParams(search)) if (v.startsWith('eq.')) f[k] = v.slice(3);
    return f;
  }

  _match(row, filters) {
    return Object.entries(filters).every(([k, v]) => String(row[k]) === v);
  }

  async fetch(url, init = {}) {
    const u = new URL(url);
    const method = init.method || 'GET';
    const body = init.body ? JSON.parse(init.body) : undefined;
    const ok = (data, status = 200) => new Response(data === undefined ? '' : JSON.stringify(data), { status });

    if (u.hostname === 'api.razorpay.com' && u.pathname === '/v1/orders' && method === 'POST') {
      const order = { id: `order_${this.nextId++}`, amount: body.amount, currency: body.currency, receipt: body.receipt, status: 'created' };
      this.razorpayOrders.push(order);
      return ok(order);
    }
    if (u.hostname === 'api.resend.com') {
      this.emails.push(body);
      return ok({ id: `email_${this.nextId++}` });
    }
    if (u.hostname === 'db.test' && u.pathname.startsWith('/rest/v1/')) {
      if (init.headers.authorization !== 'Bearer service-key') return ok({ message: 'unauthorized' }, 401);
      const table = this.tables[u.pathname.slice('/rest/v1/'.length)];
      if (!table) return ok({ message: 'no table' }, 404);
      const filters = this._filters(u.search);
      if (method === 'GET') return ok(table.filter((r) => this._match(r, filters)));
      if (method === 'POST') {
        const ignoreDup = (init.headers.prefer || '').includes('ignore-duplicates');
        const inserted = [];
        for (const row of body) {
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
