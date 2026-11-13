import { FREE_SHIPPING_ABOVE_INR, SHIPPING_FEE_INR } from '@caen/commerce/pricing.js';

/**
 * Store-wide settings and contact details. PLACEHOLDERS from the design
 * mockups: replace with the real ones before launch.
 */
export const SITE = {
  name: 'CAEN JEWELS',
  tagline: 'Jewellery for your story',
  description: 'Hand-finished fine jewellery in hallmarked gold and certified diamonds — try it on live with your camera.',
  email: 'salon@caenjewel.com',
  phone: '+91 22 4589 0000',
  whatsapp: '912245890000',
  freeShippingAboveInr: FREE_SHIPPING_ABOVE_INR,
  shippingFeeInr: SHIPPING_FEE_INR, // below the free-shipping threshold
  returnDays: 15,
};
