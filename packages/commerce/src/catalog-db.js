/**
 * Catalogue stored in Supabase (tables categories, products, site_settings;
 * see supabase/migrations/20261115010000_catalog.sql).
 *
 * Rows are mapped to the shapes the storefront and checkout use:
 *   Category {slug, name, blurb, image:{src, alt}}
 *   Product  {sku, slug, name, category, priceInr, label, detail,
 *             description, image:{src, alt}, tryOn, featured}
 *   Settings {email, phone, whatsapp, freeShippingAboveInr,
 *             shippingFeeInr, returnDays}
 */

export const mapCategory = (r) => ({
  slug: r.slug, name: r.name, blurb: r.blurb, image: { src: r.image_url, alt: r.image_alt || r.name },
});

export const mapProduct = (r) => ({
  sku: r.sku,
  slug: r.slug,
  name: r.name,
  category: r.category,
  priceInr: r.price_inr,
  label: r.label,
  detail: r.detail,
  description: r.description,
  image: { src: r.image_url, alt: r.image_alt || r.name },
  tryOn: r.try_on || null,
  featured: !!r.featured,
});

export const mapSettings = (r) => ({
  email: r.email,
  phone: r.phone,
  whatsapp: r.whatsapp,
  freeShippingAboveInr: r.free_shipping_above_inr,
  shippingFeeInr: r.shipping_fee_inr,
  returnDays: r.return_days,
});

/**
 * Whole public catalogue (active rows), for the site build. Uses the public
 * anon key: row-level security only returns active rows.
 * @returns {Promise<{categories, products, settings}>}
 */
export async function fetchPublicCatalog({ url, anonKey }, fetchImpl = fetch) {
  const base = `${url.replace(/\/$/, '')}/rest/v1`;
  const get = async (path) => {
    const res = await fetchImpl(`${base}/${path}`, { headers: { apikey: anonKey, authorization: `Bearer ${anonKey}` } });
    if (!res.ok) throw new Error(`Catalogue fetch ${path.split('?')[0]}: HTTP ${res.status} ${await res.text()}`);
    return res.json();
  };
  const [cats, prods, settings] = await Promise.all([
    get('categories?select=*&active=eq.true&order=sort.asc,name.asc'),
    get('products?select=*&active=eq.true&order=sort.asc,name.asc'),
    get('site_settings?select=*&id=eq.1'),
  ]);
  if (!settings.length) throw new Error('site_settings row is missing');
  const categories = cats.map(mapCategory);
  const known = new Set(categories.map((c) => c.slug));
  return {
    categories,
    // A product whose category is hidden isn't reachable: leave it out.
    products: prods.map(mapProduct).filter((p) => known.has(p.category)),
    settings: mapSettings(settings[0]),
  };
}
