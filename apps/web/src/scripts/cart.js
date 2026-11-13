/**
 * Shopping bag kept in this browser (localStorage). Items hold only the SKU,
 * chosen options and quantity — prices are always looked up from the
 * catalogue (and re-checked on the server at checkout), never trusted from
 * storage.
 */
const KEY = 'caen.cart.v1';
const MAX_QTY = 10;

/** @typedef {{sku: string, qty: number, options: Record<string,string>}} CartItem */

/** @returns {CartItem[]} */
export function readCart() {
  try {
    const items = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(items) ? items.filter((i) => i && typeof i.sku === 'string' && i.qty > 0) : [];
  } catch {
    return [];
  }
}

/** @param {CartItem[]} items */
function writeCart(items) {
  try {
    localStorage.setItem(KEY, JSON.stringify(items));
  } catch {
    // storage unavailable (private mode): the bag lasts for this page only
  }
  window.dispatchEvent(new CustomEvent('cart:change', { detail: items }));
}

/** Stable identity of a line: same SKU with different options = different line. */
export const lineKey = (item) => `${item.sku}|${Object.entries(item.options || {}).sort().map(([k, v]) => `${k}=${v}`).join('&')}`;

export function addToCart({ sku, options = {}, qty = 1 }) {
  const items = readCart();
  const key = lineKey({ sku, options });
  const existing = items.find((i) => lineKey(i) === key);
  if (existing) existing.qty = Math.min(MAX_QTY, existing.qty + qty);
  else items.push({ sku, options, qty: Math.min(MAX_QTY, qty) });
  writeCart(items);
}

export function setQty(key, qty) {
  const items = readCart()
    .map((i) => (lineKey(i) === key ? { ...i, qty: Math.max(0, Math.min(MAX_QTY, qty)) } : i))
    .filter((i) => i.qty > 0);
  writeCart(items);
}

export const removeLine = (key) => setQty(key, 0);
export const clearCart = () => writeCart([]);
export const cartCount = () => readCart().reduce((n, i) => n + i.qty, 0);

/** Calls fn now and whenever the bag changes (this tab or another). */
export function onCartChange(fn) {
  fn(readCart());
  window.addEventListener('cart:change', (e) => fn(e.detail));
  window.addEventListener('storage', (e) => { if (e.key === KEY) fn(readCart()); });
}
