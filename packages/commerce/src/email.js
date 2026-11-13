const inr = (n) => `₹${Number(n).toLocaleString('en-IN')}`;
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/**
 * Order confirmation to the customer (+ a copy to the store), via Resend.
 * Optional: skipped unless RESEND_API_KEY and ORDER_EMAIL_FROM are set.
 * Never throws — a failed email must not fail a paid order.
 */
export async function sendOrderConfirmation(env, order, items, fetchImpl = fetch) {
  if (!env.RESEND_API_KEY || !env.ORDER_EMAIL_FROM) return { skipped: true };
  const rows = items.map((i) => `<tr><td>${esc(i.name)}${i.options && Object.keys(i.options).length ? ` <small>(${esc(Object.values(i.options).join(' · '))})</small>` : ''} × ${i.qty}</td><td align="right">${inr(i.line_total_inr)}</td></tr>`).join('');
  const html = `<p>Dear ${esc(order.customer_name)},</p>
<p>Thank you for your order <strong>#${esc(order.order_number)}</strong>. Your payment is confirmed; we'll email tracking details once it ships.</p>
<table cellpadding="6" style="border-collapse:collapse">${rows}
<tr><td>Shipping</td><td align="right">${order.shipping_inr ? inr(order.shipping_inr) : 'Free'}</td></tr>
<tr><td><strong>Total paid</strong></td><td align="right"><strong>${inr(order.total_inr)}</strong></td></tr></table>
<p>Delivering to: ${esc(order.address1)}${order.address2 ? `, ${esc(order.address2)}` : ''}, ${esc(order.city)}, ${esc(order.state)} ${esc(order.pincode)}</p>
<p>— CAEN JEWELS</p>`;
  try {
    const res = await fetchImpl('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        from: env.ORDER_EMAIL_FROM,
        to: [order.email],
        bcc: env.ORDER_NOTIFY_EMAIL ? [env.ORDER_NOTIFY_EMAIL] : undefined,
        subject: `Order #${order.order_number} confirmed — CAEN JEWELS`,
        html,
      }),
    });
    return { ok: res.ok, status: res.status };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}
