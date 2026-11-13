# CAEN Jewels — Production Plan (fast, low-latency, near-free)

## Context
Today CAEN is a prototype: static Stitch-generated pages (`desktop.html`, `mobile.html`, `product.html`, `index.html`) that load Tailwind's **runtime CDN script**, plus ~5k lines of in-browser AR try-on (`try-on/*.js`, MediaPipe Tasks + three.js) served by a local Node dev server (`server.mjs`, `Cache-Control: no-cache`). No backend, cart, or checkout. Products and try-on settings are hardcoded in `try-on/try-on.html`. The old `PLAN.md` targets Medusa on AWS (not cheap).

Goal: a production site, Indian audience, that loads fast, keeps try-on smooth (**≥24fps on ₹10–15k Android**), and runs on free tiers / pay-per-use.

Decisions (confirmed): **Supabase + Cloudflare Pages Functions** backend · **Astro + Vite** storefront · **budget-Android ≥24fps** target · **Razorpay Standard Checkout** at v1 (fixed SKU prices; live gold rate later).

## Progress (2026-11-13)
**Done — Phase 0 + Phase 1 quick wins (items 1, 5, 8):**
- Monorepo: `apps/web` (Astro 7 + Tailwind 4, no runtime CDN), `packages/tryon`, `assets-src`, `fixtures`, `scripts`. Old dev server removed.
- Try-on page ported to `/try-on`, fonts self-hosted (Latin subset), Material Symbols inlined as SVG. Legacy pages served as-is from `apps/web/public` until Phase 2.
- **Fully self-hosted:** MediaPipe bundle + wasm from npm, models pinned to `/1/` and sha256-checked, three.js bundled. Zero third-party requests on `/try-on` (verified in Chromium); strict CSP in `_headers` verified not to break tracking.
- **Renderer:** `preserveDrawingBuffer` off (on only with `?debug=1`), `powerPreference: 'high-performance'`, one shared factory (`three-runtime.js`). Debug recorder lazy-loaded.
- **Models:** ring 3.9 MB → 219 KB, earrings 3.0 MB → 590 KB, necklace 2.0 MB → 307 KB, nose ring 1.2 MB → 134 KB (Meshopt + WebP, content-hashed, immutable cache). Renders compared against the originals pixel-wise. Fixed a necklace normals bug that compressed geometry exposed.
- **Tests/CI:** solver replay snapshot tests on the recorded sessions; GitHub Actions runs tests, build and model size budgets.

**Done — Phase 1 step 2 (2026-11-13):**
- **Sizing bug fixed (likely a big part of the lag):** every scene passed device pixels to `renderer.setSize()`, which applies the pixel ratio again. The overlay rendered at 2.25× per side (≈5× the pixels) at the 1.5 cap and its WebGL buffer was reallocated on every frame. Now `syncRendererSize()` in `three-runtime.js`; verified 0 reallocations.
- **Tracking in a Web Worker** (`vision-worker.js`, `vision-client.js`), same tracker modules and options; automatic fallback to the main thread (`?vision=main` forces it for A/B). Fixed MediaPipe's module-mode "ModuleFactory not set" when a worker loads two models.
- **One scheduler** (`frame-scheduler.js`): detection once per camera frame via requestVideoFrameCallback, one in flight, frames dropped not queued. Necklace runs pose on every other frame.
- Ring skin measurement uses the exact frame the landmarks came from (ImageBitmap kept alongside the one sent to the worker).
- **Quality tiers** (`perf-governor.js`): pixel-ratio cap from device hints, steps down after 2 s under 20 fps.
- Tracking models + jewellery model start downloading while the camera permission prompt is open.
- `?debug=1` shows vision mode, delegates, tracking fps, dropped frames, worker ms, tier.

**Still to do from Phase 1:** extrapolation between detections (3), cheaper segmentation (4), shared PMREM / render-on-demand (rest of 5), service worker cache (7), telemetry (10), three.js tree-shaking (~174 KB gzip now).

