alter table public.promotions
  add column if not exists public_display_enabled boolean not null default false,
  add column if not exists public_display_text text;

create table public.product_variant_releases (
  id uuid primary key default gen_random_uuid(),
  product_variant_id uuid not null references public.product_variants(id) on delete restrict,
  release_code text not null,
  release_label text,
  status text not null default 'SCHEDULED'
    check (status in ('SCHEDULED', 'ACTIVE', 'CLOSED')),
  release_capacity integer not null check (release_capacity >= 0),
  release_committed integer not null default 0
    check (release_committed >= 0 and release_committed <= release_capacity),
  low_stock_threshold integer not null default 10
    check (low_stock_threshold >= 0),
  starts_at timestamptz,
  ends_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (product_variant_id, release_code),
  check (ends_at is null or starts_at is null or ends_at > starts_at)
);

comment on table public.product_variant_releases is
  'Server-only sellable release allocations. Public clients read a safe projection through /api/commerce/catalog.';
comment on column public.product_variant_releases.release_committed is
  'Quantity committed from the release. Public remaining is capacity minus committed, constrained by known physical sellable inventory.';

create index product_variant_releases_lookup_idx
  on public.product_variant_releases(product_variant_id, status, starts_at, ends_at);

alter table public.product_variant_releases enable row level security;
revoke all on table public.product_variant_releases from anon, authenticated;
grant all on table public.product_variant_releases to service_role;

create trigger product_variant_releases_set_updated_at
before update on public.product_variant_releases
for each row execute function private.set_updated_at();

update public.promotions
set
  public_display_enabled = true,
  public_display_text = case code
    when 'GIR_1L_EARLY_BIRD' then 'Early-bird price until 4 October'
    when 'MURRAH_1L_EARLY_BIRD' then 'Early-bird price until 4 October'
  end,
  version = version + 1,
  updated_at = now()
where code in (
  'GIR_1L_EARLY_BIRD',
  'MURRAH_1L_EARLY_BIRD'
);
