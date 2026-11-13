import { lineKey } from './cart.js';

const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
export const formatInr = (n) => inr.format(n);

/** Reads the catalogue JSON a page embeds with id="cart-catalog". */
export function readCatalog() {
  return JSON.parse(document.getElementById('cart-catalog').textContent);
}

/**
 * Prices bag items from the catalogue (unknown SKUs are dropped).
 * @returns {{lines: Array, subtotal: number, shipping: number, total: number, count: number}}
 */
export function priceCart(items, catalog) {
  const lines = items
    .filter((i) => catalog.products[i.sku])
    .map((i) => {
      const p = catalog.products[i.sku];
      return { key: lineKey(i), ...i, product: p, lineTotal: p.priceInr * i.qty };
    });
  const subtotal = lines.reduce((s, l) => s + l.lineTotal, 0);
  const shipping = subtotal === 0 || subtotal >= catalog.freeShippingAboveInr ? 0 : catalog.shippingFeeInr;
  return { lines, subtotal, shipping, total: subtotal + shipping, count: lines.reduce((n, l) => n + l.qty, 0) };
}

export const optionsText = (options) => Object.values(options || {}).join(' · ');

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export { esc };