**Done — Phase 2 + 3 (storefront & checkout, 2026-11-13):**
- Astro storefront replacing the prototype pages: home, collections, product pages (options, try-on button where a 3D model matches, Product JSON-LD), bag, checkout, order confirmation, draft privacy and shipping pages. Under 2.2 KB gzipped JS per page.
- Catalogue in `packages/commerce/src/catalog.js` (placeholder data from the mockups), used by both the site and the checkout API. Decision: keep it in the repo until the catalogue grows; moving it to Supabase later only changes `apps/web/src/lib/catalog.js` and `order.js`.
- Checkout API (Cloudflare Pages Functions + Supabase + Razorpay): server-side pricing, signature-verified confirm, idempotent webhook with amount check, optional Resend emails. Without keys it returns 503 and the site offers WhatsApp ordering.
- Not carried over from the mockups: invented customer reviews, ratings and press mentions.

**Still open:** real product data and photos (mockup photos are hotlinked from Google), storefront CSP (Razorpay domains), Turnstile on checkout, sitemap/merchant feed, shipping integration, GST invoices, live gold-rate pricing.

## Why try-on is laggy today (from the code)
1. **Everything runs on the main thread, in several independent rAF loops.** `HandTrackingSession` / `FaceTrackingSession` / `PoseTrackingSession` (`hand-tracking.js:131`, `face-tracking.js`, `pose-tracking.js`) each call the blocking `detectForVideo` from their own `requestAnimationFrame`. The necklace runs face + pose + a third render loop (`try-on.html:428-470`), so two models plus WebGL compete for one thread every frame.
2. **Skin segmentation is heavy.** `selfie_multiclass_256x256` **float32** (~16 MB) runs every **2 frames** until the size locks (`ring-solver.js:125`). `getAsFloat32Array()` forces a GPU→CPU readback stall every time.
3. **Unpinned `latest` models from Google Cloud Storage** (`hand-tracking.js:19`, `face-tracking.js:17`, `pose-tracking.js:21`, `skin-segmentation.js:21`), plus the wasm and three.js from jsDelivr. Cold start goes through four origins, and the model versions can change silently.
4. **Renderer cost:** `preserveDrawingBuffer: true` (`three-scene.js:157` and the earring, nose and necklace scenes) disables buffer-swap optimisations on mobile GPUs. Also MSAA plus DPR 1.5, ACES tone mapping, and a grain pass, all at full canvas size.
5. **Camera at 1280×720** (`camera.js`). Inference only needs about 640×480, and the larger frame makes each texture upload more expensive.
6. **Heavy uncompressed assets:** earrings `scene.bin` 3.0 MB, necklace 2.0 MB, ring textures 3.8 MB of PNG/JPEG. No Draco, Meshopt or KTX2.
7. Tailwind runtime JIT (`cdn.tailwindcss.com`) compiles CSS in the browser on every page load.

## Architecture (target)
```
Browser ── Cloudflare (Pages static + CDN, free, unlimited bandwidth)
   │         ├─ Astro static pages (catalogue, PDP, content) — HTML cached at edge
   │         ├─ /assets/* hashed JS/CSS, /models/*.glb, /mediapipe/* wasm+tasks (immutable, 1y cache)
   │         └─ /api/* Pages Functions (Workers): checkout, razorpay webhook, revalidate
   │
   ├─ Supabase (free): Postgres (products, variants, tryon_config, orders), Auth (OTP/email), Storage (product photos)
   ├─ Razorpay Standard Checkout (no fixed fee, ~2%/txn)
   └─ Resend (free 3k emails/mo) for order emails; Sentry free; Cloudflare Web Analytics (free)
```
Try-on stays **100% on-device** (no camera frames leave the phone). That keeps latency off the network and helps with DPDP privacy compliance.

