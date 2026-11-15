import { getSettings } from '../lib/catalog.js';

/**
 * Store-wide settings. Contact details, shipping rule and returns come from
 * the site_settings table in Supabase (edit them there); the rest is brand
 * copy.
 */
const s = getSettings();

export const SITE = {
  name: 'CAEN JEWELS',
  tagline: 'Jewellery for your story',
  description: 'Hand-finished fine jewellery in hallmarked gold and certified diamonds — try it on live with your camera.',
  email: s.email,
  phone: s.phone,
  whatsapp: s.whatsapp,
  freeShippingAboveInr: s.freeShippingAboveInr,
  shippingFeeInr: s.shippingFeeInr, // below the free-shipping threshold
  returnDays: s.returnDays,
};
