begin;
create table public.checkout_contact_drafts (
  browser_hash text not null check (browser_hash ~ '^[a-f0-9]{64}$'),
  phone_hash text not null check (phone_hash ~ '^[a-f0-9]{64}$'),
  source text not null default 'RETARGETING_DRAFT' check (source = 'RETARGETING_DRAFT'),
  customer jsonb not null,
  shipping_address jsonb not null,
  revision bigint not null check (revision >= 0),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '30 days',
  primary key (browser_hash, phone_hash),
  check (jsonb_typeof(customer) = 'object' and jsonb_typeof(shipping_address) = 'object')
);
create index checkout_contact_drafts_expiry_idx on public.checkout_contact_drafts(expires_at);
alter table public.checkout_contact_drafts enable row level security;
revoke all on public.checkout_contact_drafts from public, anon, authenticated;
grant select, insert, update, delete on public.checkout_contact_drafts to service_role;
-- Invoker rights: the service role is the sole allowed caller. No account/address table is touched.
create function public.save_checkout_contact_draft(p_browser_hash text, p_phone_hash text, p_customer jsonb, p_address jsonb, p_revision bigint)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  delete from public.checkout_contact_drafts where (browser_hash, phone_hash) in (
    select browser_hash, phone_hash from public.checkout_contact_drafts where expires_at < now() order by expires_at limit 100
  );
  insert into public.checkout_contact_drafts(browser_hash, phone_hash, customer, shipping_address, revision)
  values (p_browser_hash, p_phone_hash, p_customer, p_address, p_revision)
  on conflict (browser_hash, phone_hash) do update
  set customer = excluded.customer, shipping_address = excluded.shipping_address,
      revision = excluded.revision, updated_at = now(), expires_at = now() + interval '30 days'
  where public.checkout_contact_drafts.revision <= excluded.revision;
end;
$$;
revoke all on function public.save_checkout_contact_draft(text,text,jsonb,jsonb,bigint) from public, anon, authenticated;
grant execute on function public.save_checkout_contact_draft(text,text,jsonb,jsonb,bigint) to service_role;
comment on table public.checkout_contact_drafts is 'Unverified browser-bound checkout drafts; never customer identity, confirmed addresses or marketing consent.';
commit;
