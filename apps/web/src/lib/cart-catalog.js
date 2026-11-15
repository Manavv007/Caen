import { getImage } from 'astro:assets';
import { getProducts, resolveImage, productUrl } from './catalog.js';
import { SITE } from '../data/site.js';

/**
 * The slice of the catalogue the bag/checkout pages need in the browser,
 * keyed by SKU, plus the shipping rule. Embedded in those pages as JSON.
 * totals shown there are sent as expectedTotalInr so checkout can refuse if
 * prices changed since this build.
 */
export async function cartCatalog() {
  const products = {};
  for (const p of getProducts()) {
    const img = resolveImage(p.image);
    const image = img.remote ? (await getImage({ src: img.src, inferSize: true, width: 200, format: 'webp' })).src : img.src;
    products[p.sku] = { name: p.name, url: productUrl(p), priceInr: p.priceInr, label: p.label, image };
  }
  return { products, freeShippingAboveInr: SITE.freeShippingAboveInr, shippingFeeInr: SITE.shippingFeeInr };
}
