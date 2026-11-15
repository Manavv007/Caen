-- Customer accounts (Supabase Auth: email one-time code or Google).
--
--   profiles   name, phone and saved delivery address (prefills checkout)
--   wishlist   saved products
--   orders     + user_id; customers read their own orders (by account, or
--              by their verified email for orders placed before signing in)
--
-- Every policy is "own rows only". Guests (anon) get nothing new.

create table public.profiles (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  full_name   text not null default '' check (length(full_name) <= 100),
  phone       text not null default '' check (phone = '' or phone ~ '^[6-9][0-9]{9}$'),
  address1    text not null default '' check (length(address1) <= 200),
  address2    text not null default '' check (length(address2) <= 200),
  city        text not null default '' check (length(city) <= 100),
  state       text not null default '' check (length(state) <= 60),
  pincode     text not null default '' check (pincode = '' or pincode ~ '^[1-9][0-9]{5}$'),
  updated_at  timestamptz not null default now()
);
create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();

create table public.wishlist (
  user_id     uuid not null references auth.users (id) on delete cascade,
  sku         text not null references public.products (sku) on update cascade on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (user_id, sku)
);

alter table public.orders add column user_id uuid references auth.users (id) on delete set null;
create index orders_user_idx on public.orders (user_id, created_at desc);
create index orders_email_idx on public.orders (lower(email), created_at desc);

alter table public.profiles enable row level security;
alter table public.wishlist enable row level security;

revoke all on public.profiles, public.wishlist from anon, authenticated;
grant select, insert, update on public.profiles to authenticated;
grant select, insert, delete on public.wishlist to authenticated;
grant select, insert, update, delete on public.profiles, public.wishlist to service_role;

create policy "own profile: read" on public.profiles for select to authenticated using (user_id = auth.uid());
create policy "own profile: create" on public.profiles for insert to authenticated with check (user_id = auth.uid());
create policy "own profile: update" on public.profiles for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "own wishlist: read" on public.wishlist for select to authenticated using (user_id = auth.uid());
create policy "own wishlist: add" on public.wishlist for insert to authenticated with check (user_id = auth.uid());
create policy "own wishlist: remove" on public.wishlist for delete to authenticated using (user_id = auth.uid());

-- Order history: only the columns a customer needs, only their own orders.
-- (Sign-in is by one-time email code or Google, so the JWT email is verified.)
grant select (id, order_number, status, subtotal_inr, shipping_inr, total_inr, created_at, paid_at,
              customer_name, address1, address2, city, state, pincode, email, user_id)
  on public.orders to authenticated;
grant select (order_id, sku, name, unit_price_inr, qty, options, line_total_inr)
  on public.order_items to authenticated;

create policy "own orders: read" on public.orders for select to authenticated
  using (user_id = auth.uid() or lower(email) = lower(auth.jwt() ->> 'email'));
create policy "own order items: read" on public.order_items for select to authenticated
  using (exists (select 1 from public.orders o where o.id = order_id));