**Cost:** ₹0/month at launch. Only the domain (~₹800/yr) plus Razorpay's per-transaction fee. Watch out: Supabase free projects pause after 7 days of inactivity. A daily Cloudflare cron ping prevents that. Upgrade to Pro ($25) only when there is real traffic.

## Phase 0 — Repo restructure & tooling (2–3 days)
- Turn the repo into a monorepo: `apps/web` (Astro), `packages/tryon` (current `try-on/*.js`, moved as is), `assets-src/` (raw glTF), `scripts/`, `supabase/` (migrations).
- Move the dev recordings (`*.webm`, `ear-ring-tryon.json`, `ringtryon-*.json`) to `fixtures/` (git LFS or gitignored). Keep them for offline replay tests.
- Retire `server.mjs` and `start-server.bat`. Replace with `astro dev` (HTTPS through `@vitejs/plugin-basic-ssl`, so phones on the LAN can test the camera).
- GitHub Actions: lint, unit tests (Vitest on the solvers), build, deploy previews to Cloudflare Pages (free, deploy per branch).

## Phase 1 — Try-on performance (highest priority, ~1.5–2 weeks)
Target budget per frame on a budget Android: tracking ≤20 ms, render ≤8 ms, so ≥24fps rendered. Tracking may run at a lower rate than rendering, with interpolation in between.

1. **Self-host and pin every model and runtime.** Copy the `@mediapipe/tasks-vision@1.0.1` wasm and the bundle, plus pinned `.task` files, into `/mediapipe/v1/` behind an immutable cache. Change the URLs in `mediapipe-vision.js`, `hand-tracking.js`, `face-tracking.js`, `pose-tracking.js` and `skin-segmentation.js` to same-origin. Bundle three.js through Vite (tree-shaken) instead of the import map in `try-on.html:13`.
2. **Move inference to a Web Worker.** New `packages/tryon/vision-worker.js` owns all MediaPipe tasks. The main thread sends `createImageBitmap(video)` (transferable, about 640px) through `requestVideoFrameCallback`. The worker returns landmarks. Fallback when `OffscreenCanvas`/GPU delegate in a worker is unsupported (older iOS Safari): the current main-thread path, unchanged.
   - Replace the separate rAF sessions with **one scheduler**: render runs on rAF; detection runs on rVFC, with only one detection in flight at a time (drop frames instead of queueing them).
   - Necklace: **alternate face and pose** on even and odd frames (pose moves slowly), or run pose at 15 Hz. Do not run both every frame.
3. **Bridge the gap between detections.** The One-Euro filters (`one-euro-filter.js`) already smooth the pose. Add short velocity extrapolation in the solvers so the jewellery doesn't lag a frame behind the hand or face when tracking runs below render fps.
4. **Make segmentation cheaper:**
   - Use the float16 or `selfie_multiclass` quantized variant, or a 128px crop. Skip it entirely on low-tier devices and fall back to the hand-metric size estimate (`hand-metric.js`, `ring-sizer.js`, already implemented).
   - Run it every 4 frames before the size locks (currently 2). After lock, run it only on demand.
   - Use the category mask (uint8) instead of the two float confidence masks summed on the CPU (`skin-segmentation.js:120-130`).
5. **Renderer settings:**
   - `preserveDrawingBuffer: false`, except for a one-off render to capture a screenshot.
   - `powerPreference: 'high-performance'`.
   - Build the PMREM environment once and share it across scenes.
   - Render on demand only when the pose changed by more than a small epsilon.
6. **Adaptive quality tiers** (new `packages/tryon/perf-governor.js`):
   - **Tier start:** picked from `navigator.hardwareConcurrency`, `deviceMemory`, and a quick GPU benchmark on the first 30 frames.
   - **Tier High:** DPR 1.5, MSAA, segmentation, 30 Hz tracking.
   - **Tier Mid:** DPR 1.0, FXAA-less, segmentation every 6 frames, 30 Hz.
   - **Tier Low:** DPR 0.75, no antialias, no grain, no segmentation, tracking 15–20 Hz, camera 640×480.
   - **Switching:** measure a rolling frame time and drop a tier after 2 s below 22fps, with hysteresis before stepping back up.
