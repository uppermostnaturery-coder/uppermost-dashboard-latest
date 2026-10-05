-- A Razorpay order can contain several distinct pay_* attempts. Keep the
-- original business order and provider order, but preserve each payment ID.
-- These names come from the original inline UNIQUE constraint and hardening
-- migration respectively. No existing payment rows are rewritten.
do $$
declare conflict_row record;
begin
  select order_id, count(*) as successes into conflict_row
  from public.payment_attempts
  where status = 'CAPTURED' or normalized_state = 'CONFIRMED'
  group by order_id having count(*) > 1 limit 1;
  if found then
    raise exception 'Multiple successful payment attempts for order % (% rows); resolve manually before applying migration',
      conflict_row.order_id, conflict_row.successes;
  end if;
end;
$$;

alter table public.payment_attempts
  drop constraint if exists payment_attempts_provider_order_id_key;
drop index if exists public.payment_attempts_subscription_cycle_unique_idx;

create index if not exists payment_attempts_provider_order_idx
  on public.payment_attempts(provider, provider_order_id);
create unique index if not exists payment_attempts_unbound_provider_order_idx
  on public.payment_attempts(provider, provider_order_id)
  where provider_payment_id is null;
-- The original provider_payment_id UNIQUE constraint remains in force.

create unique index if not exists payment_attempts_one_success_per_order_idx
  on public.payment_attempts(order_id)
  where status = 'CAPTURED' or normalized_state = 'CONFIRMED';

create or replace function public.resolve_razorpay_payment_attempt(
  p_provider_order_id text,
  p_provider_payment_id text,
  p_amount_paise bigint,
  p_currency text,
  p_checkout_session_id uuid default null,
  p_subscription_cycle_id uuid default null
)
returns setof public.payment_attempts
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing_attempt public.payment_attempts%rowtype;
  anchor public.payment_attempts%rowtype;
  parent_order public.orders%rowtype;
