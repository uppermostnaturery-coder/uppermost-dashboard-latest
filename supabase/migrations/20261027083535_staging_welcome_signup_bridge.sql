-- Staging signup bridge. Does not activate rules, dispatch work or call providers.
-- Existing customer and lead tables are authoritative; no historic backfill.
create table public.communication_lead_customers (
 lead_id uuid primary key references public.um_leads(id),
 customer_id uuid not null references public.customers(id),
 created_at timestamptz not null default now()
);
create index communication_lead_customers_customer_idx on public.communication_lead_customers(customer_id);
create table public.communication_welcome_intents (
 customer_id uuid not null references public.customers(id),
 logical_purpose text not null default 'WELCOME_V1' check(logical_purpose='WELCOME_V1'),
 lead_id uuid not null references public.um_leads(id),
 outbox_id uuid not null unique references public.integration_outbox(id),
 created_at timestamptz not null default now(),
 primary key(customer_id,logical_purpose)
);
create index communication_welcome_intents_lead_idx on public.communication_welcome_intents(lead_id);
alter table public.communication_lead_customers enable row level security;
alter table public.communication_welcome_intents enable row level security;
revoke all on public.communication_lead_customers,public.communication_welcome_intents from public,anon,authenticated;
grant select,insert on public.communication_lead_customers,public.communication_welcome_intents to service_role;

create function public.comm_connect_lead_welcome(p_lead_id uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare
 l public.um_leads%rowtype;
 c public.customers%rowtype;
 email_key text;phone_key text;digits text;identity_key text;
 ids uuid[];customer_id_value uuid;linked_id uuid;event_id_value uuid;
 pref public.communication_preferences%rowtype;
 consent_evidence jsonb;
begin
 select * into l from public.um_leads where id=p_lead_id for update;
 if not found then raise exception 'LEAD_NOT_FOUND';end if;
 if lower(coalesce(l.status,''))='unsubscribed' then return jsonb_build_object('status','opted_out');end if;
 -- lead_stage inside metadata is overwritten by the validated server route.
 -- The legacy lead_stage column itself is not proof of completed signup.
 if l.metadata->>'lead_stage' is distinct from 'completed'
    or l.consent_email is not true or l.consent_recorded_at is null
    or nullif(btrim(l.phone),'') is null then
  return jsonb_build_object('status','ineligible');
 end if;
 email_key:=lower(btrim(l.email));
 digits:=regexp_replace(l.phone,'[^0-9]','','g');
 if email_key !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    or length(digits)<7 or length(digits)>15 then
  return jsonb_build_object('status','ineligible');
 end if;
 phone_key:=case when length(digits)=10 then '+91'||digits else '+'||digits end;
 -- Stable lock ordering serializes both overlapping and identical signup identities.
 for identity_key in select value from unnest(array['email:'||email_key,'phone:'||phone_key]) value order by value loop
  perform pg_advisory_xact_lock(hashtextextended(identity_key,1826));
 end loop;
 select array_agg(id) into ids from public.customers
  where normalized_email=email_key or normalized_phone=phone_key;
 if cardinality(ids)>1 then raise exception 'CUSTOMER_IDENTITY_CONFLICT';end if;
 if coalesce(cardinality(ids),0)=0 then
  insert into public.customers(name,first_name,email,normalized_email,phone,normalized_phone)
   values(coalesce(nullif(btrim(concat_ws(' ',l.first_name,l.last_name)),''),'Uppermost Customer'),l.first_name,email_key,email_key,phone_key,phone_key)
   on conflict do nothing returning id into customer_id_value;
  -- A concurrent checkout can win a unique index without using our advisory locks.
  select array_agg(id) into ids from public.customers
   where normalized_email=email_key or normalized_phone=phone_key;
 end if;
 if coalesce(cardinality(ids),0)<>1 then raise exception 'CUSTOMER_IDENTITY_CONFLICT';end if;
 select * into c from public.customers where id=ids[1] for update;
 if c.normalized_email is distinct from email_key
    or (c.normalized_phone is not null and c.normalized_phone<>phone_key) then
  raise exception 'CUSTOMER_IDENTITY_CONFLICT';
 end if;
 customer_id_value:=c.id;
 -- Never rewrite a commerce customer's name/contact/Razorpay attributes or mark contacts VERIFIED.
 perform pg_advisory_xact_lock(hashtextextended('welcome:'||customer_id_value::text,1826));
 insert into public.communication_lead_customers(lead_id,customer_id)
  values(l.id,customer_id_value) on conflict(lead_id) do nothing;
 select customer_id into linked_id from public.communication_lead_customers where lead_id=l.id;
 if linked_id<>customer_id_value then raise exception 'LEAD_IDENTITY_CHANGED';end if;
 consent_evidence:=jsonb_build_object('lead_id',l.id,'recorded_at',l.consent_recorded_at,'source','COMPLETED_SIGNUP');
 insert into public.communication_preferences(customer_id,channel,purpose,allowed,source,evidence)
  values(customer_id_value,'EMAIL','MARKETING',true,'COMPLETED_SIGNUP',consent_evidence)
  on conflict(customer_id,channel,purpose) do nothing;
 -- Existing communication_preference_audit trigger writes consent history.
 select * into pref from public.communication_preferences
  where customer_id=customer_id_value and channel='EMAIL' and purpose='MARKETING' for update;
 if pref.allowed is not true then
  return jsonb_build_object('status','opted_out','customer_id',customer_id_value);
 end if;
 select outbox_id into event_id_value from public.communication_welcome_intents
  where customer_id=customer_id_value and logical_purpose='WELCOME_V1';
 if event_id_value is not null then
  return jsonb_build_object('status','already_connected','customer_id',customer_id_value,'outbox_id',event_id_value);
 end if;
 insert into public.integration_outbox(provider,operation,aggregate_id,idempotency_key,event_type,customer_id,lead_id,payload)
  values('COMMUNICATIONS','EVENT',l.id::text,'welcome:v1:'||customer_id_value::text,'lead.completed',customer_id_value,l.id,
   jsonb_build_object('logical_purpose','WELCOME_V1','template_key','UPPERMOST_WELCOME_V1','at',now()))
  returning id into event_id_value;
 insert into public.communication_welcome_intents(customer_id,lead_id,outbox_id)
  values(customer_id_value,l.id,event_id_value);
 return jsonb_build_object('status','connected','customer_id',customer_id_value,'outbox_id',event_id_value);
end;
$$;
revoke all on function public.comm_connect_lead_welcome(uuid) from public,anon,authenticated;
grant execute on function public.comm_connect_lead_welcome(uuid) to service_role;
