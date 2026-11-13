-- Orders for the CAEN storefront checkout (packages/commerce/src/handlers.js).
-- Apply in the Supabase dashboard (SQL editor) or with `supabase db push`.
--
-- Row Level Security is ON with no policies: the public anon key can read or
-- write nothing here. Only the server (Cloudflare Functions, service-role key)
-- touches these tables.

create table public.orders (
  id                  uuid primary key default gen_random_uuid(),
  order_number        text not null unique,
  status              text not null default 'pending'
                      check (status in ('pending', 'paid', 'needs_review', 'cancelled', 'refunded')),
  customer_name       text not null,
  email               text not null,
  phone               text not null,
  address1            text not null,
  address2            text not null default '',
  city                text not null,
  state               text not null,
  pincode             text not null check (pincode ~ '^[1-9][0-9]{5}$'),
  subtotal_inr        integer not null check (subtotal_inr >= 0),
  shipping_inr        integer not null check (shipping_inr >= 0),
  total_inr           integer not null check (total_inr >= 0),
  currency            text not null default 'INR',
  razorpay_order_id   text unique,
  razorpay_payment_id text,
  created_at          timestamptz not null default now(),
  paid_at             timestamptz
);
create index orders_status_created_idx on public.orders (status, created_at desc);

create table public.order_items (
  id              bigint generated always as identity primary key,
  order_id        uuid not null references public.orders (id) on delete cascade,
  sku             text not null,
  name            text not null,
  unit_price_inr  integer not null check (unit_price_inr >= 0),
  qty             integer not null check (qty between 1 and 10),
  options         jsonb not null default '{}'::jsonb,
  line_total_inr  integer not null check (line_total_inr >= 0)
);
create index order_items_order_idx on public.order_items (order_id);

-- Every Razorpay webhook event, once (primary key = Razorpay event id), for
-- idempotency and audit.
create table public.payment_events (
  id                  text primary key,
  event               text not null,
  razorpay_order_id   text,
  razorpay_payment_id text,
  payload             jsonb not null,
  received_at         timestamptz not null default now()
);
create index payment_events_order_idx on public.payment_events (razorpay_order_id);

alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.payment_events enable row level security;