7. **Faster cold start:**
   - Prefetch the right `.task` model and the GLB on hover or tap of "Try on", using `<link rel=modulepreload>` and `fetch()` into the Cache API.
   - Cache models in a Service Worker (Workbox through `@vite-pwa/astro`) so the second visit is instant.
   - Show the camera feed as soon as permission is granted, while the models are still loading.
8. **Asset compression pipeline** (`scripts/build-models.mjs`, `@gltf-transform/cli`):
   - Run `gltf-transform optimize --compress meshopt --texture-compress webp` (KTX2 where three.js's `KTX2Loader` is cheap), then `dedup`, `prune`, `resize` textures to ≤1024px, and export `.glb`.
   - Size targets: ring ≤300 KB, earrings ≤500 KB, necklace ≤600 KB.
   - Register `MeshoptDecoder` in the loaders: `necklace-model.js`, `earring-model.js`, `nose-ring-model.js`, and `three-scene.js` `loadRingModel`.
9. **Keep the debug tooling** (`session-recorder.js`, `landmark-debug-draw.js`), but load it only behind `?debug=1` so the debug code isn't fetched in production.
10. **Perf HUD and telemetry:** sample fps, tracking ms, tier and delegate on 5% of sessions. Send them through `navigator.sendBeacon` to a `/api/telemetry` Function that writes to Supabase or to Cloudflare Analytics Engine (free).

## Phase 2 — Storefront (Astro, ~2 weeks, overlaps with Phase 1)
- One responsive layout replacing `desktop.html`, `mobile.html` and `product.html`. Port the Stitch design tokens from the `stitch_*/DESIGN.md` files into `tailwind.config` (compiled with `@tailwindcss/vite`, so no runtime script).
- Self-host the fonts (EB Garamond, Plus Jakarta Sans, Syne) through `@fontsource`, subset to Latin. Replace Material Symbols with inlined SVG icons (it is currently a huge font).
- Pages: home, category listing, PDP, cart, checkout, order success, account (Supabase OTP), policies.
- Catalogue rendered **statically at build time** from Supabase. Edits in the Supabase dashboard trigger a Cloudflare Pages deploy hook to rebuild (seconds for a few hundred products). Price and stock are fetched live on the PDP and cart through a cached Function.
- Images: Astro `<Image>` with AVIF/WebP and responsive `srcset`, stored in Supabase Storage, or Cloudflare R2 (free tier 10 GB, zero egress) if storage grows.
- Try-on as a client-only island: `<TryOn client:only>` mounts `packages/tryon` in a full-screen modal on the PDP (no separate page navigation). Per-product config comes from the DB (see below) instead of the hardcoded catalogues in `try-on.html:200-262`.
- Targets: LCP <2.0 s on 4G (Moto G Power profile), JS <50 KB on catalogue pages, Lighthouse ≥90.

## Phase 3 — Backend & checkout (~1.5 weeks)
- **Supabase schema** (`supabase/migrations/`):
  - `products`, `variants` (metal, size, price_inr, stock)
  - `media`
  - `tryon_config` (category, model_url, ring bore mm, necklace length, nostril side, …)
  - `carts` (optional; a localStorage cart is fine for v1)
  - `orders`, `order_items`, `payments`
  - Row Level Security on every table: public read on the catalogue; orders readable only by their owner and admins.
- **Cloudflare Functions:**
  - `POST /api/checkout`: re-price the cart server-side from the DB, then create a Razorpay order.
  - `POST /api/razorpay/webhook`: verify the HMAC signature, upsert the payment idempotently, set the order to `paid`, send the email through Resend.
  - `POST /api/revalidate`: the deploy hook.
  - Secrets live in Cloudflare env vars.
- **Admin:** Supabase dashboard for v1 (products, orders). Add a small protected `/admin` page later if staff need one.
- **Shipping:** manual fulfilment at v1. Shiprocket (pay-per-shipment, no monthly fee) in phase 2.
- **Messaging:** email through Resend. Add WhatsApp later; it costs money per conversation.

## Phase 4 — Hardening & launch (~1 week)
- **Security headers through `_headers`:**
  - Strict CSP (same-origin scripts, plus `wasm-unsafe-eval` for MediaPipe, plus Razorpay's checkout domains).
  - `Permissions-Policy: camera=(self)`, HSTS.
  - `Cache-Control: immutable` on hashed assets and models.
- Cloudflare free WAF and bot protection, Turnstile on the OTP and login forms.
- **DPDP** (consent-manager rules apply from 13 Nov 2026):
  - A privacy notice that states camera frames are processed on-device only.
  - Explicit opt-in for telemetry.
  - Account deletion.
- **SEO:** Product JSON-LD, sitemap, OG images, Google Merchant feed generated at build time.
- **Monitoring:** Sentry free (5k errors), Cloudflare Web Analytics, UptimeRobot free.
- **Device QA matrix:** budget Android (Redmi or Realme), mid Android, iPhone 11+ Safari, desktop Chrome and Safari, with all four categories on each.

## Critical files
- **Modify:**
  - `try-on/mediapipe-vision.js`, `hand-tracking.js`, `face-tracking.js`, `pose-tracking.js`, `skin-segmentation.js` (self-host, worker)
  - `three-scene.js`, `earring-scene.js`, `necklace-scene.js`, `nose-ring-scene.js` (renderer flags, Meshopt, tiers)
  - `ring-solver.js` (segmentation cadence)
  - `camera.js` (resolution per tier)
  - `try-on.html` (logic moves into a mountable `TryOn` module; loops are unified)
- **New:**
  - `packages/tryon/vision-worker.js`, `perf-governor.js`, `frame-scheduler.js`
  - `scripts/build-models.mjs`
  - `apps/web/**`, `functions/api/*`, `supabase/migrations/*`
- **Reuse as is:** all solvers (`*-solver.js`), `one-euro-filter.js`, `view-mapping.js`, `lighting-estimator.js`, `ring-sizer.js`, `finger-measure.js`, `capability.js`.
- **Replace:** `server.mjs`, `desktop.html`, `mobile.html`, `index.html` (the dev launcher page), `product.html`.

## Verification
- **Offline replay tests (Vitest):**
  - Feed `fixtures/ringtryon-*.json` and `ear-ring-tryon.json` through the solvers.
  - Assert that the pose and size outputs match the pre-refactor snapshots, so the worker and scheduler changes don't alter placement.
- **Perf benchmark:**
  - A Playwright script in CI runs `try-on?debug=1` with a fake camera (`--use-file-for-fake-video-capture` using the `.webm` fixtures, converted to `.y4m`).
  - It records the HUD's fps and tracking ms with 4× CPU throttling.
  - Fails if render fps <24 or tracking p95 >40 ms.
- **Real devices:** test on a budget Android through Chrome remote debugging, using the Performance panel to confirm the main thread has no long tasks over 50 ms during try-on.
- **Lighthouse CI** on home, listing and PDP: LCP <2.0 s, CLS <0.1, total JS budget enforced.
- **Payments:**
  - Run Razorpay test-mode checkout end to end.
  - Replay the webhook with a bad signature and expect a 401.
  - Send a duplicate webhook and confirm only one order is written.
- **Asset sizes:** `scripts/build-models.mjs` prints the before and after size of each model and fails if a model is over budget.

## Order of execution
Phase 0 → Phase 1 items 1, 5, 8 (quick wins, about 2–3 days, probably most of the lag) → Phase 1 items 2–4, 6, 7 → Phase 2 and 3 in parallel → Phase 4 → launch. `PLAN.md` gets updated to match this plan (replacing Medusa on AWS).
