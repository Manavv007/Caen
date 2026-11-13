import { beforeEach, describe, expect, it } from 'vitest';
import { handleCheckout, handleConfirm, handleWebhook } from '../src/handlers.js';
import { hmacSha256Hex } from '../src/crypto.js';
import { FakeBackend } from './fake-backend.js';

const ENV = {
  RAZORPAY_KEY_ID: 'rzp_test_key',
  RAZORPAY_KEY_SECRET: 'key-secret',
  RAZORPAY_WEBHOOK_SECRET: 'hook-secret',
  SUPABASE_URL: 'https://db.test',
  SUPABASE_SERVICE_ROLE_KEY: 'service-key',
  RESEND_API_KEY: 're_test',
  ORDER_EMAIL_FROM: 'orders@caen.test',
};

const CUSTOMER = {
  name: 'Test Buyer', email: 'Buyer@Example.com', phone: '9876543210',
  address1: '12 MG Road', city: 'Pune', state: 'Maharashtra', pincode: '411001',
};

const post = (path, body, headers = {}) =>
  new Request(`https://shop.test${path}`, { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body), headers });

let backend;
beforeEach(() => { backend = new FakeBackend(); });

async function checkout(items, customer = CUSTOMER, env = ENV) {
  const res = await handleCheckout(post('/api/checkout', { items, customer }), env, { fetch: backend.fetch });
  return { status: res.status, data: await res.json() };
}

async function paySignature(orderId, paymentId) {
  return hmacSha256Hex(ENV.RAZORPAY_KEY_SECRET, `${orderId}|${paymentId}`);
}

describe('POST /api/checkout', () => {
  it('answers 503 until payments are configured (storefront then offers WhatsApp)', async () => {
    const { status } = await checkout([{ sku: 'CELESTE-SOLITAIRE-RING', qty: 1 }], CUSTOMER, {});
    expect(status).toBe(503);
  });

  it('prices from the catalogue, ignoring any price the browser sends', async () => {
    const { status, data } = await checkout([
      { sku: 'CELESTE-SOLITAIRE-RING', qty: 2, priceInr: 1, options: { size: 'US 6', metal: '18K Yellow Gold', evil: 'x' } },
      { sku: 'GOLD-NECKLACE-CHAIN', qty: 1 },
    ]);
    expect(status).toBe(200);
    const order = backend.tables.orders[0];
    expect(order).toMatchObject({ subtotal_inr: 106800, shipping_inr: 0, total_inr: 106800, status: 'pending', email: 'buyer@example.com' });
    expect(backend.razorpayOrders[0]).toMatchObject({ amount: 10680000, currency: 'INR', receipt: data.orderNumber });
    expect(data.razorpay).toEqual({ keyId: 'rzp_test_key', orderId: backend.razorpayOrders[0].id, amount: 10680000, currency: 'INR' });
    expect(order.razorpay_order_id).toBe(data.razorpay.orderId);
    expect(backend.tables.order_items.map((i) => [i.sku, i.qty, i.unit_price_inr, i.options])).toEqual([
      ['CELESTE-SOLITAIRE-RING', 2, 38500, { size: 'US 6', metal: '18K Yellow Gold' }],
      ['GOLD-NECKLACE-CHAIN', 1, 29800, {}],
    ]);
  });

  it('adds shipping below the free-shipping threshold', async () => {
    await checkout([{ sku: 'POINTY-NOSE-RING', qty: 1 }]);
    expect(backend.tables.orders[0]).toMatchObject({ subtotal_inr: 4500, shipping_inr: 250, total_inr: 4750 });
  });

  it.each([
    [[], CUSTOMER, 'empty'],
    [[{ sku: 'NOPE', qty: 1 }], CUSTOMER, 'unknown sku'],
    [[{ sku: 'POINTY-NOSE-RING', qty: 0 }], CUSTOMER, 'zero qty'],
    [[{ sku: 'POINTY-NOSE-RING', qty: 11 }], CUSTOMER, 'qty over limit'],
    [[{ sku: 'POINTY-NOSE-RING', qty: 1 }], { ...CUSTOMER, phone: '12345' }, 'bad phone'],
    [[{ sku: 'POINTY-NOSE-RING', qty: 1 }], { ...CUSTOMER, pincode: '01234' }, 'bad pincode'],
    [[{ sku: 'POINTY-NOSE-RING', qty: 1 }], { ...CUSTOMER, email: 'nope' }, 'bad email'],
  ])('rejects invalid input (%#: %s)', async (items, customer) => {
    const { status, data } = await checkout(items, customer);
    expect(status).toBe(400);
    expect(typeof data.error).toBe('string');
    expect(backend.tables.orders).toHaveLength(0);
    expect(backend.razorpayOrders).toHaveLength(0);
  });

  it('rejects malformed JSON', async () => {
    const res = await handleCheckout(post('/api/checkout', '{nope'), ENV, { fetch: backend.fetch });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/checkout/confirm', () => {
  it('marks the order paid on a valid signature, once, and emails once', async () => {
    const { data } = await checkout([{ sku: 'CELESTE-SOLITAIRE-RING', qty: 1 }]);
    const orderId = data.razorpay.orderId;
    const body = { orderNumber: data.orderNumber, razorpay_order_id: orderId, razorpay_payment_id: 'pay_1', razorpay_signature: await paySignature(orderId, 'pay_1') };

    const res = await handleConfirm(post('/api/checkout/confirm', body), ENV, { fetch: backend.fetch });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ orderNumber: data.orderNumber });
    expect(backend.tables.orders[0]).toMatchObject({ status: 'paid', razorpay_payment_id: 'pay_1' });
    expect(backend.emails).toHaveLength(1);
    expect(backend.emails[0].to).toEqual(['buyer@example.com']);

    // Replay: still paid, no second email.
    const again = await handleConfirm(post('/api/checkout/confirm', body), ENV, { fetch: backend.fetch });
    expect(again.status).toBe(200);
    expect(backend.emails).toHaveLength(1);
  });

  it('rejects a forged signature and leaves the order pending', async () => {
    const { data } = await checkout([{ sku: 'CELESTE-SOLITAIRE-RING', qty: 1 }]);
    const body = { orderNumber: data.orderNumber, razorpay_order_id: data.razorpay.orderId, razorpay_payment_id: 'pay_1', razorpay_signature: 'f'.repeat(64) };
    const res = await handleConfirm(post('/api/checkout/confirm', body), ENV, { fetch: backend.fetch });
    expect(res.status).toBe(400);
    expect(backend.tables.orders[0].status).toBe('pending');
  });

  it("rejects a valid signature for a different order", async () => {
    const a = (await checkout([{ sku: 'CELESTE-SOLITAIRE-RING', qty: 1 }])).data;
    const b = (await checkout([{ sku: 'POINTY-NOSE-RING', qty: 1 }])).data;
    // Pay the cheap order, then try to confirm the expensive one with it.
    const body = { orderNumber: a.orderNumber, razorpay_order_id: b.razorpay.orderId, razorpay_payment_id: 'pay_9', razorpay_signature: await paySignature(b.razorpay.orderId, 'pay_9') };
    const res = await handleConfirm(post('/api/checkout/confirm', body), ENV, { fetch: backend.fetch });
    expect(res.status).toBe(404);
    expect(backend.tables.orders.find((o) => o.order_number === a.orderNumber).status).toBe('pending');
  });
});

