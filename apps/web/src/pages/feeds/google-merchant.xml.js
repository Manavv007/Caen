import { getProducts, getCategory, absoluteImageUrl, productUrl } from '../../lib/catalog.js';
import { SITE } from '../../data/site.js';

/**
 * Google Merchant Center product feed (RSS 2.0 + g: namespace), for free
 * listings on Google Shopping. Add it in Merchant Center as a scheduled
 * fetch of https://<site>/feeds/google-merchant.xml.
 * https://support.google.com/merchants/answer/7052112
 */
const esc = (s) => String(s).replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]);

export function GET({ site }) {
  const items = getProducts().map((p) => {
    const imageUrl = absoluteImageUrl(p.image, site);
    const category = getCategory(p.category);
    return `    <item>
      <g:id>${esc(p.sku)}</g:id>
      <g:title>${esc(p.name)}</g:title>
      <g:description>${esc(p.description)}</g:description>
      <g:link>${esc(new URL(productUrl(p), site).href)}</g:link>
      <g:image_link>${esc(imageUrl)}</g:image_link>
      <g:price>${p.priceInr.toFixed(2)} INR</g:price>
      <g:availability>in_stock</g:availability>
      <g:condition>new</g:condition>
      <g:brand>${esc(SITE.name)}</g:brand>
      <g:identifier_exists>no</g:identifier_exists>
      <g:google_product_category>188</g:google_product_category>
      <g:product_type>${esc(category ? category.name : p.category)}</g:product_type>
    </item>`;
  }).join('\n');
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">
  <channel>
    <title>${esc(SITE.name)}</title>
    <link>${esc(site.href)}</link>
    <description>${esc(SITE.description)}</description>
${items}
  </channel>
</rss>
`;
  return new Response(body, { headers: { 'content-type': 'application/xml; charset=utf-8' } });
}
