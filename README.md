# CAEN Jewels

Jewellery storefront with on-device AR try-on (rings, earrings, necklaces, nose rings).
See [PLAN.md](PLAN.md) for the production plan and its progress.

## Layout

| Path | What |
|---|---|
| `apps/web` | Astro site (deploys to Cloudflare Pages): storefront pages in `src/pages`, catalogue in `src/data/catalog.js` (placeholder data until the database), try-on at `src/pages/try-on.astro`. |
| `packages/tryon` | Try-on engine: MediaPipe tracking, solvers (pure, testable), three.js scenes. |
| `packages/commerce` | Catalogue access (Supabase), pricing, checkout/payment handlers. `src/catalog.js` = starter data for local dev/CI. |
| `apps/web/functions/api` | Cloudflare Pages Functions: `/api/checkout`, `/api/checkout/confirm`, `/api/razorpay/webhook`. |
| `supabase/migrations` | Orders database schema. |
| `assets-src/models` | Source 3D models (glTF + licences). Not shipped directly. |
| `scripts/build-models.mjs` | Compresses source models to small `.glb` files in `apps/web/public/models` (committed). |
| `scripts/fetch-mediapipe.mjs` | Self-hosts the MediaPipe wasm + pinned models into `apps/web/public/mediapipe` (gitignored, runs before dev/build). |
| `fixtures` | Recorded try-on sessions used by the replay tests. |

## Editing products and contact details

In Supabase (Table Editor), no code needed — see [docs/editing-the-store.md](docs/editing-the-store.md).
The site rebuilds automatically about a minute after an edit. `packages/commerce/src/catalog.js` is only the
starter data for local development and CI.

## Customer accounts

Sign in with a 6-digit email code (or Google): order history, wishlist, saved address, account deletion.
Setup steps (email service, Google): [docs/accounts-setup.md](docs/accounts-setup.md).

## Develop

Needs Node 22.

```bash
npm install
```

```bash
npm run dev
```

Open http://localhost:4321 for the store (sitemap at `/sitemap.xml`, Google product feed at `/feeds/google-merchant.xml`), or http://localhost:4321/try-on?category=ring (also `earring`, `necklace`, `nose`).

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

- Root directory: `apps/web` (Cloudflare picks up the API from `apps/web/functions`)
- Build command: `npm run build`
- Build output directory: `dist`
- Environment variables: `NODE_VERSION=22`, `SUPABASE_URL`, `SUPABASE_ANON_KEY` (public; the build reads the catalogue with it)
- After adding a custom domain: `SITE_URL=https://yourdomain.in` (canonical links, sitemap, product feed)

Caching and security headers (one site-wide Content-Security-Policy) come from `apps/web/public/_headers`; when adding a third-party script, image host or iframe, add it to that policy. Old prototype URLs redirect via `apps/web/public/_redirects`.

## Turn on online payments

Until these are set, checkout offers "Order on WhatsApp" instead of paying online.

1. **Supabase** (free tier): create a project (region: Mumbai). In the SQL editor, run the files in `supabase/migrations/` in order. Copy the project URL and the `service_role` key (Project Settings → API).
2. **Razorpay**: in test mode, create API keys (Settings → API Keys). Add a webhook (Settings → Webhooks) for `https://<your-site>/api/razorpay/webhook` with events `payment.captured` and `order.paid`, and a secret you choose.
3. **Cloudflare Pages** → your project → Settings → Variables and Secrets: add `RAZORPAY_KEY_ID`, `SUPABASE_URL` (plain text) and `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, `SUPABASE_SERVICE_ROLE_KEY` (type **Secret**, so they're encrypted), then redeploy. Check names have no trailing spaces.
4. Optional emails: a free [Resend](https://resend.com) account with your domain verified; add `RESEND_API_KEY`, `ORDER_EMAIL_FROM`, `ORDER_NOTIFY_EMAIL`.
5. **Bot protection** (Cloudflare Turnstile, free): Cloudflare dashboard → Turnstile → Add widget (hostname: your site, mode: Managed). Add `PUBLIC_TURNSTILE_SITE_KEY` (plain text — it's public and baked in at build time) and `TURNSTILE_SECRET_KEY` (Secret) to Pages variables, then redeploy. Without them checkout works with no bot check.
6. Test with Razorpay's test cards/UPI, check the order shows `paid` in Supabase (Table editor → orders), then switch to live keys after KYC.

To run the site with the API locally: copy `.dev.vars.example` to `apps/web/.dev.vars`, fill it in, `npm run build`, then from `apps/web`: `npx wrangler pages dev dist`.
