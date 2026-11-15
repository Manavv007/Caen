-- Store catalogue, edited in the Supabase dashboard (Table Editor).
--
--   categories      one row per collection (Rings, Earrings, ...)
--   products        one row per product; only active = true rows are shown
--   site_settings   one row: contact details, shipping rule, returns
--
-- The storefront is built from these tables (anon key, read-only, active
-- rows only). The checkout API prices orders from `products` (service key),
-- so prices can never come from the browser.
--
-- Publishing: any change marks the catalogue dirty; a pg_cron job checks
-- once a minute and starts ONE Cloudflare Pages rebuild through the deploy
-- hook stored in Vault (secret name 'cloudflare_deploy_hook'). The site is
-- live with the change ~1-2 minutes later.

create table public.categories (
  slug        text primary key check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name        text not null,
  blurb       text not null default '',
  image_url   text not null,
  image_alt   text not null default '',
  sort        integer not null default 0,
  active      boolean not null default true
);

create table public.products (
  sku          text primary key check (sku ~ '^[A-Z0-9]+(-[A-Z0-9]+)*$'),
  slug         text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name         text not null,
  category     text not null references public.categories (slug) on update cascade,
  price_inr    integer not null check (price_inr > 0),
  label        text not null default '',
  detail       text not null default '',
  description  text not null default '',
  -- Full URL of a photo (e.g. uploaded to Storage bucket 'product-images'),
  -- or a path on the site such as /images/products/x.webp.
  image_url    text not null,
  image_alt    text not null default '',
  -- Live try-on. Only works for products that have a 3D model (ask a
  -- developer to add one); otherwise leave empty.
  try_on       text check (try_on in ('ring', 'earring', 'necklace', 'nose')),
  featured     boolean not null default false,  -- shown in "The Caen Edit" on the home page
  active       boolean not null default false,  -- draft until ticked
  sort         integer not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index products_category_idx on public.products (category, sort);

create table public.site_settings (
  id                       integer primary key default 1 check (id = 1),
  email                    text not null,
  phone                    text not null,
  whatsapp                 text not null check (whatsapp ~ '^[0-9]{10,15}$'),
  free_shipping_above_inr  integer not null check (free_shipping_above_inr >= 0),
  shipping_fee_inr         integer not null check (shipping_fee_inr >= 0),
  return_days              integer not null check (return_days >= 0)
);

create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;
create trigger products_touch before update on public.products
  for each row execute function public.touch_updated_at();

-- Read access: public (anon) sees active rows only; nobody but the dashboard
-- (postgres) and service_role can write.
alter table public.categories enable row level security;
alter table public.products enable row level security;
alter table public.site_settings enable row level security;
revoke all on public.categories, public.products, public.site_settings from anon, authenticated;
grant select on public.categories, public.products, public.site_settings to anon, service_role;
create policy "public reads active categories" on public.categories for select to anon using (active);
create policy "public reads active products" on public.products for select to anon using (active);
create policy "public reads settings" on public.site_settings for select to anon using (true);

-- Product photos: public bucket, uploads via the dashboard.
insert into storage.buckets (id, name, public)
values ('product-images', 'product-images', true)
on conflict (id) do nothing;

-- ---------------------------------------------------------------- publishing
create extension if not exists pg_net;
create extension if not exists pg_cron;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table private.publish_state (
  id            integer primary key default 1 check (id = 1),
  dirty         boolean not null default false,
  changed_at    timestamptz,
  published_at  timestamptz,
  last_request  bigint
);
insert into private.publish_state (id) values (1) on conflict do nothing;

create or replace function private.mark_catalog_dirty() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update private.publish_state set dirty = true, changed_at = now() where id = 1;
  return null;
end $$;

create trigger categories_publish after insert or update or delete on public.categories
  for each statement execute function private.mark_catalog_dirty();
create trigger products_publish after insert or update or delete on public.products
  for each statement execute function private.mark_catalog_dirty();
create trigger site_settings_publish after insert or update or delete on public.site_settings
  for each statement execute function private.mark_catalog_dirty();

create or replace function private.publish_if_dirty() returns void
language plpgsql security definer set search_path = '' as $$
declare
  hook text;
begin
  if not exists (select 1 from private.publish_state where id = 1 and dirty) then
    return;
  end if;
  select decrypted_secret into hook from vault.decrypted_secrets where name = 'cloudflare_deploy_hook';
  if hook is null then
    return; -- not configured yet: stay dirty, publish once it is
  end if;
  update private.publish_state
     set dirty = false,
         published_at = now(),
         last_request = net.http_post(url := hook, body := '{}'::jsonb)
   where id = 1;
end $$;

select cron.schedule('publish-catalog', '* * * * *', 'select private.publish_if_dirty()');
