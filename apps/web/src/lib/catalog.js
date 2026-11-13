/**
 * The only way pages read the catalogue. Today it serves src/data/catalog.js;
 * Phase 3 swaps the data source for the database without touching pages.
 */
import { CATEGORIES, PRODUCTS, EDITORIAL } from '../data/catalog.js';

const localImages = import.meta.glob('../assets/products/*.webp', { eager: true, import: 'default' });

/** @param {import('../data/catalog.js').ImageRef} ref */
export function resolveImage(ref) {
  if (ref.local) {
    const asset = localImages[`../assets/products/${ref.local}.webp`];
    if (!asset) throw new Error(`Missing image src/assets/products/${ref.local}.webp`);
    return { asset, alt: ref.alt };
  }
  return { src: ref.src, alt: ref.alt };
}

export const getCategories = () => CATEGORIES;
export const getCategory = (slug) => CATEGORIES.find((c) => c.slug === slug) || null;
export const getProducts = ({ category } = {}) => (category ? PRODUCTS.filter((p) => p.category === category) : PRODUCTS);
export const getProduct = (slug) => PRODUCTS.find((p) => p.slug === slug) || null;
export const getProductBySku = (sku) => PRODUCTS.find((p) => p.sku === sku) || null;
export const getEditorial = () => EDITORIAL;

/** Up to `n` other products, same category first. */
export function getRelated(product, n = 4) {
  const same = PRODUCTS.filter((p) => p.slug !== product.slug && p.category === product.category);
  const other = PRODUCTS.filter((p) => p.slug !== product.slug && p.category !== product.category);
  return [...same, ...other].slice(0, n);
}

export const productUrl = (p) => `/products/${p.slug}`;
export const categoryUrl = (c) => `/collections/${typeof c === 'string' ? c : c.slug}`;
export const tryOnUrl = (p) => `/try-on?category=${p.tryOn}&sku=${encodeURIComponent(p.sku)}`;