describe('POST /api/razorpay/webhook', () => {
  async function webhook(event, eventId = 'evt_1', secret = ENV.RAZORPAY_WEBHOOK_SECRET) {
    const raw = JSON.stringify(event);
    const sig = await hmacSha256Hex(secret, raw);
    const res = await handleWebhook(post('/api/razorpay/webhook', raw, { 'x-razorpay-signature': sig, 'x-razorpay-event-id': eventId }), ENV, { fetch: backend.fetch });
    return { status: res.status, data: await res.json() };
  }
  const captured = (orderId, amount, paymentId = 'pay_w1') => ({
    event: 'payment.captured',
    payload: { payment: { entity: { id: paymentId, order_id: orderId, amount, status: 'captured' } } },
  });

  it('marks the order paid, and ignores the same event delivered twice', async () => {
    const { data } = await checkout([{ sku: 'CELESTE-SOLITAIRE-RING', qty: 1 }]);
    expect((await webhook(captured(data.razorpay.orderId, 3850000))).status).toBe(200);
    expect(backend.tables.orders[0].status).toBe('paid');
    expect(backend.emails).toHaveLength(1);

    const dup = await webhook(captured(data.razorpay.orderId, 3850000));
    expect(dup.data).toEqual({ ok: true, duplicate: true });
    expect(backend.tables.payment_events).toHaveLength(1);
    expect(backend.emails).toHaveLength(1);
  });

  it('flags an amount mismatch for review instead of marking paid', async () => {
    const { data } = await checkout([{ sku: 'CELESTE-SOLITAIRE-RING', qty: 1 }]);
    await webhook(captured(data.razorpay.orderId, 100));
    expect(backend.tables.orders[0].status).toBe('needs_review');
    expect(backend.emails).toHaveLength(0);
  });

  it('rejects a bad signature', async () => {
    const { data } = await checkout([{ sku: 'CELESTE-SOLITAIRE-RING', qty: 1 }]);
    const { status } = await webhook(captured(data.razorpay.orderId, 3850000), 'evt_2', 'wrong-secret');
    expect(status).toBe(400);
    expect(backend.tables.orders[0].status).toBe('pending');
    expect(backend.tables.payment_events).toHaveLength(0);
  });

  it('webhook after the browser confirm does not double-process', async () => {
    const { data } = await checkout([{ sku: 'CELESTE-SOLITAIRE-RING', qty: 1 }]);
    const orderId = data.razorpay.orderId;
    await handleConfirm(post('/api/checkout/confirm', { orderNumber: data.orderNumber, razorpay_order_id: orderId, razorpay_payment_id: 'pay_1', razorpay_signature: await paySignature(orderId, 'pay_1') }), ENV, { fetch: backend.fetch });
    await webhook(captured(orderId, 3850000, 'pay_1'), 'evt_3');
    expect(backend.tables.orders[0].status).toBe('paid');
    expect(backend.emails).toHaveLength(1);
  });
});
