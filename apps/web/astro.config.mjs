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

export default defineConfig({
  site: 'https://caen.pages.dev',
  output: 'static',
  build: { inlineStylesheets: 'auto' },
  integrations: [tryOnServiceWorker()],
  vite: {
    plugins: [tailwindcss(), ...(https ? [basicSsl()] : [])],
    // MediaPipe's bundle is large and only needed by try-on: keep it out of
    // dependency pre-bundling so dev starts fast; it is still bundled in builds.
    optimizeDeps: { exclude: ['@mediapipe/tasks-vision'] },
  },
});
