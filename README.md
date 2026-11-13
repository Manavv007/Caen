# CAEN Jewels

Jewellery storefront with on-device AR try-on (rings, earrings, necklaces, nose rings).
See [PLAN.md](PLAN.md) for the production plan and its progress.

## Layout

| Path | What |
|---|---|
| `apps/web` | Astro site (deploys to Cloudflare Pages): storefront pages in `src/pages`, catalogue in `src/data/catalog.js` (placeholder data until the database), try-on at `src/pages/try-on.astro`. |
| `packages/tryon` | Try-on engine: MediaPipe tracking, solvers (pure, testable), three.js scenes. |
| `assets-src/models` | Source 3D models (glTF + licences). Not shipped directly. |
| `scripts/build-models.mjs` | Compresses source models to small `.glb` files in `apps/web/public/models` (committed). |
| `scripts/fetch-mediapipe.mjs` | Self-hosts the MediaPipe wasm + pinned models into `apps/web/public/mediapipe` (gitignored, runs before dev/build). |
| `fixtures` | Recorded try-on sessions used by the replay tests. |

## Develop

Needs Node 22.

```bash
npm install
```

```bash
npm run dev
```

Open http://localhost:4321 for the store, or http://localhost:4321/try-on?category=ring (also `earring`, `necklace`, `nose`).

- `&debug=1`: landmark overlay, session recorder, and a "Debug details" panel with tracking fps, dropped frames, worker vs main-thread mode and quality tier.
- `&vision=main`: run tracking on the main thread instead of the Web Worker (to compare smoothness).

To test on a phone on the same Wi-Fi, the camera needs HTTPS:

```bash
HTTPS=1 npm run dev
```

Other commands:

```bash
npm test          # replay recorded sessions through the solvers
npm run build     # production build -> apps/web/dist
npm run models    # re-compress models after changing assets-src/models
```

## Deploy (Cloudflare Pages, free)

Connect the GitHub repo in the Cloudflare dashboard → Workers & Pages → Create → Pages → Connect to Git, with:

- Build command: `npm run build`
- Build output directory: `apps/web/dist`
- Environment variable: `NODE_VERSION=22`

Caching and security headers come from `apps/web/public/_headers`.
