# Editing the store (products, photos, contact details)

Everything is edited in **Supabase** → your project `caen` → **Table Editor**,
which works like a spreadsheet. Changes go live automatically: about a minute
after you stop editing, the site rebuilds (1–2 minutes). Several edits in a row
publish together.

## Add a product

1. **Upload the photo first.** Supabase → **Storage** → bucket
   `product-images` → **Upload file**. Use a square photo, JPG/PNG/WebP, at
   least 1200×1200 px; any size is fine, the site makes small fast copies.
   Click the uploaded file → **Get URL** → copy it.
2. **Table Editor → `products` → Insert → Insert row**, and fill in:

| Column | What to put | Example |
|---|---|---|
| `sku` | Your product code, CAPITALS and dashes. Never change it later (orders refer to it). | `ROSE-HALO-RING` |
| `slug` | The web address part: lowercase and dashes. | `rose-halo-ring` → /products/rose-halo-ring |
| `name` | Product name | `Rose Halo Ring` |
| `category` | One of the `slug` values in `categories` | `rings` |
| `price_inr` | Price in rupees, GST included, no commas | `42500` |
| `label` | Small gold line above the name | `18K rose gold` |
| `detail` | Short spec next to the price | `0.50 ct VS1` |
| `description` | A few sentences | |
| `image_url` | The URL you copied in step 1 | |
| `image_alt` | Describe the photo (for blind visitors and Google) | `Rose gold halo ring with a round diamond` |
| `try_on` | Leave **empty**, unless a developer has added a 3D model for this SKU | |
| `featured` | Tick to show it in "The Caen Edit" on the home page (first 4 shown) | |
| `sort` | Order within lists: smaller comes first | `10`, `20`, `30`… |
| `active` | **Tick when ready.** Unticked = draft, not on the site | |

3. Save. Check the site a few minutes later.

## Change a price, text or photo

Edit the cell and save. **Prices:** if a customer had the page open with the
old price, checkout stops and asks them to refresh — nobody is charged a price
they didn't see.

## Remove a product

Untick `active` (don't delete the row: past orders refer to its SKU). It
disappears from the site and can no longer be bought, even from an open page.

## Categories

Table `categories`: `slug` (web address, e.g. `rings` → /collections/rings),
`name`, `blurb`, `image_url`, `sort`, `active`. Products need an active
category to appear.

## Contact details, shipping, returns

Table `site_settings` (one row): `email`, `phone`, `whatsapp` (digits with
country code, e.g. `919876543210`), `free_shipping_above_inr`,
`shipping_fee_inr`, `return_days`. Checkout charges shipping from these values.

## Check it worked / troubleshooting

- **Cloudflare** → Workers & Pages → `caen` → **Deployments**: a new
  "deploy hook" build appears about a minute after an edit. If it **failed**,
  open it to read why (for example a product whose `category` doesn't exist),
  fix the row, and it publishes again. If it says "Unknown internal error",
  click **Retry**. The live site keeps the previous version until a build succeeds.
- Edits made in the **SQL editor** publish the same way.
- Live try-on for a new product needs a developer: the 3D model has to be
  compressed and added to `apps/web/src/data/tryon-models.js`.
