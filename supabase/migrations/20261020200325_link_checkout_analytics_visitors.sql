-- Connect existing anonymous browser history to checkout without changing payment logic.
-- This is attribution evidence only, never customer authentication or payment authority.
create table public.analytics_customer_links (
  checkout_session_id uuid primary key references public.checkout_sessions(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  visitor_id text not null check (length(visitor_id) between 8 and 200),
  session_id text not null check (length(session_id) between 8 and 200),
  created_at timestamptz not null default now()
);
create index analytics_customer_links_customer_idx on public.analytics_customer_links(customer_id);
create index analytics_customer_links_visitor_idx on public.analytics_customer_links(visitor_id);
alter table public.analytics_customer_links enable row level security;
revoke all on public.analytics_customer_links from public, anon, authenticated;
revoke all on public.analytics_customer_links from service_role;
grant select, insert on public.analytics_customer_links to service_role;
comment on table public.analytics_customer_links is 'Browser-reported checkout attribution; not authenticated identity. First link per checkout is immutable.';
