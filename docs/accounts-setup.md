# Customer accounts: setup

Sign-in uses Supabase Auth: a 6-digit code by email, and optionally
"Continue with Google". Everything else (pages, database, security) is
already in place. Two things need your accounts:

## 1. An email service (required before launch)

Supabase's built-in sender only delivers to your own team's addresses and
allows 2 emails an hour, so customers won't receive codes until you
connect a real one. Free options:

- **Now, without a domain: Brevo** (free, 300 emails/day)
  1. Sign up at brevo.com → **Senders, domains & dedicated IPs** → add and
     verify the sender address you want codes to come from.
  2. **SMTP & API** → **SMTP** → note the server, port, login, and
     **generate an SMTP key**.
- **After you buy a domain: Resend** (free, 3,000 emails/month), with your
  domain verified, e.g. `orders@yourdomain.in`.

Then in **Supabase → Authentication → Emails → SMTP Settings**: enable
custom SMTP and enter host (Brevo: `smtp-relay.brevo.com`), port `587`,
username, the SMTP key as password, sender email and sender name
`CAEN JEWELS`. Save.

Until then, Supabase sends its default email, which has a one-time
**sign-in link** instead of a code. That works too: tapping the link signs
the customer in (on any device). Some email apps open links in the
background to scan them, which can use the link up before the customer
taps it; the branded email with a 6-digit code avoids that.

Tell Claude (or a developer) once that's done: the branded code email in
`supabase/auth-email-templates.json` and a higher sending limit can only be
applied after custom SMTP is on.

## 2. Google sign-in (optional)

1. console.cloud.google.com → create a project → **APIs & Services** →
   **OAuth consent screen**: External, app name `CAEN JEWELS`, support email,
   your site's domain.
2. **Credentials → Create credentials → OAuth client ID** → Web
   application. Authorised redirect URI:
   `https://motsxvcewmflyldqspsa.supabase.co/auth/v1/callback`
3. Copy the client ID and client secret into **Supabase → Authentication →
   Sign In / Providers → Google**, enable, save.

The "Continue with Google" button appears on the sign-in page by itself; no
site update needed.

## How it works (for developers)

- `apps/web/src/scripts/auth.js`: small client for the Supabase Auth REST
  API (email OTP, Google via PKCE, refresh, sign-out); session in
  localStorage.
- Pages: `/account/login`, `/account/callback`, `/account` (orders,
  wishlist, profile, delete account). Product pages: wishlist button.
  Checkout: prefill from the profile, "save details", order linked to the
  account.
- Data (`supabase/migrations/20261115030000_accounts.sql`): `profiles`,
  `wishlist`, `orders.user_id`; row-level security limits every customer to
  their own rows. Order history also matches orders placed as a guest with
  the same (verified) email.
- Server: `/api/checkout` links the order when a valid token is sent;
  `/api/account/delete` deletes the account (orders kept, unlinked).
- Auth settings already applied: site URL, allowed redirect URLs (site,
  previews, localhost), 6-digit codes valid for 10 minutes.
