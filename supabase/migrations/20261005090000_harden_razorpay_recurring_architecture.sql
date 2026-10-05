-- Production hardening for Razorpay webhooks and Uppermost-owned renewals.
-- This migration is intentionally additive and keeps all commerce tables
-- private to service_role.

alter table public.payment_events
  add column if not exists processing_status text not null default 'RECEIVED',
  add column if not exists processing_started_at timestamptz,
  add column if not exists processing_attempts integer not null default 0,
  add column if not exists updated_at timestamptz not null default now();

update public.payment_events
set processing_status = case when processed_at is null then 'RECEIVED' else 'PROCESSED' end
where processing_status = 'RECEIVED';

alter table public.payment_events
  drop constraint if exists payment_events_processing_status_check;
alter table public.payment_events
  add constraint payment_events_processing_status_check
  check (processing_status in ('RECEIVED', 'PROCESSING', 'PROCESSED', 'FAILED'));

create index if not exists payment_events_processing_idx
  on public.payment_events(processing_status, updated_at);

alter table public.recurring_mandates
  add column if not exists provider_order_id text,
  add column if not exists provider_payment_id text,
  add column if not exists last_provider_event_id text,
  add column if not exists last_provider_event_created_at timestamptz;

alter table public.recurring_mandates
  drop constraint if exists recurring_mandates_status_check;
alter table public.recurring_mandates
  add constraint recurring_mandates_status_check
  check (status in ('PENDING', 'ACTIVE', 'PAUSED', 'REJECTED', 'REAUTH_REQUIRED', 'EXPIRED', 'CANCELLED'));

create index if not exists recurring_mandates_provider_order_idx
  on public.recurring_mandates(provider_order_id) where provider_order_id is not null;
create index if not exists recurring_mandates_provider_payment_idx
  on public.recurring_mandates(provider_payment_id) where provider_payment_id is not null;

alter table public.subscription_cycles
  add column if not exists notification_due_at timestamptz,
  add column if not exists scheduled_charge_at timestamptz,
  add column if not exists price_locked_at timestamptz,
  add column if not exists provider_notification_id text,
  add column if not exists item_snapshot jsonb,
  add column if not exists retry_count integer not null default 0,
  add column if not exists next_retry_at timestamptz,
  add column if not exists last_attempt_at timestamptz;

update public.subscription_cycles
set notification_due_at = due_at - interval '50 hours',
    scheduled_charge_at = due_at
where notification_due_at is null or scheduled_charge_at is null;

alter table public.subscription_cycles
  drop constraint if exists subscription_cycles_status_check;
alter table public.subscription_cycles
  add constraint subscription_cycles_status_check
  check (status in (
    'DUE', 'NOTIFICATION_PROCESSING', 'NOTIFIED', 'PROCESSING',
    'PAYMENT_PENDING', 'RECONCILIATION_PENDING', 'PAID', 'FAILED',
    'REAUTH_REQUIRED', 'CANCELLED'
  ));

alter table public.orders
  add column if not exists subscription_cycle_id uuid
  references public.subscription_cycles(id) on delete set null;

update public.orders o
set subscription_cycle_id = sc.id
from public.subscription_cycles sc
where sc.order_id = o.id and o.subscription_cycle_id is null;

create unique index if not exists orders_subscription_cycle_unique_idx
  on public.orders(subscription_cycle_id) where subscription_cycle_id is not null;
create unique index if not exists payment_attempts_subscription_cycle_unique_idx
  on public.payment_attempts(subscription_cycle_id) where subscription_cycle_id is not null;
