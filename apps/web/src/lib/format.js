const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });

/** 38500 -> "₹38,500" */
export const formatInr = (n) => inr.format(n);

/**
 * Public path for the current page. With build.format 'file', Astro.url
 * reports the output file (/products/x.html, /index.html); the store's URLs
 * are /products/x and /.
 */
export const publicPath = (pathname) => pathname.replace(/\.html$/, '').replace(/(^|\/)index$/, '$1') || '/';
