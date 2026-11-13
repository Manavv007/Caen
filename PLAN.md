# CAEN Jewels: Backend, Hosting and Launch Plan

Written 2026-10-20. Assumes an India-first store (INR, UPI, GST), a small team, and a few hundred products at launch. Items marked "unverified" were not checked and need confirming before commitment.

## 1. Where we are today

- The site is static HTML: the Stitch-generated pages plus our try-on modules. It is served by a local dev server. There is no backend, database, cart or checkout.
- Try-on runs entirely in the browser (MediaPipe). Camera frames never leave the device, so try-on latency does not depend on the backend, and it helps with India's data-protection law.
- Things that are not production-ready:
  - Tailwind, three.js and the MediaPipe models and wasm load from public CDNs (jsDelivr, Google). They should be self-hosted.
  - The 3D models are uncompressed. The nose ring is a 40 KB mesh with a 1.2 MB PNG texture.
  - There are separate `desktop.html` and `mobile.html` files.
  - The product catalogs are hardcoded in `try-on/try-on.html`.

## 2. Language and stack

TypeScript end to end, on Node LTS.

| Layer | Choice | Why |
|---|---|---|
| Commerce engine | Medusa v2, self-hosted | Open source (MIT), TypeScript, modular, has an admin UI, no per-order fees. |
| Storefront | Next.js 16 (React) | Our try-on code drops in as a client-only module. Medusa has a Next.js starter. |
| Database | PostgreSQL, managed | Standard for Medusa. |
| Cache and queues | Redis or Valkey | Used by Medusa in production for cache, events, workflows and locks. |
| Search | Postgres at first, then Typesense | Typesense is self-hosted, with fast filters by metal, price and stone. |
| Content (homepage, journal) | Sanity or Payload | A suggestion, not researched. |
| Files and CDN | Cloudflare R2 plus its CDN | R2 charges no egress fees; S3 does. This matters for heavy images and 3D files. |
| Payments | Razorpay, with Cashfree as backup | Cards, UPI, netbanking, EMI. |
| Messaging | WhatsApp Business API, email, SMS OTP | WhatsApp is how Indian customers expect order updates. |
| Monitoring | Sentry, PostHog, OpenTelemetry | Errors, analytics, traces. |
| CI/CD | GitHub Actions, Docker, infrastructure as code | Repeatable deployments. |

Medusa's docs say production should run two instances (a server and a worker) with Postgres and Redis behind them.

## 3. Where it runs

| Piece | Home | Reason |
|---|---|---|
| Medusa server and worker, Postgres, Redis | AWS Mumbai (ap-south-1); Hyderabad as a second region if needed | Closest to Indian customers. |
| Storefront | Vercel or Cloudflare with an India edge, or the same containers on AWS | Static pages cached at the edge; only cart and checkout hit the backend. |
| Images, 3D models, MediaPipe files | R2 plus CDN with long immutable caching | Fast loads and no bandwidth surprises. |
| Staging | Same setup, smaller | Safe place to test payments and deploys. |

Unverified: which India regions Vercel and Medusa Cloud offer. For costs, use each provider's pricing calculator.

## 4. Jewellery logic to build (custom Medusa modules)

- **Dynamic pricing:** price = metal weight × live rate × purity + making charges + stone value + hallmarking + GST.
  - A rate service refreshes about once a minute from a licensed feed and caches in Redis.
  - The price is locked for about 15 minutes at checkout.
- **Variants:** metal and purity, size, diamond quality, made-to-order lead times, engraving, and resize and return rules.
- **High-value payments:** UPI per-transaction limits are low for jewellery, so add netbanking or RTGS and EMI. Current limits are unverified.
- **Razorpay plugin:** the Medusa Razorpay plugins found are community-made, not official. Audit one or write our own; the payment interface is small. Webhooks need signature checks and idempotency.
- **Shipping and invoices:** insured shipping through an aggregator such as Shiprocket or Delhivery (not researched), and GST invoices with HSN codes.
- **Compliance:** hallmark and BIS rules, GST on gold, PAN requirements for large orders. Unverified; confirm with a CA before launch.

## 5. Making try-on production-grade

- Compress 3D files with gltf-transform: Meshopt for geometry, KTX2 or WebP for textures. Target under about 500 KB per model. The loaders need decoder support added.
- Move per-product try-on settings (ring diameter, necklace length, nostril side, cut level) into Medusa product metadata, replacing the hardcoded catalogs.
- Self-host the MediaPipe models and three.js, then set a strict content-security policy.
- Prefetch models when a customer hovers "Try on". Test on cheap Android phones, because running face and pose tracking together is heavy.
- Add opt-in analytics (frame rate, tracking-lost rate, GPU or CPU, conversion). Any saved face video needs explicit consent.
- Necklace realism: room reflections, soft shadows, physics.
- Later categories that suit this market: maang tikka, jhumkas, bangles, nath-style hoops.

## 6. Compliance and security

- **DPDP Act:** consent-manager rules start 13 Nov 2026 and full compliance is due 13 May 2027 (dates from several consistent sources). Plan consent, privacy notice, retention, deletion and breach handling now.
- **Security:** Cloudflare WAF and bot protection, card data handled only by Razorpay's hosted checkout, secrets in a secrets manager, point-in-time database backups, admin 2FA.
- **HTTPS:** required in production for camera access.

## 7. Roadmap

1. **Setup (week 1):** Razorpay KYC, domain, Cloudflare and AWS accounts, one monorepo, staging environment, real product list with photos and certificates.
2. **Backend (weeks 1–4):** Medusa, Postgres and Redis, jewellery pricing module, metal-rate service, catalog import.
3. **Storefront (weeks 3–7):** one responsive Next.js app replacing the Stitch pages: listings, product pages, search, cart, checkout, accounts, with try-on embedded.
4. **Operations (weeks 6–9):** payments, shipping, WhatsApp and email notifications, GST invoices, order handling.
5. **Try-on production (parallel):** asset pipeline, self-hosted models, analytics, necklace realism.
6. **Hardening (weeks 9–11):** load testing, security review, DPDP consent, SEO structured data, Google and Meta product feeds.
7. **Launch and iterate.**

## 8. Alternative: Shopify

Faster to launch, but Shopify Payments does not operate in India. Per Razorpay's pricing pages, a third-party gateway surcharge applies: 2% (Basic), 1% (Grow) or 0.6% (Advanced), on top of the gateway's own fees. Custom jewellery pricing and the try-on integration are also harder. Medusa is the recommendation unless the goal is to launch within weeks with no engineering time.

## 9. Open questions

1. Who builds and maintains this after launch?
2. What is the budget and expected order volume?
3. How many products at launch?
4. India only, or international shipping too?

## 10. What was and wasn't verified

- Researched, with multiple sources: Medusa's production setup, Shopify's India fee structure, R2 versus S3 egress pricing, DPDP deadlines, glTF compression practice.
- My judgment, not researched: CMS choice, shipping providers, search timing, AWS region choice.
- Unverified: India regions for Vercel and Medusa Cloud, UPI limits, BIS and GST specifics, PAN rules.
