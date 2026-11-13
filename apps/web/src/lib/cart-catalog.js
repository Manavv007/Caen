import { getProducts, resolveImage, productUrl } from './catalog.js';
import { SITE } from '../data/site.js';

/**
 * The slice of the catalogue the bag/checkout pages need in the browser,
 * keyed by SKU, plus the shipping rule. Embedded in those pages as JSON.
 */
export function cartCatalog() {
  const products = {};
  for (const p of getProducts()) {
    const img = resolveImage(p.image);
    products[p.sku] = {
      name: p.name,
      url: productUrl(p),
      priceInr: p.priceInr,
      label: p.label,
      image: img.asset ? img.asset.src : img.src,
    };
  }
  return { products, freeShippingAboveInr: SITE.freeShippingAboveInr, shippingFeeInr: SITE.shippingFeeInr };
}
