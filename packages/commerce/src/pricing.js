/**
 * Pricing rules shared by the storefront (display) and the checkout API
 * (what the customer is actually charged). PLACEHOLDER values.
 */
export const FREE_SHIPPING_ABOVE_INR = 10000;
export const SHIPPING_FEE_INR = 250;
export const MAX_QTY_PER_LINE = 10;
export const MAX_LINES = 20;

export const shippingFor = (subtotalInr) => (subtotalInr === 0 || subtotalInr >= FREE_SHIPPING_ABOVE_INR ? 0 : SHIPPING_FEE_INR);
