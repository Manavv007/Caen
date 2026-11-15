import { getCategories, getProducts, categoryUrl, productUrl } from '../lib/catalog.js';

/** sitemap.xml: every indexable page (bag, checkout and try-on are excluded). */
export function GET({ site }) {
  const paths = [
    '/',
    '/collections',
    ...getCategories().map(categoryUrl),
    ...getProducts().map(productUrl),
    '/shipping-returns',
    '/privacy',
  ];
  const urls = paths.map((p) => `  <url><loc>${new URL(p, site).href}</loc></url>`).join('\n');
  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
  return new Response(body, { headers: { 'content-type': 'application/xml; charset=utf-8' } });
}
