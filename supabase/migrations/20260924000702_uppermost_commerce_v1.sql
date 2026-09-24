-- Uppermost Commerce V1
-- Frozen architecture: docs/UPPERMOST_COMMERCE_ARCHITECTURE.md

create extension if not exists pgcrypto;
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to service_role;

create sequence if not exists public.uppermost_order_number_seq;

create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

revoke all on function private.set_updated_at() from public, anon, authenticated;

create or replace function private.next_uppermost_order_number()
returns text
language sql
set search_path = ''
as $$
  select 'UPM-' || to_char(now() at time zone 'utc', 'YYYYMMDD') || '-' ||
    lpad(nextval('public.uppermost_order_number_seq')::text, 6, '0');
$$;

revoke all on function private.next_uppermost_order_number() from public, anon, authenticated;
grant execute on function private.next_uppermost_order_number() to service_role;

create table public.products (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  product_family text not null,
  description text,
  is_active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.product_variants (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete restrict,
  sku text not null unique,
  name text not null,
  size_label text not null,
  price_paise bigint not null check (price_paise >= 0),
  currency text not null default 'INR' check (currency = 'INR'),
  weight_grams integer not null check (weight_grams > 0),
  length_cm numeric(8,2) not null check (length_cm > 0),
  breadth_cm numeric(8,2) not null check (breadth_cm > 0),
  height_cm numeric(8,2) not null check (height_cm > 0),
  external_shopify_variant_id text,
  inventory_policy text not null default 'SUPABASE' check (inventory_policy in ('SUPABASE', 'SHOPIFY')),
  inventory_quantity integer,
  is_active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index product_variants_product_id_idx on public.product_variants(product_id);
create unique index product_variants_shopify_id_idx
  on public.product_variants(external_shopify_variant_id)
  where external_shopify_variant_id is not null;

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique,
  name text not null,
  first_name text,
  email text,
  normalized_email text unique,
  phone text,
  normalized_phone text unique,
  razorpay_customer_id text unique,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (normalized_email is not null or normalized_phone is not null)
);

create table public.customer_addresses (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  label text,
  name text not null,
  phone text not null,
  line1 text not null,
  line2 text,
  landmark text,
  city text not null,
  state text not null,
  postal_code text not null check (postal_code ~ '^[0-9]{6}$'),
  country text not null default 'IN' check (country = 'IN'),
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index customer_addresses_customer_id_idx on public.customer_addresses(customer_id);
create unique index customer_addresses_one_default_idx
  on public.customer_addresses(customer_id)
  where is_default;

create table public.promotions (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  label text not null,
  description text,
  status text not null default 'ACTIVE' check (status in ('DRAFT', 'ACTIVE', 'PAUSED', 'ARCHIVED')),
  valid_from timestamptz,
  valid_until timestamptz,
  conditions jsonb not null default '{}'::jsonb,
  actions jsonb not null default '[]'::jsonb check (jsonb_typeof(actions) = 'array'),
  priority integer not null default 0,
  stackable boolean not null default true,
  stacking_group text,
  usage_limit bigint check (usage_limit is null or usage_limit >= 0),
  usage_count bigint not null default 0 check (usage_count >= 0),
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (valid_until is null or valid_from is null or valid_until > valid_from)
);

create index promotions_active_window_idx on public.promotions(status, valid_from, valid_until);

create table public.carts (
  id uuid primary key default gen_random_uuid(),
  guest_session_id text,
  customer_id uuid references public.customers(id) on delete set null,
  status text not null default 'OPEN' check (status in ('OPEN', 'CHECKOUT_STARTED', 'CONVERTED', 'ABANDONED')),
  currency text not null default 'INR' check (currency = 'INR'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (guest_session_id is not null or customer_id is not null)
);

create index carts_guest_session_idx on public.carts(guest_session_id) where guest_session_id is not null;
create index carts_customer_id_idx on public.carts(customer_id) where customer_id is not null;

create table public.cart_items (
  id uuid primary key default gen_random_uuid(),
  cart_id uuid not null references public.carts(id) on delete cascade,
  line_id text not null,
  product_variant_id uuid not null references public.product_variants(id) on delete restrict,
  quantity integer not null check (quantity between 1 and 20),
  purchase_mode text not null check (purchase_mode in ('BUY_ONCE', 'SUBSCRIPTION')),
  interval_days integer check (
    (purchase_mode = 'BUY_ONCE' and interval_days is null) or
    (purchase_mode = 'SUBSCRIPTION' and interval_days in (15, 30, 60))
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(cart_id, line_id)
);

create index cart_items_cart_id_idx on public.cart_items(cart_id);
create index cart_items_variant_id_idx on public.cart_items(product_variant_id);

create table public.commerce_quotes (
  id uuid primary key default gen_random_uuid(),
  public_id text not null unique,
  token_hash text not null,
  guest_session_id text,
  customer_id uuid references public.customers(id) on delete set null,
  cart_id uuid references public.carts(id) on delete set null,
  cart_fingerprint text not null,
  currency text not null default 'INR' check (currency = 'INR'),
  items jsonb not null check (jsonb_typeof(items) = 'array'),
  shipping_context jsonb not null default '{}'::jsonb,
  price_snapshot jsonb not null,
  pricing_version text not null,
  promotion_version text not null,
  status text not null default 'OPEN' check (status in ('OPEN', 'CONSUMED', 'EXPIRED', 'REVOKED')),
  valid_until timestamptz not null,
  consumed_at timestamptz,
  consumed_by_idempotency_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (guest_session_id is not null or customer_id is not null)
);

create index commerce_quotes_guest_status_idx on public.commerce_quotes(guest_session_id, status, valid_until);
create index commerce_quotes_customer_status_idx on public.commerce_quotes(customer_id, status, valid_until) where customer_id is not null;

create table public.checkout_sessions (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.commerce_quotes(id) on delete restrict,
  customer_id uuid not null references public.customers(id) on delete restrict,
  address_id uuid not null references public.customer_addresses(id) on delete restrict,
  guest_session_id text not null,
  state text not null default 'CHECKOUT_READY',
  payment_kind text not null check (payment_kind in ('ONE_TIME', 'RECURRING_AUTH')),
  purchase_shape text not null check (purchase_shape in ('BUY_ONCE', 'SUBSCRIPTION', 'MIXED')),
  amount_paise bigint not null check (amount_paise >= 0),
  recurring_projection_paise bigint not null default 0 check (recurring_projection_paise >= 0),
  mandate_max_amount_paise bigint check (mandate_max_amount_paise is null or mandate_max_amount_paise >= amount_paise),
  recurring_interval_days integer check (recurring_interval_days is null or recurring_interval_days in (15, 30, 60)),
  recurring_consent jsonb,
  address_snapshot jsonb not null,
  pricing_snapshot jsonb not null,
  provider_order_id text unique,
  provider_customer_id text,
  experience_token text,
  last_error jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index checkout_sessions_quote_id_idx on public.checkout_sessions(quote_id);
create unique index checkout_sessions_one_per_quote_idx on public.checkout_sessions(quote_id);
create index checkout_sessions_customer_id_idx on public.checkout_sessions(customer_id);
create index checkout_sessions_state_created_idx on public.checkout_sessions(state, created_at);

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  order_number text not null unique default private.next_uppermost_order_number(),
  checkout_session_id uuid references public.checkout_sessions(id) on delete set null,
  customer_id uuid not null references public.customers(id) on delete restrict,
  order_kind text not null default 'INITIAL' check (order_kind in ('INITIAL', 'RENEWAL')),
  status text not null default 'PAYMENT_PENDING',
  currency text not null default 'INR' check (currency = 'INR'),
  subtotal_paise bigint not null check (subtotal_paise >= 0),
  discount_paise bigint not null default 0 check (discount_paise >= 0),
  shipping_paise bigint not null default 0 check (shipping_paise >= 0),
  tax_paise bigint not null default 0 check (tax_paise >= 0),
  total_paise bigint not null check (total_paise >= 0),
  address_snapshot jsonb not null,
  pricing_snapshot jsonb not null,
  experience_token_hash text unique,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.checkout_sessions
  add column order_id uuid references public.orders(id) on delete set null;

create unique index checkout_sessions_order_id_idx on public.checkout_sessions(order_id) where order_id is not null;
create index orders_checkout_session_id_idx on public.orders(checkout_session_id) where checkout_session_id is not null;
create index orders_customer_created_idx on public.orders(customer_id, created_at desc);
create index orders_status_created_idx on public.orders(status, created_at);

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete restrict,
  product_variant_id uuid not null references public.product_variants(id) on delete restrict,
  line_id text not null,
  sku text not null,
  product_name text not null,
  variant_name text not null,
  quantity integer not null check (quantity > 0),
  purchase_mode text not null check (purchase_mode in ('BUY_ONCE', 'SUBSCRIPTION')),
  interval_days integer,
  unit_price_paise bigint not null check (unit_price_paise >= 0),
  line_subtotal_paise bigint not null check (line_subtotal_paise >= 0),
  line_total_paise bigint not null check (line_total_paise >= 0),
  snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(order_id, line_id)
);

create index order_items_order_id_idx on public.order_items(order_id);
create index order_items_variant_id_idx on public.order_items(product_variant_id);

create table public.order_adjustments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  order_item_id uuid references public.order_items(id) on delete cascade,
  promotion_id uuid references public.promotions(id) on delete set null,
  label text not null,
  adjustment_type text not null,
  scope text not null,
  amount_paise bigint not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index order_adjustments_order_id_idx on public.order_adjustments(order_id);
create index order_adjustments_item_id_idx on public.order_adjustments(order_item_id) where order_item_id is not null;
create index order_adjustments_promotion_id_idx on public.order_adjustments(promotion_id) where promotion_id is not null;

create table public.order_benefits (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  promotion_id uuid references public.promotions(id) on delete set null,
  benefit_type text not null,
  label text not null,
  metadata jsonb not null default '{}'::jsonb,
  fulfilment_status text not null default 'PENDING' check (fulfilment_status in ('PENDING', 'ALLOCATED', 'FULFILLED', 'CANCELLED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index order_benefits_order_id_idx on public.order_benefits(order_id);
create index order_benefits_promotion_id_idx on public.order_benefits(promotion_id) where promotion_id is not null;

create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete restrict,
  checkout_session_id uuid not null references public.checkout_sessions(id) on delete restrict,
  initial_order_id uuid not null references public.orders(id) on delete restrict,
  status text not null default 'PENDING_AUTH' check (status in ('PENDING_AUTH', 'ACTIVE', 'PAUSED', 'REAUTH_REQUIRED', 'CANCELLED', 'EXPIRED')),
  interval_days integer not null check (interval_days in (15, 30, 60)),
  current_cycle_number integer not null default 1 check (current_cycle_number >= 1),
  next_charge_at timestamptz,
  started_at timestamptz,
  cancelled_at timestamptz,
  pricing_context jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(checkout_session_id)
);

alter table public.orders
  add column subscription_id uuid references public.subscriptions(id) on delete set null;

create index orders_subscription_id_idx on public.orders(subscription_id) where subscription_id is not null;
create index subscriptions_customer_status_idx on public.subscriptions(customer_id, status);
create index subscriptions_next_charge_idx on public.subscriptions(status, next_charge_at) where status = 'ACTIVE';

create table public.subscription_items (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references public.subscriptions(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete restrict,
  product_variant_id uuid not null references public.product_variants(id) on delete restrict,
  source_order_item_id uuid references public.order_items(id) on delete set null,
  sku text not null,
  quantity integer not null check (quantity > 0),
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'PAUSED', 'CANCELLED')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(subscription_id, product_variant_id)
);

create index subscription_items_subscription_id_idx on public.subscription_items(subscription_id);
create index subscription_items_variant_id_idx on public.subscription_items(product_variant_id);

create table public.promotion_entitlements (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  subscription_id uuid references public.subscriptions(id) on delete cascade,
  promotion_id uuid not null references public.promotions(id) on delete cascade,
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  remaining_uses integer check (remaining_uses is null or remaining_uses >= 0),
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'PAUSED', 'EXPIRED', 'REVOKED')),
  is_grandfathered boolean not null default false,
  grant_reason text not null,
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(customer_id, subscription_id, promotion_id)
);

create index promotion_entitlements_customer_idx on public.promotion_entitlements(customer_id, status);
create index promotion_entitlements_subscription_idx on public.promotion_entitlements(subscription_id, status) where subscription_id is not null;
create index promotion_entitlements_promotion_id_idx on public.promotion_entitlements(promotion_id);
create unique index promotion_entitlements_customer_only_unique_idx
  on public.promotion_entitlements(customer_id, promotion_id)
  where subscription_id is null;

create table public.recurring_mandates (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references public.subscriptions(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete restrict,
  provider text not null default 'RAZORPAY' check (provider = 'RAZORPAY'),
  provider_customer_id text not null,
  provider_token_id text unique,
  status text not null default 'PENDING' check (status in ('PENDING', 'ACTIVE', 'PAUSED', 'REAUTH_REQUIRED', 'EXPIRED', 'CANCELLED')),
  max_amount_paise bigint not null check (max_amount_paise > 0),
  currency text not null default 'INR' check (currency = 'INR'),
  frequency text not null default 'as_presented',
  expires_at timestamptz,
  authorised_at timestamptz,
  raw_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(subscription_id)
);

create index recurring_mandates_customer_id_idx on public.recurring_mandates(customer_id);
create index recurring_mandates_status_idx on public.recurring_mandates(status);

create table public.subscription_cycles (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references public.subscriptions(id) on delete cascade,
  cycle_number integer not null check (cycle_number >= 2),
  due_at timestamptz not null,
  status text not null default 'DUE' check (status in ('DUE', 'PROCESSING', 'PAYMENT_PENDING', 'PAID', 'FAILED', 'REAUTH_REQUIRED', 'CANCELLED')),
  pre_debit_notified_at timestamptz,
  claimed_at timestamptz,
  worker_id text,
  order_id uuid references public.orders(id) on delete set null,
  pricing_snapshot jsonb,
  amount_paise bigint check (amount_paise is null or amount_paise >= 0),
  provider_order_id text unique,
  provider_payment_id text unique,
  last_error jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(subscription_id, cycle_number)
);

create index subscription_cycles_due_idx on public.subscription_cycles(status, due_at) where status = 'DUE';
create index subscription_cycles_notification_idx
  on public.subscription_cycles(due_at)
  where status = 'DUE' and pre_debit_notified_at is null;
create index subscription_cycles_subscription_idx on public.subscription_cycles(subscription_id, cycle_number desc);
create index subscription_cycles_order_id_idx on public.subscription_cycles(order_id) where order_id is not null;

create table public.payment_attempts (
  id uuid primary key default gen_random_uuid(),
  checkout_session_id uuid references public.checkout_sessions(id) on delete set null,
  subscription_cycle_id uuid references public.subscription_cycles(id) on delete set null,
  order_id uuid not null references public.orders(id) on delete restrict,
  provider text not null default 'RAZORPAY' check (provider = 'RAZORPAY'),
  kind text not null check (kind in ('ONE_TIME', 'RECURRING_AUTH', 'RECURRING_DEBIT')),
  status text not null default 'CREATED',
  amount_paise bigint not null check (amount_paise >= 0),
  currency text not null default 'INR' check (currency = 'INR'),
  provider_order_id text not null unique,
  provider_payment_id text unique,
  normalized_state text not null default 'CHECKOUT_READY',
  raw_error jsonb,
  raw_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((checkout_session_id is not null)::integer + (subscription_cycle_id is not null)::integer = 1)
);

create index payment_attempts_checkout_session_idx on public.payment_attempts(checkout_session_id) where checkout_session_id is not null;
create index payment_attempts_cycle_idx on public.payment_attempts(subscription_cycle_id) where subscription_cycle_id is not null;
create index payment_attempts_order_id_idx on public.payment_attempts(order_id);
create index payment_attempts_state_idx on public.payment_attempts(normalized_state, created_at);

create table public.payment_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'RAZORPAY',
  provider_event_id text not null,
  event_type text not null,
  payment_attempt_id uuid references public.payment_attempts(id) on delete set null,
  provider_order_id text,
  provider_payment_id text,
  signature_valid boolean not null,
  raw_payload jsonb not null,
  processed_at timestamptz,
  processing_error text,
  created_at timestamptz not null default now(),
  unique(provider, provider_event_id)
);

create index payment_events_attempt_idx on public.payment_events(payment_attempt_id) where payment_attempt_id is not null;
create index payment_events_order_idx on public.payment_events(provider_order_id) where provider_order_id is not null;

create table public.shipments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete restrict,
  provider text not null default 'SHIPROCKET' check (provider = 'SHIPROCKET'),
  status text not null default 'PENDING',
  provider_order_id text unique,
  provider_shipment_id text unique,
  courier_id text,
  courier_name text,
  awb_code text,
  expected_from date,
  expected_to date,
  raw_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(order_id)
);

create index shipments_status_idx on public.shipments(status, created_at);

create table public.tracking_events (
  id uuid primary key default gen_random_uuid(),
  shipment_id uuid not null references public.shipments(id) on delete cascade,
  provider_event_id text,
  status text not null,
  status_code text,
  description text,
  location text,
  occurred_at timestamptz not null,
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index tracking_events_shipment_time_idx on public.tracking_events(shipment_id, occurred_at desc);
create unique index tracking_events_provider_event_idx on public.tracking_events(provider_event_id) where provider_event_id is not null;

create table public.message_templates (
  id uuid primary key default gen_random_uuid(),
  message_key text not null,
  channel text not null check (channel in ('IN_APP', 'EMAIL', 'SMS', 'WHATSAPP')),
  version integer not null default 1 check (version > 0),
  title text not null,
  body text not null,
  severity text not null default 'INFO' check (severity in ('INFO', 'SUCCESS', 'WARNING', 'ERROR')),
  cta_label text,
  cta_url text,
  is_active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(message_key, channel, version)
);

create index message_templates_lookup_idx on public.message_templates(message_key, channel, is_active, version desc);

create table public.customer_messages (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  message_key text not null,
  order_id uuid references public.orders(id) on delete cascade,
  subscription_id uuid references public.subscriptions(id) on delete cascade,
  payment_attempt_id uuid references public.payment_attempts(id) on delete cascade,
  shipment_id uuid references public.shipments(id) on delete cascade,
  title text not null,
  body text not null,
  severity text not null,
  cta_label text,
  cta_url text,
  status text not null default 'UNREAD' check (status in ('UNREAD', 'READ', 'DISMISSED', 'ARCHIVED')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  read_at timestamptz
);

create index customer_messages_customer_status_idx on public.customer_messages(customer_id, status, created_at desc);
create index customer_messages_order_idx on public.customer_messages(order_id) where order_id is not null;
create index customer_messages_subscription_idx on public.customer_messages(subscription_id) where subscription_id is not null;

create table public.message_deliveries (
  id uuid primary key default gen_random_uuid(),
  customer_message_id uuid not null references public.customer_messages(id) on delete cascade,
  channel text not null check (channel in ('IN_APP', 'EMAIL', 'SMS', 'WHATSAPP')),
  provider text,
  provider_message_id text,
  status text not null default 'PENDING',
  attempt_number integer not null default 1 check (attempt_number > 0),
  request_payload jsonb,
  response_payload jsonb,
  error_payload jsonb,
  sent_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(customer_message_id, channel, attempt_number)
);

create index message_deliveries_message_idx on public.message_deliveries(customer_message_id);
create index message_deliveries_provider_id_idx on public.message_deliveries(provider_message_id) where provider_message_id is not null;

create table public.idempotency_records (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null,
  endpoint text not null,
  request_hash text not null,
  status text not null default 'PROCESSING' check (status in ('PROCESSING', 'COMPLETED', 'FAILED')),
  response_status integer,
  response_body jsonb,
  response_reference_type text,
  response_reference_id uuid,
  locked_at timestamptz not null default now(),
  completed_at timestamptz,
  expires_at timestamptz not null default (now() + interval '7 days'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(endpoint, idempotency_key)
);

create index idempotency_records_expiry_idx on public.idempotency_records(expires_at);

create or replace function public.claim_due_subscription_cycles(
  p_worker_id text,
  p_limit integer default 20
)
returns setof public.subscription_cycles
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  with due as (
    select sc.id
    from public.subscription_cycles sc
    join public.subscriptions s on s.id = sc.subscription_id
    where sc.status = 'DUE'
      and sc.due_at <= now()
      and sc.pre_debit_notified_at is not null
      and sc.pre_debit_notified_at <= now() - interval '24 hours'
      and s.status = 'ACTIVE'
    order by sc.due_at, sc.id
    limit greatest(1, least(p_limit, 100))
    for update of sc skip locked
  )
  update public.subscription_cycles sc
  set status = 'PROCESSING',
      worker_id = p_worker_id,
      claimed_at = now(),
      updated_at = now()
  from due
  where sc.id = due.id
  returning sc.*;
end;
$$;

revoke all on function public.claim_due_subscription_cycles(text, integer) from public, anon, authenticated;
grant execute on function public.claim_due_subscription_cycles(text, integer) to service_role;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'products', 'product_variants', 'customers', 'customer_addresses',
    'promotions', 'carts', 'cart_items', 'commerce_quotes', 'checkout_sessions',
    'orders', 'order_items', 'order_adjustments', 'order_benefits',
    'subscriptions', 'subscription_items', 'promotion_entitlements',
    'recurring_mandates', 'subscription_cycles', 'payment_attempts',
    'payment_events', 'shipments', 'tracking_events', 'message_templates',
    'customer_messages', 'message_deliveries', 'idempotency_records'
  ]
  loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('revoke all on table public.%I from anon, authenticated', table_name);
    execute format('grant all on table public.%I to service_role', table_name);
  end loop;
end;
$$;

grant usage, select on sequence public.uppermost_order_number_seq to service_role;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'products', 'product_variants', 'customers', 'customer_addresses',
    'promotions', 'carts', 'cart_items', 'commerce_quotes', 'checkout_sessions',
    'orders', 'order_benefits', 'subscriptions', 'subscription_items',
    'promotion_entitlements', 'recurring_mandates', 'subscription_cycles',
    'payment_attempts', 'shipments', 'message_templates', 'message_deliveries',
    'idempotency_records'
  ]
  loop
    execute format(
      'create trigger %I before update on public.%I for each row execute function private.set_updated_at()',
      table_name || '_set_updated_at',
      table_name
    );
  end loop;
end;
$$;

insert into public.products(code, name, product_family, description)
values
  ('GIR_GHEE', 'Gir Cow Ghee', 'GIR', 'Uppermost Gir Cow Ghee'),
  ('MURRAH_GHEE', 'Murrah Buffalo Ghee', 'MURRAH', 'Uppermost Murrah Buffalo Ghee')
on conflict (code) do update set
  name = excluded.name,
  product_family = excluded.product_family,
  description = excluded.description,
  updated_at = now();

insert into public.product_variants(
  product_id, sku, name, size_label, price_paise, weight_grams,
  length_cm, breadth_cm, height_cm, is_active, metadata
)
select p.id, seed.sku, seed.name, seed.size_label, seed.price_paise,
  seed.weight_grams, seed.length_cm, seed.breadth_cm, seed.height_cm,
  seed.is_active, seed.metadata
from (
  values
    ('GIR_GHEE', 'GIR-500', 'Gir Cow Ghee 500 ml', '500 ml', 0::bigint, 650, 12::numeric, 12::numeric, 14::numeric, false, '{"requires_price_configuration":true}'::jsonb),
    ('GIR_GHEE', 'GIR-1000', 'Gir Cow Ghee 1 L', '1 L', 750000::bigint, 1200, 14::numeric, 14::numeric, 18::numeric, true, '{}'::jsonb),
    ('MURRAH_GHEE', 'MURRAH-500', 'Murrah Buffalo Ghee 500 ml', '500 ml', 0::bigint, 650, 12::numeric, 12::numeric, 14::numeric, false, '{"requires_price_configuration":true}'::jsonb),
    ('MURRAH_GHEE', 'MURRAH-1000', 'Murrah Buffalo Ghee 1 L', '1 L', 550000::bigint, 1200, 14::numeric, 14::numeric, 18::numeric, true, '{}'::jsonb)
) as seed(product_code, sku, name, size_label, price_paise, weight_grams, length_cm, breadth_cm, height_cm, is_active, metadata)
join public.products p on p.code = seed.product_code
on conflict (sku) do update set
  product_id = excluded.product_id,
  name = excluded.name,
  size_label = excluded.size_label,
  price_paise = excluded.price_paise,
  weight_grams = excluded.weight_grams,
  length_cm = excluded.length_cm,
  breadth_cm = excluded.breadth_cm,
  height_cm = excluded.height_cm,
  is_active = excluded.is_active,
  metadata = excluded.metadata,
  updated_at = now();

insert into public.promotions(
  code, label, description, valid_from, valid_until, conditions, actions,
  priority, stackable, stacking_group
)
values
  (
    'GIR_1L_EARLY_BIRD', 'Gir 1 L Early Bird', '₹500 off Gir Cow Ghee 1 L during the configured launch window.',
    '2026-09-24T00:00:00+05:30', '2026-10-05T00:00:00+05:30',
    '{"skus":["GIR-1000"],"lifecycle":["INITIAL"],"audience":"NEW_SUBSCRIBERS_AND_BUYERS"}'::jsonb,
    '[{"type":"AMOUNT_OFF","amount_paise":50000,"scope":"MATCHING_LINES"}]'::jsonb,
    100, true, 'launch_price'
  ),
  (
    'MURRAH_1L_EARLY_BIRD', 'Murrah 1 L Early Bird', '₹500 off Murrah Buffalo Ghee 1 L during the configured launch window.',
    '2026-09-24T00:00:00+05:30', '2026-10-05T00:00:00+05:30',
    '{"skus":["MURRAH-1000"],"lifecycle":["INITIAL"],"audience":"NEW_SUBSCRIBERS_AND_BUYERS"}'::jsonb,
    '[{"type":"AMOUNT_OFF","amount_paise":50000,"scope":"MATCHING_LINES"}]'::jsonb,
    100, true, 'launch_price'
  ),
  (
    'THE_PAIR', 'The Pair', '₹500 benefit when the evaluated cart contains a qualifying Gir and Murrah combination.',
    '2026-09-24T00:00:00+05:30', '2027-09-24T00:00:00+05:30',
    '{"required_product_codes":["GIR_GHEE","MURRAH_GHEE"],"lifecycle":["INITIAL","RENEWAL"]}'::jsonb,
    '[{"type":"AMOUNT_OFF","amount_paise":50000,"scope":"CART"}]'::jsonb,
    80, true, 'bundle'
  ),
  (
    'SUBSCRIBER_CYCLE_2', 'Subscriber Benefit', '₹500 subscription benefit beginning with cycle 2.',
    '2026-09-24T00:00:00+05:30', null,
    '{"purchase_modes":["SUBSCRIPTION"],"lifecycle":["RENEWAL"],"minimum_subscription_cycle":2}'::jsonb,
    '[{"type":"AMOUNT_OFF","amount_paise":50000,"scope":"CART"}]'::jsonb,
    60, true, 'subscriber'
  ),
  (
    'FREE_SHIPPING_INDIA', 'Free Shipping Across India', 'Free shipping for serviceable Indian pincodes.',
    '2026-09-24T00:00:00+05:30', null,
    '{"countries":["IN"],"lifecycle":["INITIAL","RENEWAL"]}'::jsonb,
    '[{"type":"FREE_SHIPPING","scope":"SHIPPING"}]'::jsonb,
    20, true, 'shipping'
  )
on conflict (code) do update set
  label = excluded.label,
  description = excluded.description,
  valid_from = excluded.valid_from,
  valid_until = excluded.valid_until,
  conditions = excluded.conditions,
  actions = excluded.actions,
  priority = excluded.priority,
  stackable = excluded.stackable,
  stacking_group = excluded.stacking_group,
  version = public.promotions.version + 1,
  updated_at = now();

insert into public.message_templates(message_key, channel, version, title, body, severity, cta_label)
values
  ('PAYMENT_CONFIRMING', 'IN_APP', 1, 'Confirming your payment', 'Your payment is being securely confirmed. Please keep this page open.', 'INFO', null),
  ('PAYMENT_CONFIRMED', 'IN_APP', 1, 'Payment confirmed', 'Your Uppermost order is confirmed.', 'SUCCESS', 'View order journey'),
  ('PAYMENT_PENDING', 'IN_APP', 1, 'Payment pending', 'We are waiting for final confirmation. Do not make another payment yet.', 'WARNING', null),
  ('PAYMENT_FAILED', 'IN_APP', 1, 'Payment could not be completed', 'No fulfilment has started. Please retry when prompted.', 'ERROR', 'Try again'),
  ('ORDER_PREPARING', 'IN_APP', 1, 'Order being prepared', 'Your order is being prepared with care.', 'INFO', null),
  ('ORDER_SHIPPED', 'IN_APP', 1, 'Order shipped', 'Your Uppermost order is on its way.', 'SUCCESS', 'Track order'),
  ('IN_TRANSIT', 'IN_APP', 1, 'In transit', 'Your order is moving through the courier network.', 'INFO', 'Track order'),
  ('OUT_FOR_DELIVERY', 'IN_APP', 1, 'Out for delivery', 'Your order is scheduled for delivery today.', 'INFO', null),
  ('DELIVERED', 'IN_APP', 1, 'Delivered', 'Your Uppermost order has been delivered.', 'SUCCESS', null),
  ('RENEWAL_UPCOMING', 'IN_APP', 1, 'Upcoming subscription renewal', 'Your next subscription order is being prepared for payment.', 'INFO', null),
  ('RENEWAL_SUCCESS', 'IN_APP', 1, 'Renewal confirmed', 'Your subscription renewal payment is confirmed.', 'SUCCESS', 'Track order'),
  ('RENEWAL_FAILED', 'IN_APP', 1, 'Renewal needs attention', 'We could not complete this renewal. No duplicate debit will be attempted while it is unresolved.', 'ERROR', null),
  ('MANDATE_REAUTH_REQUIRED', 'IN_APP', 1, 'Mandate update required', 'The current renewal amount is above your authorised mandate maximum. Please approve a new mandate.', 'WARNING', 'Update mandate'),
  ('MANDATE_PAUSED', 'IN_APP', 1, 'Mandate paused', 'Your recurring mandate is paused. Resume it before the next renewal.', 'WARNING', 'Review mandate'),
  ('QUOTE_CHANGED', 'IN_APP', 1, 'Order total updated', 'Pricing or eligibility changed. Please review the refreshed order before paying.', 'WARNING', 'Review order')
on conflict (message_key, channel, version) do update set
  title = excluded.title,
  body = excluded.body,
  severity = excluded.severity,
  cta_label = excluded.cta_label,
  updated_at = now();
