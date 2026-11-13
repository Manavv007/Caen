import { PRODUCTS } from './catalog.js';
import { shippingFor } from './pricing.js';
import { ValidationError } from './validate.js';

const BY_SKU = new Map(PRODUCTS.map((p) => [p.sku, p]));

/**
 * Prices validated items from the catalogue (never from the client).
 * @returns {{lines: Array<{sku,name,unitPriceInr,qty,options,lineTotalInr}>, subtotalInr:number, shippingInr:number, totalInr:number}}
 */
export function priceOrder(items) {
  const lines = items.map((i) => {
    const p = BY_SKU.get(i.sku);
    if (!p) throw new ValidationError('An item in your bag is no longer available. Please refresh your bag.');
    return { sku: p.sku, name: p.name, unitPriceInr: p.priceInr, qty: i.qty, options: i.options, lineTotalInr: p.priceInr * i.qty };
  });
  const subtotalInr = lines.reduce((s, l) => s + l.lineTotalInr, 0);
  const shippingInr = shippingFor(subtotalInr);
  return { lines, subtotalInr, shippingInr, totalInr: subtotalInr + shippingInr };
}

/** Human-friendly unique order number, e.g. CJ-MHX2K9-4F7Q. */
export function newOrderNumber(now = Date.now()) {
  const rand = new Uint8Array(3);
  crypto.getRandomValues(rand);
  const suffix = Array.from(rand, (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 4).toUpperCase();
  return `CJ-${now.toString(36).toUpperCase()}-${suffix}`;
}
