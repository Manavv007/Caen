import { hmacSha256Hex, timingSafeEqual } from './crypto.js';

const API = 'https://api.razorpay.com/v1';

/**
 * Creates a Razorpay order (https://razorpay.com/docs/api/orders/create/).
 * @returns {Promise<{id: string, amount: number, currency: string}>}
 */
export async function createRazorpayOrder({ keyId, keySecret, amountPaise, receipt, notes }, fetchImpl = fetch) {
  const res = await fetchImpl(`${API}/orders`, {
    method: 'POST',
    headers: {
      authorization: `Basic ${btoa(`${keyId}:${keySecret}`)}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ amount: amountPaise, currency: 'INR', receipt, notes }),
  });
  if (!res.ok) throw new Error(`Razorpay order create failed: HTTP ${res.status} ${await res.text()}`);
  return res.json();
}

/** Checkout handler response: signature = HMAC(order_id|payment_id, key_secret). */
export async function verifyPaymentSignature({ orderId, paymentId, signature, keySecret }) {
  const expected = await hmacSha256Hex(keySecret, `${orderId}|${paymentId}`);
  return timingSafeEqual(expected, signature);
}

/** Webhook: X-Razorpay-Signature = HMAC(raw body, webhook secret). */
export async function verifyWebhookSignature({ rawBody, signature, webhookSecret }) {
  const expected = await hmacSha256Hex(webhookSecret, rawBody);
  return timingSafeEqual(expected, signature);
}