with ranked as (
  select id, row_number() over (
    partition by message_key, order_id, payment_attempt_id
    order by created_at, id
  ) as row_number
  from public.customer_messages
  where message_key = 'RENEWAL_UPCOMING'
    and order_id is not null
    and payment_attempt_id is not null
)
delete from public.customer_messages message
using ranked
where message.id = ranked.id and ranked.row_number > 1;
create unique index if not exists customer_messages_renewal_upcoming_unique_idx
  on public.customer_messages(message_key, order_id, payment_attempt_id)
  where message_key = 'RENEWAL_UPCOMING'
    and order_id is not null
    and payment_attempt_id is not null;
with ranked as (
  select id, row_number() over (
    partition by message_key, subscription_id
    order by created_at, id
  ) as row_number
  from public.customer_messages
  where subscription_id is not null
    and message_key in ('MANDATE_REAUTH_REQUIRED', 'MANDATE_PAUSED', 'MANDATE_REJECTED', 'MANDATE_CANCELLED')
)
delete from public.customer_messages message
using ranked
where message.id = ranked.id and ranked.row_number > 1;
create unique index if not exists customer_messages_mandate_state_unique_idx
  on public.customer_messages(message_key, subscription_id)
  where subscription_id is not null
    and message_key in ('MANDATE_REAUTH_REQUIRED', 'MANDATE_PAUSED', 'MANDATE_REJECTED', 'MANDATE_CANCELLED');
create index if not exists subscription_cycles_notification_due_idx
  on public.subscription_cycles(status, notification_due_at)
  where status = 'DUE';
create index if not exists subscription_cycles_charge_due_idx
  on public.subscription_cycles(status, scheduled_charge_at, next_retry_at)
  where status in ('NOTIFIED', 'FAILED');

