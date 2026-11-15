// @ts-check
import { copyFile, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import basicSsl from '@vitejs/plugin-basic-ssl';

// `HTTPS=1 npm run dev` serves over self-signed HTTPS so phones on the LAN
// can open the camera (getUserMedia needs a secure context off localhost).
const https = process.env.HTTPS === '1';

/**
 * Serves the try-on asset-cache service worker (packages/tryon) at a fixed,
 * unhashed URL, /try-on-sw.js, in dev and in the build output. A service
 * worker's URL must stay stable, so it can't go through the hashed bundle.
 * @returns {import('astro').AstroIntegration}
 */
function tryOnServiceWorker() {
  const src = fileURLToPath(new URL('../../packages/tryon/src/asset-cache-sw.js', import.meta.url));
  const route = '/try-on-sw.js';
  return {
    name: 'caen-try-on-service-worker',
    hooks: {
      'astro:server:setup': ({ server }) => {
        server.middlewares.use(async (req, res, next) => {
          if (!req.url || req.url.split('?')[0] !== route) return next();
          try {
            res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
            res.setHeader('Cache-Control', 'no-cache');
            res.end(await readFile(src));
          } catch (err) {
            next(err);
          }
        });
      },
      'astro:build:done': async ({ dir }) => {
        await copyFile(src, fileURLToPath(new URL(`.${route}`, dir)));
      },
    },
  };
}

// Public address of the store: canonical links, sitemap, product feed.
// Set SITE_URL in Cloudflare Pages (Variables) when a custom domain is added.
const site = process.env.SITE_URL || 'https://caen-4kj.pages.dev';

export default defineConfig({
  site,
  output: 'static',
  // /products/x served as products/x.html: no redirect to /products/x/ on Cloudflare.
  build: { inlineStylesheets: 'auto', format: 'file' },
  trailingSlash: 'never',
  integrations: [tryOnServiceWorker()],
  vite: {
    // Never inline scripts/assets: the CSP (public/_headers) allows only files from this origin.
    build: { assetsInlineLimit: 0 },
    plugins: [tailwindcss(), ...(https ? [basicSsl()] : [])],
    // MediaPipe's bundle is large and only needed by try-on: keep it out of
    // dependency pre-bundling so dev starts fast; it is still bundled in builds.
    optimizeDeps: { exclude: ['@mediapipe/tasks-vision'] },
  },
});
