/**
 * Order limits and the shipping rule. The amounts (free-shipping threshold,
 * fee) come from site_settings in the database; the storefront shows them
 * and the checkout API charges them.
 */
export const MAX_QTY_PER_LINE = 10;
export const MAX_LINES = 20;

/**
 * @param {number} subtotalInr
 * @param {{freeShippingAboveInr: number, shippingFeeInr: number}} settings
 */
export const shippingFor = (subtotalInr, settings) =>
  (subtotalInr === 0 || subtotalInr >= settings.freeShippingAboveInr ? 0 : settings.shippingFeeInr);
