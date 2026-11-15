/**
 * The only way pages read the catalogue.
 *
 * Source: the Supabase tables (categories, products, site_settings), read
 * ONCE per build with the public anon key (active rows only). Editing a row
 * in Supabase triggers a rebuild (see supabase/migrations/*_catalog.sql).
 *
 * Without SUPABASE_URL / SUPABASE_ANON_KEY (local dev, CI) the starter
 * catalogue bundled in @caen/commerce/catalog.js is used instead. On
 * Cloudflare (CF_PAGES) a missing or unreachable database FAILS the build,
 * so the live site is never replaced by an empty or stale catalogue.
 */
import { fetchPublicCatalog } from '@caen/commerce/catalog-db.js';
import { CATEGORIES, PRODUCTS, EDITORIAL } from '@caen/commerce/catalog.js';
import { TRYON_SKUS } from '../data/tryon-models.js';

const STARTER_FEATURED = new Set(['celeste-solitaire-ring', 'aurelia-diamond-band', 'mira-diamond-pendant', 'elan-gold-hoops']);
const STARTER_SETTINGS = {
  email: 'salon@caenjewel.com', phone: '+91 22 4589 0000', whatsapp: '912245890000',
  freeShippingAboveInr: 10000, shippingFeeInr: 250, returnDays: 15,
};
const starterImage = (img) => ({ src: img.local ? `/images/products/${img.local}.webp` : img.src, alt: img.alt });

async function load() {
  const { SUPABASE_URL, SUPABASE_ANON_KEY, CF_PAGES } = process.env;
  if (SUPABASE_URL && SUPABASE_ANON_KEY) {
    return { source: 'supabase', ...(await fetchPublicCatalog({ url: SUPABASE_URL, anonKey: SUPABASE_ANON_KEY })) };
  }
  if (CF_PAGES) {
    throw new Error('SUPABASE_URL and SUPABASE_ANON_KEY must be set in Cloudflare Pages (Settings → Variables) to build the store.');
  }
  return {
    source: 'starter',
    categories: CATEGORIES.map((c) => ({ ...c, image: starterImage(c.image) })),
    products: PRODUCTS.map((p) => ({ ...p, image: starterImage(p.image), featured: STARTER_FEATURED.has(p.slug) })),
    settings: STARTER_SETTINGS,
  };
}

const catalog = await load();

// "Try on" only where a 3D model exists for that SKU (data/tryon-models.js).
for (const p of catalog.products) {
  if (p.tryOn && !(TRYON_SKUS[p.tryOn] || []).includes(p.sku)) {
    console.warn(`[catalog] ${p.sku}: try_on '${p.tryOn}' ignored, no 3D model for this SKU (see data/tryon-models.js)`);
    p.tryOn = null;
  }
}
console.log(`[catalog] ${catalog.source}: ${catalog.categories.length} categories, ${catalog.products.length} products`);

/** Supabase Storage URLs are optimised at build time (see ProductImage.astro). */
const STORAGE = process.env.SUPABASE_URL ? new URL(process.env.SUPABASE_URL).host : null;

/**
 * @param {{src: string, alt: string}} ref
 * @returns {{src: string, alt: string, remote: boolean}} remote = optimise at build
 */
export function resolveImage(ref) {
  let remote = false;
  try {
    remote = !!STORAGE && new URL(ref.src).host === STORAGE;
  } catch {
    // site-relative path such as /images/products/x.webp
  }
  return { src: ref.src, alt: ref.alt, remote };
}

/** Absolute URL of an image, for feeds and structured data. */
export const absoluteImageUrl = (ref, site) => new URL(ref.src, site).href;

export const getSettings = () => catalog.settings;
export const getCategories = () => catalog.categories;
export const getCategory = (slug) => catalog.categories.find((c) => c.slug === slug) || null;
export const getProducts = ({ category } = {}) => (category ? catalog.products.filter((p) => p.category === category) : catalog.products);
export const getProduct = (slug) => catalog.products.find((p) => p.slug === slug) || null;
export const getProductBySku = (sku) => catalog.products.find((p) => p.sku === sku) || null;
export const getFeatured = (n = 4) => catalog.products.filter((p) => p.featured).slice(0, n);
export const getEditorial = () => EDITORIAL;

/** Up to `n` other products, same category first. */
export function getRelated(product, n = 4) {
  const same = catalog.products.filter((p) => p.slug !== product.slug && p.category === product.category);
  const other = catalog.products.filter((p) => p.slug !== product.slug && p.category !== product.category);
  return [...same, ...other].slice(0, n);
}

export const productUrl = (p) => `/products/${p.slug}`;
export const categoryUrl = (c) => `/collections/${typeof c === 'string' ? c : c.slug}`;
export const tryOnUrl = (p) => `/try-on?category=${p.tryOn}&sku=${encodeURIComponent(p.sku)}`;
