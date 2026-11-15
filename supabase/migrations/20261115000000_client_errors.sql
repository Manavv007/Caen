-- Errors seen in customers' browsers (apps/web/src/scripts/error-report.js
-- -> /api/report-error). No personal data: page path, message, code
-- location, browser. Same lockdown as orders: only service_role.
create table public.client_errors (
  id          bigint generated always as identity primary key,
  created_at  timestamptz not null default now(),
  kind        text not null check (kind in ('error', 'rejection', 'tryon', 'checkout')),
  page        text not null,
  message     text not null,
  source      text,
  stack       text,
  user_agent  text
);
create index client_errors_created_idx on public.client_errors (created_at desc);
alter table public.client_errors enable row level security;
revoke all on public.client_errors from anon, authenticated;
grant select, insert, delete on public.client_errors to service_role;

-- Most frequent errors in the last 7 days: select * from client_error_summary;
create view public.client_error_summary with (security_invoker = true) as
  select kind, message, count(*) as occurrences, count(distinct page) as pages,
         min(created_at) as first_seen, max(created_at) as last_seen
  from public.client_errors
  where created_at > now() - interval '7 days'
  group by kind, message
  order by occurrences desc;
revoke all on public.client_error_summary from anon, authenticated;