begin
  if nullif(p_provider_order_id, '') is null or nullif(p_provider_payment_id, '') is null
     or p_amount_paise is null or nullif(p_currency, '') is null then
    raise exception 'Payment identity is incomplete';
  end if;
  if p_checkout_session_id is not null and p_subscription_cycle_id is not null then
    raise exception 'Payment context is ambiguous';
  end if;

  -- Serializes creation/recovery for the same provider order, including
  -- simultaneous authorized and captured deliveries of the same pay_* ID.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('RAZORPAY:' || p_provider_order_id, 0));

  select * into existing_attempt
  from public.payment_attempts pa
  where pa.provider = 'RAZORPAY' and pa.provider_payment_id = p_provider_payment_id
  for update;

  select * into anchor
  from public.payment_attempts pa
  where pa.provider = 'RAZORPAY' and pa.provider_order_id = p_provider_order_id
  order by pa.created_at, pa.id
  limit 1 for update;
  if anchor.id is null then
    raise exception 'Payment provider order correlation is missing';
  end if;
  if exists (
    select 1 from public.payment_attempts pa
    where pa.provider = 'RAZORPAY' and pa.provider_order_id = p_provider_order_id
      and (pa.order_id is distinct from anchor.order_id
        or pa.checkout_session_id is distinct from anchor.checkout_session_id
        or pa.subscription_cycle_id is distinct from anchor.subscription_cycle_id
        or pa.kind is distinct from anchor.kind
        or pa.amount_paise is distinct from anchor.amount_paise
        or pa.currency is distinct from anchor.currency)
  ) then
    raise exception 'Payment provider order has conflicting local contexts';
  end if;
  select * into parent_order from public.orders o where o.id = anchor.order_id for update;
  if parent_order.id is null or parent_order.total_paise is distinct from p_amount_paise
     or parent_order.currency is distinct from p_currency
     or anchor.amount_paise is distinct from p_amount_paise
     or anchor.currency is distinct from p_currency
     or (p_checkout_session_id is not null and anchor.checkout_session_id is distinct from p_checkout_session_id)
     or (p_subscription_cycle_id is not null and anchor.subscription_cycle_id is distinct from p_subscription_cycle_id)
     or (anchor.checkout_session_id is not null and (
       parent_order.checkout_session_id is distinct from anchor.checkout_session_id
       or p_provider_order_id is distinct from
         (select cs.provider_order_id from public.checkout_sessions cs where cs.id = anchor.checkout_session_id)
       or parent_order.customer_id is distinct from
         (select cs.customer_id from public.checkout_sessions cs where cs.id = anchor.checkout_session_id)))
     or (anchor.subscription_cycle_id is not null and parent_order.id is distinct from
       (select sc.order_id from public.subscription_cycles sc where sc.id = anchor.subscription_cycle_id))
     or (anchor.subscription_cycle_id is not null and p_provider_order_id is distinct from
       (select sc.provider_order_id from public.subscription_cycles sc where sc.id = anchor.subscription_cycle_id))
     or (anchor.subscription_cycle_id is not null and parent_order.subscription_id is distinct from
       (select sc.subscription_id from public.subscription_cycles sc where sc.id = anchor.subscription_cycle_id))
     or (parent_order.subscription_id is not null and parent_order.customer_id is distinct from
       (select s.customer_id from public.subscriptions s where s.id = parent_order.subscription_id)) then
    raise exception 'Payment amount, currency, or local context mismatch';
  end if;

  if existing_attempt.id is not null then
    if existing_attempt.provider_order_id is distinct from p_provider_order_id
       or existing_attempt.order_id is distinct from anchor.order_id
       or existing_attempt.checkout_session_id is distinct from anchor.checkout_session_id
       or existing_attempt.subscription_cycle_id is distinct from anchor.subscription_cycle_id
       or existing_attempt.amount_paise is distinct from p_amount_paise
       or existing_attempt.currency is distinct from p_currency then
      raise exception 'Provider payment ID is bound to another payment context';
    end if;
    return next existing_attempt;
    return;
  end if;

  if exists (
    select 1 from public.payment_attempts pa
    where pa.order_id = anchor.order_id
      and (pa.status = 'CAPTURED' or pa.normalized_state = 'CONFIRMED')
  ) or parent_order.status = 'CONFIRMED' then
    raise exception 'Business order already has a successful payment';
  end if;

  select * into existing_attempt
  from public.payment_attempts pa
  where pa.provider = 'RAZORPAY' and pa.provider_order_id = p_provider_order_id
    and pa.provider_payment_id is null
  for update;
  if existing_attempt.id is not null then
    update public.payment_attempts pa
    set provider_payment_id = p_provider_payment_id, updated_at = now()
    where pa.id = existing_attempt.id
    returning * into existing_attempt;
    return next existing_attempt;
    return;
  end if;

  -- A different pay_* may become a sibling only after all previously bound
  -- attempts have failed. No payment ID is ever rebound or overwritten.
  if exists (
    select 1 from public.payment_attempts pa
    where pa.provider = 'RAZORPAY' and pa.provider_order_id = p_provider_order_id
      and pa.status <> 'FAILED'
  ) then
    raise exception 'Previous payment attempt is not terminal unsuccessful';
  end if;

  insert into public.payment_attempts (
    checkout_session_id, subscription_cycle_id, order_id, provider, kind,
    status, amount_paise, currency, provider_order_id,
    provider_payment_id, normalized_state
  ) values (
    anchor.checkout_session_id, anchor.subscription_cycle_id, anchor.order_id,
    'RAZORPAY', anchor.kind, 'CREATED', anchor.amount_paise, anchor.currency,
    p_provider_order_id, p_provider_payment_id, 'AUTHORIZING'
  ) returning * into existing_attempt;
  return next existing_attempt;
end;
$$;

revoke all on function public.resolve_razorpay_payment_attempt(text, text, bigint, text, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.resolve_razorpay_payment_attempt(text, text, bigint, text, uuid, uuid)
  to service_role;
