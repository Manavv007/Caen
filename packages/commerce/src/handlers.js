/**
 * Checkout API handlers (Cloudflare Pages Functions call these; see
 * /functions/api). Each takes a Request and the environment, returns a
 * Response, and accepts an injectable fetch for tests.
 *
 * Environment (Cloudflare Pages → Settings → Variables and Secrets):
 *   RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET      required for checkout
 *   RAZORPAY_WEBHOOK_SECRET                   required for the webhook
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   required (orders database)
 *   RESEND_API_KEY, ORDER_EMAIL_FROM, ORDER_NOTIFY_EMAIL   optional (emails)
 * While the required ones are missing, checkout answers 503 and the
 * storefront offers ordering on WhatsApp instead.
 */
import { ValidationError, validateCheckoutRequest } from './validate.js';
import { priceOrder, newOrderNumber } from './order.js';
import { createRazorpayOrder, verifyPaymentSignature, verifyWebhookSignature } from './razorpay.js';
import { createDb } from './supabase.js';
import { sendOrderConfirmation } from './email.js';

const MAX_BODY_BYTES = 20_000;

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

export const checkoutConfigured = (env) =>
  !!(env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET && env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY);

async function readBody(request) {
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) throw new ValidationError('Request too large.');
  return text;
}

async function readJson(request) {
  const text = await readBody(request);
  try {
    return JSON.parse(text);
  } catch {
    throw new ValidationError('Invalid request.');
  }
}

/**
 * Marks the order paid exactly once (only a 'pending' order changes), after
 * checking the amount. Shared by the confirm endpoint and the webhook.
 * @returns {Promise<{order: Object|null, changed: boolean}>}
 */
async function markPaid(db, env, { razorpayOrderId, paymentId, amountPaise }, fetchImpl) {
  const [order] = await db.select('orders', { razorpay_order_id: razorpayOrderId });
  if (!order) return { order: null, changed: false };
  if (amountPaise != null && amountPaise !== order.total_inr * 100) {
    await db.update('orders', { id: order.id, status: 'pending' }, { status: 'needs_review', razorpay_payment_id: paymentId });
    console.error(`order ${order.order_number}: paid ${amountPaise} paise, expected ${order.total_inr * 100}`);
    return { order, changed: false };
  }
  const updated = await db.update('orders', { id: order.id, status: 'pending' }, {
    status: 'paid',
    razorpay_payment_id: paymentId,
    paid_at: new Date().toISOString(),
  });
  if (!updated.length) return { order, changed: false }; // already paid (other path won)
  const items = await db.select('order_items', { order_id: order.id });
  await sendOrderConfirmation(env, updated[0], items, fetchImpl);
  return { order: updated[0], changed: true };
}

/** POST /api/checkout — create the order + Razorpay order. */
export async function handleCheckout(request, env, { fetch: fetchImpl = fetch } = {}) {
  if (!checkoutConfigured(env)) return json({ error: 'Online payment is not available yet.' }, 503);
  let items;
  let customer;
  let priced;
  try {
    ({ items, customer } = validateCheckoutRequest(await readJson(request)));
    priced = priceOrder(items);
  } catch (err) {
    if (err instanceof ValidationError) return json({ error: err.message }, 400);
    throw err;
  }

  const db = createDb({ url: env.SUPABASE_URL, serviceKey: env.SUPABASE_SERVICE_ROLE_KEY }, fetchImpl);
  const orderNumber = newOrderNumber();
  try {
    const [order] = await db.insert('orders', [{
      order_number: orderNumber,
      status: 'pending',
      customer_name: customer.name,
      email: customer.email,
      phone: customer.phone,
      address1: customer.address1,
      address2: customer.address2,
      city: customer.city,
      state: customer.state,
      pincode: customer.pincode,
      subtotal_inr: priced.subtotalInr,
      shipping_inr: priced.shippingInr,
      total_inr: priced.totalInr,
    }]);
    await db.insert('order_items', priced.lines.map((l) => ({
      order_id: order.id,
      sku: l.sku,
      name: l.name,
      unit_price_inr: l.unitPriceInr,
      qty: l.qty,
      options: l.options,
      line_total_inr: l.lineTotalInr,
    })));
    const rp = await createRazorpayOrder({
      keyId: env.RAZORPAY_KEY_ID,
      keySecret: env.RAZORPAY_KEY_SECRET,
      amountPaise: priced.totalInr * 100,
      receipt: orderNumber,
      notes: { order_number: orderNumber },
    }, fetchImpl);
    await db.update('orders', { id: order.id }, { razorpay_order_id: rp.id });
    return json({
      orderNumber,
      razorpay: { keyId: env.RAZORPAY_KEY_ID, orderId: rp.id, amount: rp.amount, currency: rp.currency },
    });
  } catch (err) {
    console.error('checkout failed', err);
    return json({ error: 'Could not start the payment. Please try again in a moment.' }, 502);
  }
}

