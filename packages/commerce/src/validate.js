import { MAX_LINES, MAX_QTY_PER_LINE } from './pricing.js';

export class ValidationError extends Error {}

const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const ALLOWED_OPTIONS = new Set(['metal', 'size']);

/**
 * Validates and normalises a checkout request body. Throws ValidationError
 * with a customer-safe message.
 * @returns {{items: Array<{sku:string, qty:number, options:Record<string,string>}>, customer: Object}}
 */
export function validateCheckoutRequest(body) {
  if (!body || typeof body !== 'object') throw new ValidationError('Invalid request.');
  const { items, customer } = body;
  if (!Array.isArray(items) || items.length === 0) throw new ValidationError('Your bag is empty.');
  if (items.length > MAX_LINES) throw new ValidationError('Too many items in one order.');

  const cleanItems = items.map((i) => {
    const qty = Number(i && i.qty);
    if (!i || typeof i.sku !== 'string' || !Number.isInteger(qty) || qty < 1 || qty > MAX_QTY_PER_LINE) {
      throw new ValidationError('Your bag has an invalid item. Please refresh and try again.');
    }
    const options = {};
    for (const [k, v] of Object.entries(i.options || {})) {
      if (ALLOWED_OPTIONS.has(k) && typeof v === 'string') options[k] = v.slice(0, 40);
    }
    return { sku: i.sku.slice(0, 60), qty, options };
  });

  const c = customer || {};
  const out = {
    name: str(c.name, 100),
    email: str(c.email, 200).toLowerCase(),
    phone: str(c.phone, 10),
    address1: str(c.address1, 200),
    address2: str(c.address2, 200),
    city: str(c.city, 100),
    state: str(c.state, 60),
    pincode: str(c.pincode, 6),
  };
  if (!out.name) throw new ValidationError('Please enter your name.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(out.email)) throw new ValidationError('Please enter a valid email address.');
  if (!/^[6-9]\d{9}$/.test(out.phone)) throw new ValidationError('Please enter a valid 10-digit mobile number.');
  if (!out.address1 || !out.city || !out.state) throw new ValidationError('Please complete your delivery address.');
  if (!/^[1-9]\d{5}$/.test(out.pincode)) throw new ValidationError('Please enter a valid 6-digit PIN code.');
  return { items: cleanItems, customer: out };
}
