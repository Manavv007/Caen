/**
 * Browser side of checkout:
 *   1. POST /api/checkout  {items, customer}
 *        -> {orderNumber, razorpay: {keyId, orderId, amount, currency}}
 *      The server re-prices the bag from the catalogue; browser prices are
 *      never trusted.
 *   2. Razorpay Checkout collects the payment (UPI / card / netbanking / EMI).
 *   3. POST /api/checkout/confirm with Razorpay's signed response; the server
 *      verifies the signature before marking the order paid. (The Razorpay
 *      webhook confirms it independently, in case this request never arrives.)
 */
export const PAYMENTS_UNAVAILABLE = new Error('payments-unavailable');

const RAZORPAY_SCRIPT = 'https://checkout.razorpay.com/v1/checkout.js';

async function postJson(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  // Not deployed / not configured yet.
  if ([404, 405, 501, 503].includes(res.status)) throw PAYMENTS_UNAVAILABLE;
  let data = null;
  try {
    data = await res.json();
  } catch {
    // fall through
  }
  if (!res.ok) throw new Error((data && data.error) || `Request failed (${res.status})`);
  return data;
}

let scriptPromise = null;
function loadRazorpay() {
  if (window.Razorpay) return Promise.resolve();
  if (!scriptPromise) {
    scriptPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = RAZORPAY_SCRIPT;
      s.onload = () => resolve();
      s.onerror = () => {
        scriptPromise = null;
        reject(new Error('Could not load the payment window. Check your connection and try again.'));
      };
      document.head.appendChild(s);
    });
  }
  return scriptPromise;
}

/**
 * @param {{items: Array, customer: Object}} order
 * @returns {Promise<{orderNumber: string}>} resolves once payment is verified
 */
export async function startPayment({ items, customer }) {
  const created = await postJson('/api/checkout', { items, customer });
  await loadRazorpay();

  const payment = await new Promise((resolve, reject) => {
    const rzp = new window.Razorpay({
      key: created.razorpay.keyId,
      order_id: created.razorpay.orderId,
      amount: created.razorpay.amount,
      currency: created.razorpay.currency,
      name: 'CAEN JEWELS',
      description: `Order ${created.orderNumber}`,
      prefill: { name: customer.name, email: customer.email, contact: `+91${customer.phone}` },
      theme: { color: '#1a1a1a' },
      handler: resolve,
      modal: { ondismiss: () => reject(new Error('Payment was cancelled. Your bag is saved — you can try again.')) },
    });
    rzp.on('payment.failed', (r) => reject(new Error((r.error && r.error.description) || 'Payment failed. Please try again.')));
    rzp.open();
  });

  return postJson('/api/checkout/confirm', { orderNumber: created.orderNumber, ...payment });
}
