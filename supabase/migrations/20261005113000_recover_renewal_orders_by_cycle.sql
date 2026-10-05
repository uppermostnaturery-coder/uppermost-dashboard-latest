-- Make renewal order/payment-attempt persistence recoverable and idempotent by
-- subscription_cycle_id. Provider HTTP calls remain outside these short DB
-- transactions.

create or replace function public.establish_renewal_order(
  p_cycle_id uuid,
  p_subscription_id uuid,
  p_customer_id uuid,
  p_currency text,
  p_subtotal_paise bigint,
  p_discount_paise bigint,
  p_shipping_paise bigint,
  p_tax_paise bigint,
  p_total_paise bigint,
  p_address_snapshot jsonb,
  p_pricing_snapshot jsonb,
  p_item_snapshot jsonb,
  p_price_locked_at timestamptz
)
returns table(order_id uuid, order_number text, created boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  locked_cycle public.subscription_cycles%rowtype;
  renewal_order public.orders%rowtype;
  inserted_order boolean := false;
  item jsonb;
  adjustment jsonb;
  benefit jsonb;
begin
  select * into locked_cycle
  from public.subscription_cycles sc
  where sc.id = p_cycle_id
  for update;

  if locked_cycle.id is null then
    raise exception 'Renewal cycle not found';
  end if;
  if locked_cycle.subscription_id is distinct from p_subscription_id then
    raise exception 'Renewal cycle subscription conflict';
  end if;
  if jsonb_typeof(p_item_snapshot) <> 'array' then
    raise exception 'Renewal item snapshot must be an array';
  end if;

  select * into renewal_order
  from public.orders o
  where o.subscription_cycle_id = p_cycle_id
  for update;

  if renewal_order.id is null then
    insert into public.orders (
      customer_id, subscription_id, subscription_cycle_id, order_kind,
      status, currency, subtotal_paise, discount_paise, shipping_paise,
      tax_paise, total_paise, address_snapshot, pricing_snapshot
    ) values (
      p_customer_id, p_subscription_id, p_cycle_id, 'RENEWAL',
      'PAYMENT_PENDING', p_currency, p_subtotal_paise, p_discount_paise,
      p_shipping_paise, p_tax_paise, p_total_paise, p_address_snapshot,
      p_pricing_snapshot
    )
    on conflict do nothing
    returning * into renewal_order;

    if renewal_order.id is null then
      select * into renewal_order
      from public.orders o
      where o.subscription_cycle_id = p_cycle_id
      for update;
    else
      inserted_order := true;
    end if;
  end if;

  if renewal_order.id is null then
    raise exception 'Renewal order conflict could not be recovered';
  end if;
  if renewal_order.subscription_cycle_id is distinct from p_cycle_id
     or renewal_order.subscription_id is distinct from p_subscription_id
     or renewal_order.customer_id is distinct from p_customer_id
     or renewal_order.order_kind is distinct from 'RENEWAL'
     or renewal_order.currency is distinct from p_currency
     or renewal_order.subtotal_paise is distinct from p_subtotal_paise
     or renewal_order.discount_paise is distinct from p_discount_paise
     or renewal_order.shipping_paise is distinct from p_shipping_paise
     or renewal_order.tax_paise is distinct from p_tax_paise
     or renewal_order.total_paise is distinct from p_total_paise
     or renewal_order.address_snapshot is distinct from p_address_snapshot
     or renewal_order.pricing_snapshot is distinct from p_pricing_snapshot then
    raise exception 'Existing renewal order conflicts with immutable cycle snapshot';
  end if;

  if locked_cycle.order_id is not null and locked_cycle.order_id is distinct from renewal_order.id then
    raise exception 'Renewal cycle is linked to a different order';
  end if;
  if locked_cycle.pricing_snapshot is not null and locked_cycle.pricing_snapshot is distinct from p_pricing_snapshot then
    raise exception 'Renewal cycle pricing snapshot conflict';
  end if;
  if locked_cycle.item_snapshot is not null and locked_cycle.item_snapshot is distinct from p_item_snapshot then
    raise exception 'Renewal cycle item snapshot conflict';
  end if;
  if locked_cycle.amount_paise is not null and locked_cycle.amount_paise is distinct from p_total_paise then
    raise exception 'Renewal cycle amount conflict';
  end if;
  if locked_cycle.price_locked_at is not null and locked_cycle.price_locked_at is distinct from p_price_locked_at then
    raise exception 'Renewal cycle price-lock timestamp conflict';
  end if;

  if inserted_order then
    for item in select value from jsonb_array_elements(p_item_snapshot)
    loop
      insert into public.order_items (
        order_id, product_id, product_variant_id, line_id, sku,
        product_name, variant_name, quantity, purchase_mode, interval_days,
        unit_price_paise, line_subtotal_paise, line_total_paise, snapshot
      ) values (
        renewal_order.id, (item->>'product_id')::uuid,
        (item->>'product_variant_id')::uuid, item->>'line_id', item->>'sku',
        item->>'product_name', item->>'variant_name', (item->>'qty')::integer,
        'SUBSCRIPTION', (item->>'interval_days')::integer,
        (item->>'unit_price_paise')::bigint,
        (item->>'line_subtotal_paise')::bigint,
        (item->>'line_total_paise')::bigint, item
      );
    end loop;

    for adjustment in
      select value from jsonb_array_elements(coalesce(p_pricing_snapshot->'quote'->'adjustments', '[]'::jsonb))
    loop
      insert into public.order_adjustments (
        order_id, promotion_id, label, adjustment_type, scope,
        amount_paise, metadata
      ) values (
        renewal_order.id, (adjustment->>'promotion_id')::uuid,
        adjustment->>'label', adjustment->>'type', adjustment->>'scope',
        (adjustment->>'amount_paise')::bigint,
        jsonb_build_object(
          'code', adjustment->'code',
          'applies_to_line_ids', adjustment->'applies_to_line_ids'
        )
      );
    end loop;

    for benefit in
      select value from jsonb_array_elements(coalesce(p_pricing_snapshot->'quote'->'benefits', '[]'::jsonb))
    loop
      insert into public.order_benefits (
        order_id, promotion_id, benefit_type, label, metadata
      ) values (
        renewal_order.id, (benefit->>'promotion_id')::uuid,
        benefit->>'benefit_type', benefit->>'label',
        coalesce(benefit->'metadata', '{}'::jsonb)
      );
    end loop;
  end if;

  update public.subscription_cycles sc
  set order_id = renewal_order.id,
      pricing_snapshot = p_pricing_snapshot,
      item_snapshot = p_item_snapshot,
      amount_paise = p_total_paise,
      price_locked_at = p_price_locked_at,
      updated_at = now()
  where sc.id = p_cycle_id;

  return query select renewal_order.id, renewal_order.order_number, inserted_order;
end;
$$;

revoke all on function public.establish_renewal_order(
  uuid, uuid, uuid, text, bigint, bigint, bigint, bigint, bigint,
  jsonb, jsonb, jsonb, timestamptz
) from public, anon, authenticated;
grant execute on function public.establish_renewal_order(
  uuid, uuid, uuid, text, bigint, bigint, bigint, bigint, bigint,
  jsonb, jsonb, jsonb, timestamptz
) to service_role;

create or replace function public.establish_renewal_payment_attempt(
  p_cycle_id uuid,
  p_order_id uuid,
  p_provider_order_id text,
  p_amount_paise bigint,
  p_currency text,
  p_notified_at timestamptz,
  p_scheduled_charge_at timestamptz
)
returns table(payment_attempt_id uuid, created boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  locked_cycle public.subscription_cycles%rowtype;
  renewal_order public.orders%rowtype;
  attempt public.payment_attempts%rowtype;
  inserted_attempt boolean := false;
begin
  select * into locked_cycle
  from public.subscription_cycles sc
  where sc.id = p_cycle_id
  for update;

  if locked_cycle.id is null then
    raise exception 'Renewal cycle not found';
  end if;
  if locked_cycle.order_id is distinct from p_order_id
     or locked_cycle.amount_paise is distinct from p_amount_paise then
    raise exception 'Renewal cycle payment snapshot conflict';
  end if;

  select * into renewal_order
  from public.orders o
  where o.id = p_order_id
  for update;
  if renewal_order.id is null
     or renewal_order.subscription_cycle_id is distinct from p_cycle_id
     or renewal_order.order_kind is distinct from 'RENEWAL'
     or renewal_order.currency is distinct from p_currency
     or renewal_order.total_paise is distinct from p_amount_paise then
    raise exception 'Renewal order payment snapshot conflict';
  end if;

  select * into attempt
  from public.payment_attempts pa
  where pa.subscription_cycle_id = p_cycle_id
  for update;

  if attempt.id is null then
    insert into public.payment_attempts (
      subscription_cycle_id, order_id, kind, amount_paise, currency,
      provider_order_id, status, normalized_state
    ) values (
      p_cycle_id, p_order_id, 'RECURRING_DEBIT', p_amount_paise, p_currency,
      p_provider_order_id, 'CREATED', 'AUTHORIZING'
    )
    on conflict do nothing
    returning * into attempt;

    if attempt.id is null then
      select * into attempt
      from public.payment_attempts pa
      where pa.subscription_cycle_id = p_cycle_id
      for update;
    else
      inserted_attempt := true;
    end if;
  end if;

  if attempt.id is null
     or attempt.order_id is distinct from p_order_id
     or attempt.kind is distinct from 'RECURRING_DEBIT'
     or attempt.provider_order_id is distinct from p_provider_order_id
     or attempt.amount_paise is distinct from p_amount_paise
     or attempt.currency is distinct from p_currency then
    raise exception 'Existing renewal payment attempt conflicts with provider order';
  end if;
  if locked_cycle.provider_order_id is not null
     and locked_cycle.provider_order_id is distinct from p_provider_order_id then
    raise exception 'Renewal cycle provider-order conflict';
  end if;

  update public.subscription_cycles sc
  set status = 'NOTIFIED',
      provider_order_id = p_provider_order_id,
      provider_notification_id = p_provider_order_id,
      pre_debit_notified_at = coalesce(sc.pre_debit_notified_at, p_notified_at),
      scheduled_charge_at = coalesce(sc.scheduled_charge_at, p_scheduled_charge_at),
      last_error = null,
      updated_at = now()
  where sc.id = p_cycle_id;

  return query select attempt.id, inserted_attempt;
end;
$$;

revoke all on function public.establish_renewal_payment_attempt(
  uuid, uuid, text, bigint, text, timestamptz, timestamptz
) from public, anon, authenticated;
grant execute on function public.establish_renewal_payment_attempt(
  uuid, uuid, text, bigint, text, timestamptz, timestamptz
) to service_role;
