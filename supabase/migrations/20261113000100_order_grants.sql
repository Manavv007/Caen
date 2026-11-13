-- Newer Supabase projects don't grant table access to the API roles by
-- default. The checkout server (service_role key) needs exactly these;
-- the public roles get nothing (RLS has no policies either).
revoke all on public.orders, public.order_items, public.payment_events from anon, authenticated;
grant select, insert, update on public.orders, public.order_items, public.payment_events to service_role;