/** POST /api/checkout/confirm — verify Razorpay's signed checkout response. */
export async function handleConfirm(request, env, { fetch: fetchImpl = fetch } = {}) {
  if (!checkoutConfigured(env)) return json({ error: 'Online payment is not available yet.' }, 503);
  let body;
  try {
    body = await readJson(request);
  } catch (err) {
    return json({ error: err.message }, 400);
  }
  const { orderNumber, razorpay_order_id: orderId, razorpay_payment_id: paymentId, razorpay_signature: signature } = body || {};
  if (![orderNumber, orderId, paymentId, signature].every((v) => typeof v === 'string' && v.length < 200)) {
    return json({ error: 'Invalid payment confirmation.' }, 400);
  }
  if (!(await verifyPaymentSignature({ orderId, paymentId, signature, keySecret: env.RAZORPAY_KEY_SECRET }))) {
    return json({ error: 'Payment could not be verified. If money was deducted, it will be refunded automatically — or contact us.' }, 400);
  }
  const db = createDb({ url: env.SUPABASE_URL, serviceKey: env.SUPABASE_SERVICE_ROLE_KEY }, fetchImpl);
  try {
    const [order] = await db.select('orders', { order_number: orderNumber });
    if (!order || order.razorpay_order_id !== orderId) return json({ error: 'Order not found.' }, 404);
    // The signature proves this payment is for our Razorpay order, whose amount we set.
    await markPaid(db, env, { razorpayOrderId: orderId, paymentId, amountPaise: null }, fetchImpl);
    return json({ orderNumber });
  } catch (err) {
    console.error('confirm failed', err);
    return json({ error: 'Your payment went through, but we could not update the order. We will confirm it by email shortly.' }, 502);
  }
}

/** POST /api/razorpay/webhook — Razorpay's server-to-server confirmation. */
export async function handleWebhook(request, env, { fetch: fetchImpl = fetch } = {}) {
  if (!env.RAZORPAY_WEBHOOK_SECRET || !env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return json({ error: 'not configured' }, 503);
  let raw;
  try {
    raw = await readBody(request);
  } catch {
    return json({ error: 'too large' }, 413);
  }
  const signature = request.headers.get('x-razorpay-signature') || '';
  if (!(await verifyWebhookSignature({ rawBody: raw, signature, webhookSecret: env.RAZORPAY_WEBHOOK_SECRET }))) {
    return json({ error: 'bad signature' }, 400);
  }
  const event = JSON.parse(raw);
  const payment = event.payload && event.payload.payment && event.payload.payment.entity;
  const orderEntity = event.payload && event.payload.order && event.payload.order.entity;
  const razorpayOrderId = (payment && payment.order_id) || (orderEntity && orderEntity.id) || null;
  const paymentId = payment ? payment.id : null;
  const eventId = request.headers.get('x-razorpay-event-id') || `${event.event}:${paymentId || razorpayOrderId}`;

  const db = createDb({ url: env.SUPABASE_URL, serviceKey: env.SUPABASE_SERVICE_ROLE_KEY }, fetchImpl);
  try {
    const inserted = await db.insertIgnoringDuplicates('payment_events', [{
      id: eventId,
      event: event.event,
      razorpay_order_id: razorpayOrderId,
      razorpay_payment_id: paymentId,
      payload: event,
    }], 'id');
    if (!inserted.length) return json({ ok: true, duplicate: true });

    if ((event.event === 'payment.captured' || event.event === 'order.paid') && razorpayOrderId) {
      await markPaid(db, env, { razorpayOrderId, paymentId, amountPaise: payment ? payment.amount : orderEntity.amount_paid }, fetchImpl);
    }
    return json({ ok: true });
  } catch (err) {
    console.error('webhook failed', err);
    return json({ error: 'temporary failure' }, 500); // Razorpay retries
  }
}