create or replace function public.claim_payment_webhook_event(
  p_provider text,
  p_provider_event_id text,
  p_event_type text,
  p_provider_order_id text,
  p_provider_payment_id text,
  p_signature_valid boolean,
  p_raw_payload jsonb,
  p_stale_after_seconds integer default 300
)
returns table(event_id uuid, claim_result text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_event public.payment_events%rowtype;
begin
  insert into public.payment_events (
    provider, provider_event_id, event_type, provider_order_id,
    provider_payment_id, signature_valid, raw_payload, processing_status
  ) values (
    p_provider, p_provider_event_id, p_event_type, p_provider_order_id,
    p_provider_payment_id, p_signature_valid, p_raw_payload, 'RECEIVED'
  ) on conflict (provider, provider_event_id) do nothing;

  select * into current_event
  from public.payment_events pe
  where pe.provider = p_provider and pe.provider_event_id = p_provider_event_id
  for update;

  if current_event.processing_status = 'PROCESSED' then
    return query select current_event.id, 'PROCESSED'::text;
    return;
  end if;

  if current_event.processing_status = 'PROCESSING'
     and current_event.processing_started_at > now() - make_interval(secs => greatest(30, p_stale_after_seconds)) then
    return query select current_event.id, 'IN_PROGRESS'::text;
    return;
  end if;

  update public.payment_events pe
  set processing_status = 'PROCESSING',
      processing_started_at = now(),
      processing_attempts = pe.processing_attempts + 1,
      processing_error = null,
      updated_at = now()
  where pe.id = current_event.id;

  return query select current_event.id, 'CLAIMED'::text;
end;
$$;

revoke all on function public.claim_payment_webhook_event(text, text, text, text, text, boolean, jsonb, integer)
  from public, anon, authenticated;
grant execute on function public.claim_payment_webhook_event(text, text, text, text, text, boolean, jsonb, integer)
  to service_role;

create or replace function public.apply_recurring_mandate_event(
  p_mandate_id uuid,
  p_incoming_status text,
  p_provider_event_id text,
  p_event_created_at timestamptz,
  p_provider_token_id text,
  p_provider_order_id text,
  p_provider_payment_id text,
  p_raw_metadata jsonb
)
returns table(applied boolean, resulting_status text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_mandate public.recurring_mandates%rowtype;
  next_status text;
begin
  if p_incoming_status not in ('ACTIVE', 'PAUSED', 'REJECTED', 'CANCELLED') then
    raise exception 'Unsupported mandate transition state';
  end if;

  select * into current_mandate
  from public.recurring_mandates rm
  where rm.id = p_mandate_id
  for update;

  if current_mandate.id is null then
    raise exception 'Mandate not found';
  end if;

  if p_event_created_at is not null
     and current_mandate.last_provider_event_created_at is not null
     and p_event_created_at < current_mandate.last_provider_event_created_at then
    return query select false, current_mandate.status;
    return;
  end if;

  next_status := case
    when current_mandate.status in ('CANCELLED', 'EXPIRED') then current_mandate.status
    when current_mandate.status in ('REJECTED', 'PAUSED', 'REAUTH_REQUIRED')
      then case when p_incoming_status = 'CANCELLED' then 'CANCELLED' else current_mandate.status end
    when current_mandate.status = 'ACTIVE' and p_incoming_status = 'REJECTED' then 'ACTIVE'
    else p_incoming_status
  end;

  update public.recurring_mandates rm
  set provider_token_id = coalesce(p_provider_token_id, rm.provider_token_id),
      provider_order_id = coalesce(p_provider_order_id, rm.provider_order_id),
      provider_payment_id = coalesce(p_provider_payment_id, rm.provider_payment_id),
      status = next_status,
      last_provider_event_id = p_provider_event_id,
      last_provider_event_created_at = coalesce(p_event_created_at, rm.last_provider_event_created_at),
      authorised_at = case when next_status = 'ACTIVE' and rm.authorised_at is null then now() else rm.authorised_at end,
      raw_metadata = p_raw_metadata,
      updated_at = now()
  where rm.id = p_mandate_id;

  return query select true, next_status;
end;
$$;

revoke all on function public.apply_recurring_mandate_event(uuid, text, text, timestamptz, text, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.apply_recurring_mandate_event(uuid, text, text, timestamptz, text, text, text, jsonb)
  to service_role;

create or replace function public.claim_notification_due_subscription_cycles(
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
    where (
        sc.status = 'DUE'
        or (sc.status = 'NOTIFICATION_PROCESSING' and sc.claimed_at < now() - interval '15 minutes')
      )
      and coalesce(sc.notification_due_at, sc.due_at - interval '50 hours') <= now()
      and s.status = 'ACTIVE'
    order by sc.due_at, sc.id
    limit greatest(1, least(p_limit, 100))
    for update of sc skip locked
  )
  update public.subscription_cycles sc
  set status = 'NOTIFICATION_PROCESSING', worker_id = p_worker_id,
      claimed_at = now(), updated_at = now()
  from due where sc.id = due.id
  returning sc.*;
end;
$$;

revoke all on function public.claim_notification_due_subscription_cycles(text, integer)
  from public, anon, authenticated;
grant execute on function public.claim_notification_due_subscription_cycles(text, integer)
  to service_role;

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
    where (
        sc.status = 'NOTIFIED'
        or (sc.status = 'FAILED' and sc.retry_count < 3 and sc.next_retry_at <= now())
      )
      and coalesce(sc.scheduled_charge_at, sc.due_at) <= now()
      and sc.pre_debit_notified_at is not null
      and s.status = 'ACTIVE'
    order by sc.due_at, sc.id
    limit greatest(1, least(p_limit, 100))
    for update of sc skip locked
  )
  update public.subscription_cycles sc
  set status = 'PROCESSING', worker_id = p_worker_id,
      claimed_at = now(), last_attempt_at = now(), updated_at = now()
  from due where sc.id = due.id
  returning sc.*;
end;
$$;

revoke all on function public.claim_due_subscription_cycles(text, integer) from public, anon, authenticated;
grant execute on function public.claim_due_subscription_cycles(text, integer) to service_role;

-- Existing RLS remains enabled. New columns and SECURITY DEFINER functions do
-- not grant browser roles any table access.
