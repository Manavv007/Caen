/** robots.txt: index the store, not the bag/checkout/API. */
export function GET({ site }) {
  const body = [
    'User-agent: *',
    'Disallow: /cart',
    'Disallow: /checkout',
    'Disallow: /order/',
    'Disallow: /account',
    'Disallow: /api/',
    '',
    `Sitemap: ${new URL('/sitemap.xml', site).href}`,
    '',
  ].join('\n');
  return new Response(body, { headers: { 'content-type': 'text/plain; charset=utf-8' } });
}
