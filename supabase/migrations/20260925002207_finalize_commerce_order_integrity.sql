-- Make payment finalization durable and exactly-once at the database boundary.
-- The ledgers keep release/promotion accounting auditable while the trigger
-- ensures every transition to CONFIRMED commits commerce state in one
-- transaction, whether confirmation came from browser verification or a
-- provider webhook.

create table public.order_release_commitments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  product_variant_id uuid not null references public.product_variants(id) on delete restrict,
  release_id uuid not null references public.product_variant_releases(id) on delete restrict,
  quantity integer not null check (quantity > 0),
  status text not null default 'COMMITTED'
    check (status in ('COMMITTED', 'CAPACITY_EXCEEDED')),
  created_at timestamptz not null default now(),
  unique (order_id, product_variant_id, release_id)
);

create index order_release_commitments_order_idx
  on public.order_release_commitments(order_id);
create index order_release_commitments_release_idx
  on public.order_release_commitments(release_id);

alter table public.order_release_commitments enable row level security;
revoke all on table public.order_release_commitments from anon, authenticated;
grant all on table public.order_release_commitments to service_role;

create table public.order_promotion_redemptions (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  promotion_id uuid not null references public.promotions(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (order_id, promotion_id)
);

create index order_promotion_redemptions_order_idx
  on public.order_promotion_redemptions(order_id);
create index order_promotion_redemptions_promotion_idx
  on public.order_promotion_redemptions(promotion_id);

alter table public.order_promotion_redemptions enable row level security;
revoke all on table public.order_promotion_redemptions from anon, authenticated;
grant all on table public.order_promotion_redemptions to service_role;

create or replace function private.commit_confirmed_order(p_order_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  item_record record;
  promotion_record record;
  release_record record;
  commitment_id uuid;
  redemption_id uuid;
  commitment_status text;
begin
  for item_record in
    select item.product_variant_id, sum(item.quantity)::integer as quantity
    from public.order_items item
    where item.order_id = p_order_id
    group by item.product_variant_id
  loop
    select release.id, release.release_capacity, release.release_committed
    into release_record
    from public.product_variant_releases release
    where release.product_variant_id = item_record.product_variant_id
      and release.status = 'ACTIVE'
      and (release.starts_at is null or release.starts_at <= now())
      and (release.ends_at is null or release.ends_at > now())
    order by release.starts_at desc nulls last, release.release_code asc
    limit 1
    for update;

    if release_record.id is null then
      raise exception 'No active release allocation for product variant %', item_record.product_variant_id;
    end if;

    commitment_status := case
      when release_record.release_committed + item_record.quantity <= release_record.release_capacity
        then 'COMMITTED'
      else 'CAPACITY_EXCEEDED'
    end;

    insert into public.order_release_commitments (
      order_id,
      product_variant_id,
      release_id,
      quantity,
      status
    ) values (
      p_order_id,
      item_record.product_variant_id,
      release_record.id,
      item_record.quantity,
      commitment_status
    )
    on conflict (order_id, product_variant_id, release_id) do nothing
    returning id into commitment_id;

    if commitment_id is not null then
      update public.product_variant_releases
      set release_committed = least(
        release_capacity,
        release_committed + item_record.quantity
      )
      where id = release_record.id;
    end if;

    commitment_id := null;
  end loop;

  for promotion_record in
    select distinct applied.promotion_id
    from (
      select adjustment.promotion_id
      from public.order_adjustments adjustment
      where adjustment.order_id = p_order_id
        and adjustment.promotion_id is not null
      union
      select benefit.promotion_id
      from public.order_benefits benefit
      where benefit.order_id = p_order_id
        and benefit.promotion_id is not null
    ) applied
  loop
    insert into public.order_promotion_redemptions (order_id, promotion_id)
    values (p_order_id, promotion_record.promotion_id)
    on conflict (order_id, promotion_id) do nothing
    returning id into redemption_id;

    if redemption_id is not null then
      update public.promotions
      set usage_count = usage_count + 1,
          updated_at = now()
      where id = promotion_record.promotion_id;
    end if;

    redemption_id := null;
  end loop;

  update public.customer_messages
  set status = 'ARCHIVED'
  where order_id = p_order_id
    and message_key in ('PAYMENT_FAILED', 'PAYMENT_PENDING')
    and status in ('UNREAD', 'READ');
end;
$$;

revoke all on function private.commit_confirmed_order(uuid)
  from public, anon, authenticated;
grant execute on function private.commit_confirmed_order(uuid) to service_role;

create or replace function private.orders_commit_confirmed_commerce()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'CONFIRMED' and old.status is distinct from new.status then
    perform private.commit_confirmed_order(new.id);
  end if;
  return new;
end;
$$;

revoke all on function private.orders_commit_confirmed_commerce()
  from public, anon, authenticated;

create trigger orders_commit_confirmed_commerce
after update of status on public.orders
for each row execute function private.orders_commit_confirmed_commerce();

-- Backfill any captured test orders that were confirmed before this migration.
do $$
declare
  confirmed_order record;
begin
  for confirmed_order in
    select id from public.orders where status = 'CONFIRMED'
  loop
    perform private.commit_confirmed_order(confirmed_order.id);
  end loop;
end
$$;

-- Keep one durable payment-state message per order/attempt before adding
-- database-level deduplication for concurrent webhook + verify processing.
with ranked_payment_messages as (
  select
    id,
    row_number() over (
      partition by message_key, order_id, payment_attempt_id
      order by created_at asc, id asc
    ) as row_number
  from public.customer_messages
  where order_id is not null
    and payment_attempt_id is not null
    and message_key in (
      'PAYMENT_CONFIRMED',
      'PAYMENT_FAILED',
      'RENEWAL_SUCCESS',
      'RENEWAL_FAILED'
    )
)
delete from public.customer_messages message
using ranked_payment_messages ranked
where message.id = ranked.id
  and ranked.row_number > 1;

create unique index customer_messages_payment_state_unique_idx
  on public.customer_messages(message_key, order_id, payment_attempt_id)
  where order_id is not null
    and payment_attempt_id is not null
    and message_key in (
      'PAYMENT_CONFIRMED',
      'PAYMENT_FAILED',
      'RENEWAL_SUCCESS',
      'RENEWAL_FAILED'
    );

create unique index customer_messages_shipment_state_unique_idx
  on public.customer_messages(message_key, shipment_id)
  where shipment_id is not null
    and message_key in (
      'ORDER_SHIPPED',
      'IN_TRANSIT',
      'OUT_FOR_DELIVERY',
      'DELIVERED'
    );

-- An in-app message is delivered when its durable customer-message row is
-- available. Record that delivery explicitly for observability.
insert into public.message_deliveries (
  customer_message_id,
  channel,
  provider,
  status,
  attempt_number,
  sent_at,
  delivered_at,
  created_at,
  updated_at
)
select
  message.id,
  'IN_APP',
  'UPPERMOST',
  'DELIVERED',
  1,
  message.created_at,
  message.created_at,
  message.created_at,
  now()
from public.customer_messages message
on conflict (customer_message_id, channel, attempt_number) do nothing;

-- Existing shipments can recover the EDD already captured in their immutable
-- checkout pricing snapshot.
update public.shipments shipment
set
  expected_from = coalesce(
    shipment.expected_from,
    nullif(order_row.pricing_snapshot #>> '{shipping,estimated_delivery_from}', '')::timestamptz::date
  ),
  expected_to = coalesce(
    shipment.expected_to,
    nullif(order_row.pricing_snapshot #>> '{shipping,estimated_delivery_to}', '')::timestamptz::date
  ),
  updated_at = now()
from public.orders order_row
where order_row.id = shipment.order_id
  and (
    shipment.expected_from is null
    or shipment.expected_to is null
  );
