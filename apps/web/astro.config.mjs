// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import basicSsl from '@vitejs/plugin-basic-ssl';

// `HTTPS=1 npm run dev` serves over self-signed HTTPS so phones on the LAN
// can open the camera (getUserMedia needs a secure context off localhost).
const https = process.env.HTTPS === '1';

export default defineConfig({
  site: 'https://caen.pages.dev',
  output: 'static',
  build: { inlineStylesheets: 'auto' },
  vite: {
    plugins: [tailwindcss(), ...(https ? [basicSsl()] : [])],
    // MediaPipe's bundle is large and only needed by try-on: keep it out of
    // dependency pre-bundling so dev starts fast; it is still bundled in builds.
    optimizeDeps: { exclude: ['@mediapipe/tasks-vision'] },
  },
});
