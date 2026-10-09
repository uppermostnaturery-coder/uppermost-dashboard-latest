-- Live schema contains this unused generic outbox; reconcile drift rather than invent another outbox.
create table if not exists public.integration_outbox (
 id uuid primary key default gen_random_uuid(), provider text not null, operation text not null,
 aggregate_id text not null, payload jsonb not null default '{}', idempotency_key text not null,
 status text not null default 'pending' check(status in ('pending','processing','completed','failed')),
 attempt_count integer not null default 0 check(attempt_count>=0), next_attempt_at timestamptz,
 processed_at timestamptz, last_error_code text,last_error_message text,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create unique index if not exists integration_outbox_idempotency_idx on public.integration_outbox(idempotency_key);
alter table public.integration_outbox add column if not exists event_id uuid not null default gen_random_uuid();
alter table public.integration_outbox add column if not exists event_type text;
alter table public.integration_outbox add column if not exists schema_version integer not null default 1;
alter table public.integration_outbox add column if not exists customer_id uuid references public.customers(id);
alter table public.integration_outbox add column if not exists lead_id uuid;
alter table public.integration_outbox add column if not exists lane text not null default 'REALTIME' check(lane in ('REALTIME','BULK'));
alter table public.integration_outbox add column if not exists priority integer not null default 0;
alter table public.integration_outbox add column if not exists transport_status text not null default 'PENDING' check(transport_status in ('PENDING','PUBLISHING','PUBLISHED','FAILED_RETRYABLE','FAILED_PERMANENT'));
alter table public.integration_outbox add column if not exists lease_until timestamptz;
alter table public.integration_outbox add column if not exists qstash_message_id text;
alter table public.integration_outbox add column if not exists published_at timestamptz;
create unique index outbox_event_id_idx on public.integration_outbox(event_id);
create index communication_outbox_due_idx on public.integration_outbox(lane, next_attempt_at, created_at) where provider='COMMUNICATIONS' and status in ('pending','processing');
create index outbox_customer_conversion_idx on public.integration_outbox(customer_id,event_type) where provider='COMMUNICATIONS' and status<>'completed';

create table public.communication_customer_features (
 customer_id uuid primary key references public.customers(id), order_count integer not null default 0,
 realized_spend_paise bigint not null default 0, average_order_value_paise bigint not null default 0,
 first_order_at timestamptz,last_order_at timestamptz,last_order_id uuid,last_order_total_paise bigint not null default 0,
 ordered_product_codes text[] not null default '{}',ordered_skus text[] not null default '{}',repeat_product_codes text[] not null default '{}',
 active_subscription_count integer not null default 0, subscription_status text, subscription_interval_days integer,next_subscription_charge_at timestamptz,
 last_payment_status text,last_payment_at timestamptz,last_shipment_status text,last_shipment_at timestamptz,
 discount_order_count integer not null default 0,discount_order_ratio numeric not null default 0,
 last_product_view text,top_product_affinity text,last_seen_at timestamptz,last_cart_activity_at timestamptz,
 cart_value_paise bigint not null default 0,cart_checkout_started boolean not null default false,cart_converted boolean not null default false,
 last_marketing_sent_at timestamptz,messages_last_24h integer not null default 0,messages_last_7d integer not null default 0,
 email_marketing_allowed boolean not null default false,whatsapp_marketing_allowed boolean not null default false,sms_marketing_allowed boolean not null default false,
 updated_at timestamptz not null default now()
);
create index features_last_order_idx on public.communication_customer_features(last_order_at,customer_id);
create index features_subscription_charge_idx on public.communication_customer_features(subscription_status,next_subscription_charge_at,customer_id);
create index features_abandoned_cart_idx on public.communication_customer_features(last_cart_activity_at,customer_id) where not cart_converted;
create table public.communication_projection_receipts(event_id uuid primary key, processed_at timestamptz not null default now());
create table public.communication_subscription_features (
 subscription_id uuid primary key, customer_id uuid not null references public.customers(id),status text not null,
 interval_days integer,next_charge_at timestamptz,event_at timestamptz not null
);
create index subscription_features_customer_idx on public.communication_subscription_features(customer_id);
create table public.communication_preferences (
 customer_id uuid not null references public.customers(id),channel text not null check(channel in ('EMAIL','WHATSAPP','SMS')),
 purpose text not null check(purpose in ('TRANSACTIONAL','MARKETING')),allowed boolean not null default false,
 source text not null,evidence jsonb not null default '{}',updated_at timestamptz not null default now(),
 primary key(customer_id,channel,purpose)
);
create table public.communication_preference_history (
 id uuid primary key default gen_random_uuid(),customer_id uuid not null,channel text not null,purpose text not null,
 allowed boolean not null,source text not null,evidence jsonb not null default '{}',created_at timestamptz not null default now()
);
create table public.communication_templates (
 id uuid primary key default gen_random_uuid(),logical_key text not null unique,name text not null,
 purpose text not null check(purpose in ('TRANSACTIONAL','MARKETING','AUTHENTICATION')),default_locale text not null default 'en',
 status text not null default 'DRAFT' check(status in ('DRAFT','ACTIVE','ARCHIVED')),
 legacy_message_key text,created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create table public.communication_template_versions (
 id uuid primary key default gen_random_uuid(),template_id uuid not null references public.communication_templates(id),version integer not null,
 status text not null default 'DRAFT' check(status in ('DRAFT','ACTIVE','SUPERSEDED','ARCHIVED')),
 channel text not null check(channel in ('EMAIL','WHATSAPP','SMS','LEMLIST')),
 category text not null check(category in ('TRANSACTIONAL','MARKETING','AUTHENTICATION')),
 subject text,html_content text,text_content text,structured_content jsonb not null default '{}',parameter_schema jsonb not null default '{}',
 asset_manifest jsonb not null default '[]',change_reason text,created_by uuid,created_at timestamptz not null default now(),activated_at timestamptz,
 unique(template_id,channel,version)
);
create unique index template_active_version_idx on public.communication_template_versions(template_id,channel) where status='ACTIVE';
create table public.communication_template_provider_artifacts (
 id uuid primary key default gen_random_uuid(),template_id uuid not null references public.communication_templates(id),
 template_version_id uuid not null unique references public.communication_template_versions(id),
 provider text not null check(provider in ('BREVO','META_WHATSAPP','MSG91','LEMLIST')),
 sync_mode text not null default 'DIRECT_CONTENT' check(sync_mode in ('DIRECT_CONTENT','PROVIDER_TEMPLATE','SEQUENCE_STEP','EXTERNAL_APPROVAL_MAPPING')),
 provider_template_id text,provider_template_name text,provider_category text,provider_language text,
 provider_status text not null default 'DRAFT' check(provider_status in ('NOT_REQUIRED','DRAFT','SUBMITTING','PENDING','APPROVED','REJECTED','PAUSED','DISABLED','FLAGGED','DELETED','SYNC_FAILED')),
 provider_status_reason text,provider_payload_snapshot jsonb not null default '{}',submitted_at timestamptz,approved_at timestamptz,rejected_at timestamptz,
 last_provider_event_at timestamptz,last_synced_at timestamptz,last_error text,
 dlt_entity_id text,dlt_header_id text,dlt_template_id text,dlt_status text,msg91_template_id text,msg91_status text,
 lemlist_campaign_id text,lemlist_sequence_id text,lemlist_step_id text,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
-- Enrollment executes the whole provider campaign: every immutable version needs its own campaign.
create unique index lemlist_version_campaign_idx on public.communication_template_provider_artifacts(lemlist_campaign_id)
 where provider='LEMLIST' and lemlist_campaign_id is not null;
create table public.communication_assets (
 id uuid primary key default gen_random_uuid(),type text not null check(type in ('IMAGE','VIDEO','DOCUMENT')),
 storage_provider text not null,storage_path text,public_url text not null,mime_type text,file_size bigint,width integer,height integer,
 poster_asset_id uuid references public.communication_assets(id),metadata jsonb not null default '{}',created_at timestamptz not null default now()
);
create table public.communication_rules (
 id uuid primary key default gen_random_uuid(),name text not null,description text,
 status text not null default 'DRAFT' check(status in ('DRAFT','ACTIVE','PAUSED','ARCHIVED')),version integer not null default 1,
 trigger_type text not null check(trigger_type in ('EVENT','SCHEDULE','MANUAL')),trigger_event_type text,cron_expression text,
 timezone text not null default 'Asia/Kolkata',condition_config jsonb not null default '{"all":[]}',action_config jsonb not null default '{}',
 channel_strategy jsonb not null default '[]',priority integer not null default 0,frequency_cap jsonb not null default '{}',quiet_hours jsonb not null default '{}',
 valid_from timestamptz,valid_until timestamptz,last_scheduled_at timestamptz,last_started_at timestamptz,last_completed_at timestamptz,
 last_status text,last_error text,next_run_at timestamptz,created_by uuid,approved_by uuid,approved_at timestamptz,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create index rules_due_idx on public.communication_rules(next_run_at) where status='ACTIVE' and trigger_type='SCHEDULE';
create index rules_event_idx on public.communication_rules(trigger_event_type) where status='ACTIVE' and trigger_type='EVENT';
create table public.communication_runs (
 id uuid primary key default gen_random_uuid(),rule_id uuid not null references public.communication_rules(id),rule_version integer not null,
 dedupe_key text not null unique,rule_snapshot jsonb not null,status text not null default 'QUEUED',
 dry_run boolean not null default true,subject_customer_id uuid,source_message_id uuid references public.customer_messages(id),event_context jsonb not null default '{}',cursor_customer_id uuid,contacts_processed integer not null default 0,
 query_duration_ms integer not null default 0,batch_count integer not null default 0,last_error text,
 started_at timestamptz,completed_at timestamptz,created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create table public.communication_run_recipients (
 id uuid primary key default gen_random_uuid(),run_id uuid not null references public.communication_runs(id),customer_id uuid not null references public.customers(id),
 status text not null default 'PENDING',message_id uuid references public.customer_messages(id),suppression_reason text,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(run_id,customer_id)
);
create index recipients_pending_idx on public.communication_run_recipients(run_id,status,id);
alter table public.message_deliveries add column if not exists dedupe_key text;
alter table public.message_deliveries add column if not exists template_version_id uuid references public.communication_template_versions(id);
alter table public.message_deliveries add column if not exists run_recipient_id uuid references public.communication_run_recipients(id);
alter table public.message_deliveries add column if not exists lease_until timestamptz;
alter table public.message_deliveries add column if not exists next_attempt_at timestamptz;
alter table public.message_deliveries add column if not exists latency_ms integer;
alter table public.message_deliveries add column if not exists suppression_reason text;
alter table public.message_deliveries add column if not exists retry_count integer not null default 0;
-- Test sends reuse the existing message/delivery ledger without creating a commerce customer.
alter table public.customer_messages alter column customer_id drop not null;
alter table public.customer_messages add constraint communication_message_subject_check check(customer_id is not null or metadata->>'communication_test'='true') not valid;
alter table public.message_deliveries drop constraint if exists message_deliveries_channel_check;
alter table public.message_deliveries add constraint message_deliveries_channel_check check(channel in ('IN_APP','EMAIL','WHATSAPP','SMS','LEMLIST')) not valid;
create unique index deliveries_dedupe_idx on public.message_deliveries(dedupe_key) where dedupe_key is not null;
-- Preserve the live legacy ledger's status contract and add the explicitly configured dry-run state.
do $$begin
 if to_regclass('public.whatsapp_messages') is not null then
  alter table public.whatsapp_messages drop constraint if exists whatsapp_messages_status_check;
  alter table public.whatsapp_messages add constraint whatsapp_messages_status_check check(status in ('queued','sent','delivered','read','failed','DRY_RUN')) not valid;
 end if;
end$$;
create index deliveries_retry_idx on public.message_deliveries(next_attempt_at,id) where status='FAILED_RETRYABLE';
create table public.communication_provider_events (
 provider text not null,event_id text not null,payload jsonb not null default '{}',applied_at timestamptz,created_at timestamptz not null default now(),primary key(provider,event_id)
);
create table public.communication_marketing_reservations (
 id uuid primary key references public.message_deliveries(id),customer_id uuid not null,channel text not null,
 status text not null default 'RESERVED',reserved_at timestamptz not null default now()
);
create index marketing_customer_time_idx on public.communication_marketing_reservations(customer_id,reserved_at desc);
create table public.communication_rate_limits (
 bucket_key text primary key,window_start timestamptz not null,count integer not null default 0
);
create table public.communication_otp_challenges (
 id uuid primary key default gen_random_uuid(),customer_id uuid references public.customers(id),phone text,email text,
 otp_hash text not null,encrypted_otp text not null,expires_at timestamptz not null,attempts integer not null default 0,
 verified_at timestamptz,send_channel_index integer not null default 0,send_state text not null default 'PENDING',last_sent_at timestamptz,send_lease_until timestamptz,provider_attempted_at timestamptz,created_at timestamptz not null default now()
);
create table public.communication_recovery_cursors (
 source text primary key,cursor_id uuid,last_completed_at timestamptz,updated_at timestamptz not null default now()
);

-- Immutable canonical content; status changes are the only edits after leaving DRAFT.
create function private.guard_template_version() returns trigger language plpgsql set search_path='' as $$ begin
 if old.status<>'DRAFT' and new.status='DRAFT' then raise exception 'IMMUTABLE_TEMPLATE_VERSION';end if;
 if old.status <> 'DRAFT' and (to_jsonb(new)-'status'-'activated_at') is distinct from (to_jsonb(old)-'status'-'activated_at') then raise exception 'IMMUTABLE_TEMPLATE_VERSION'; end if;
 return new;
end $$;
create trigger template_version_immutable before update on public.communication_template_versions for each row execute function private.guard_template_version();

-- Durable bridge catches failures inside a subtransaction: downstream storage cannot veto commerce.
create function private.capture_communication_event() returns trigger language plpgsql security definer set search_path='' as $$
declare facts jsonb; kind text; customer uuid; dedupe text; begin
 if tg_table_name='customer_messages' then
   if coalesce(new.metadata->>'communication_engine','false')='true' then return new; end if;
   kind:='customer.message.created';customer:=new.customer_id;facts:=jsonb_build_object('message_id',new.id,'message_key',new.message_key,'order_id',new.order_id,'at',new.created_at);dedupe:='message:'||new.id;
 elsif tg_table_name='orders' then
   if new.status<>'CONFIRMED' or (tg_op='UPDATE' and old.status='CONFIRMED') then return new; end if;
   kind:='commerce.order.confirmed';customer:=new.customer_id;dedupe:='order:'||new.id||':confirmed';
   facts:=jsonb_build_object('order_id',new.id,'order_number',new.order_number,'total_paise',new.total_paise,'discount_paise',new.discount_paise,'at',new.updated_at,
     'skus',(select coalesce(jsonb_agg(distinct sku),'[]') from public.order_items where order_id=new.id),
     'product_codes',(select coalesce(jsonb_agg(distinct snapshot->>'product_code'),'[]') from public.order_items where order_id=new.id));
 elsif tg_table_name='subscriptions' then
   kind:='commerce.subscription.changed';customer:=new.customer_id;dedupe:='subscription:'||new.id||':'||new.updated_at;
   facts:=jsonb_build_object('subscription_id',new.id,'status',new.status,'interval_days',new.interval_days,'next_charge_at',new.next_charge_at,'at',new.updated_at);
 elsif tg_table_name='payment_attempts' then
   kind:='commerce.payment.changed';
   select customer_id into customer from public.orders where id=new.order_id;
   dedupe:='payment:'||new.id||':'||new.status;
   facts:=jsonb_build_object('payment_id',new.id,'order_id',new.order_id,'status',new.status,'at',new.updated_at);
 else
   kind:='commerce.shipment.changed';select customer_id into customer from public.orders where id=new.order_id;
   dedupe:='shipment:'||new.id||':'||new.status;facts:=jsonb_build_object('shipment_id',new.id,'order_id',new.order_id,'status',new.status,'at',new.updated_at);
 end if;
 insert into public.integration_outbox(provider,operation,aggregate_id,idempotency_key,event_type,customer_id,payload)
   values('COMMUNICATIONS','EVENT',new.id::text,dedupe,kind,customer,facts) on conflict(idempotency_key) do nothing;
 return new;
exception when others then
 raise warning 'communication_capture_failed table=% sqlstate=%',tg_table_name,sqlstate;
 return new;
end $$;
create trigger communication_message_bridge after insert on public.customer_messages for each row execute function private.capture_communication_event();
create trigger communication_order_bridge after update of status on public.orders for each row when (new.status is distinct from old.status) execute function private.capture_communication_event();
create trigger communication_subscription_bridge after insert or update on public.subscriptions for each row execute function private.capture_communication_event();
create trigger communication_payment_bridge after insert or update of status on public.payment_attempts for each row execute function private.capture_communication_event();
create trigger communication_shipment_bridge after insert or update of status on public.shipments for each row execute function private.capture_communication_event();

create function public.comm_apply_projection(p_outbox_id uuid) returns void language plpgsql set search_path='' as $$
declare e public.integration_outbox; f public.communication_customer_features; stamp timestamptz; inserted integer; codes text[]; skus text[]; begin
 select * into e from public.integration_outbox where id=p_outbox_id and provider='COMMUNICATIONS';
 if not found or e.customer_id is null then return; end if;
 insert into public.communication_projection_receipts(event_id) values(e.event_id) on conflict do nothing;
 get diagnostics inserted=row_count;if inserted=0 then return;end if;
 stamp:=coalesce((e.payload->>'at')::timestamptz,e.created_at);
 insert into public.communication_customer_features(customer_id) values(e.customer_id) on conflict do nothing;
 if e.event_type='commerce.order.confirmed' then
   select coalesce(array_agg(value),'{}') into codes from jsonb_array_elements_text(e.payload->'product_codes');
   select coalesce(array_agg(value),'{}') into skus from jsonb_array_elements_text(e.payload->'skus');
   update public.communication_customer_features set order_count=order_count+1,realized_spend_paise=realized_spend_paise+(e.payload->>'total_paise')::bigint,
    average_order_value_paise=(realized_spend_paise+(e.payload->>'total_paise')::bigint)/(order_count+1),
    first_order_at=least(first_order_at,stamp),last_order_at=greatest(last_order_at,stamp),
    last_order_id=case when stamp>=coalesce(last_order_at,'epoch') then (e.payload->>'order_id')::uuid else last_order_id end,
    last_order_total_paise=case when stamp>=coalesce(last_order_at,'epoch') then (e.payload->>'total_paise')::bigint else last_order_total_paise end,
    repeat_product_codes=(select coalesce(array_agg(distinct v),'{}') from unnest(repeat_product_codes || array(select unnest(codes) intersect select unnest(ordered_product_codes))) v),
    ordered_product_codes=(select coalesce(array_agg(distinct v),'{}') from unnest(ordered_product_codes||codes) v),
    ordered_skus=(select coalesce(array_agg(distinct v),'{}') from unnest(ordered_skus||skus) v),
    discount_order_count=discount_order_count+case when (e.payload->>'discount_paise')::bigint>0 then 1 else 0 end,
    discount_order_ratio=(discount_order_count+case when (e.payload->>'discount_paise')::bigint>0 then 1 else 0 end)::numeric/(order_count+1),
    cart_converted=case when stamp>=coalesce(last_cart_activity_at,'epoch') then true else cart_converted end,updated_at=now() where customer_id=e.customer_id;
 elsif e.event_type='commerce.subscription.changed' then
   insert into public.communication_subscription_features(subscription_id,customer_id,status,interval_days,next_charge_at,event_at)
     values((e.payload->>'subscription_id')::uuid,e.customer_id,e.payload->>'status',(e.payload->>'interval_days')::integer,(e.payload->>'next_charge_at')::timestamptz,stamp)
     on conflict(subscription_id) do update set status=excluded.status,interval_days=excluded.interval_days,next_charge_at=excluded.next_charge_at,event_at=excluded.event_at
     where excluded.event_at>=public.communication_subscription_features.event_at;
   update public.communication_customer_features set active_subscription_count=(select count(*) from public.communication_subscription_features where customer_id=e.customer_id and status='ACTIVE'),
    subscription_status=case when exists(select 1 from public.communication_subscription_features where customer_id=e.customer_id and status='ACTIVE') then 'ACTIVE' else e.payload->>'status' end,
    subscription_interval_days=(select interval_days from public.communication_subscription_features where customer_id=e.customer_id order by event_at desc limit 1),
    next_subscription_charge_at=(select min(next_charge_at) from public.communication_subscription_features where customer_id=e.customer_id and status='ACTIVE'),updated_at=now() where customer_id=e.customer_id;
 elsif e.event_type='commerce.payment.changed' then
   update public.communication_customer_features set last_payment_status=e.payload->>'status',last_payment_at=stamp,updated_at=now()
    where customer_id=e.customer_id and stamp>=coalesce(last_payment_at,'epoch');
 elsif e.event_type='commerce.shipment.changed' then
   update public.communication_customer_features set last_shipment_status=e.payload->>'status',last_shipment_at=stamp,updated_at=now()
    where customer_id=e.customer_id and stamp>=coalesce(last_shipment_at,'epoch');
 end if;
end $$;

create function private.project_communication_behavior() returns trigger language plpgsql set search_path='' as $$ begin
 if new.customer_id is null then return new; end if;
 insert into public.communication_customer_features(customer_id,last_seen_at,last_product_view,last_cart_activity_at,cart_value_paise,cart_checkout_started)
 values(new.customer_id,new.last_seen_at,new.last_product_view,new.recent_add_to_cart_at,new.cart_value_paise,new.last_checkout_started_at is not null)
 on conflict(customer_id) do update set last_seen_at=greatest(public.communication_customer_features.last_seen_at,excluded.last_seen_at),
 last_product_view=case when excluded.last_seen_at>=coalesce(public.communication_customer_features.last_seen_at,'epoch') then excluded.last_product_view else public.communication_customer_features.last_product_view end,
 last_cart_activity_at=greatest(public.communication_customer_features.last_cart_activity_at,excluded.last_cart_activity_at),
 cart_value_paise=case when excluded.last_cart_activity_at>=coalesce(public.communication_customer_features.last_cart_activity_at,'epoch') then excluded.cart_value_paise else public.communication_customer_features.cart_value_paise end,
 cart_checkout_started=excluded.cart_checkout_started,
 cart_converted=case when excluded.last_cart_activity_at>coalesce(public.communication_customer_features.last_order_at,'epoch') then false else public.communication_customer_features.cart_converted end,updated_at=now();
 return new;
exception when others then raise warning 'behavior_projection_failed sqlstate=%',sqlstate; return new;
end $$;
create trigger communication_behavior_project after insert or update on public.communication_behavior_features for each row execute function private.project_communication_behavior();

create function public.comm_claim_outbox(p_limit integer default 50) returns setof public.integration_outbox language plpgsql set search_path='' as $$ begin
 -- Exhausted work stays durable for operator inspection. Never silently loop forever.
 with exhausted as (select id from public.integration_outbox where provider='COMMUNICATIONS' and status in ('pending','processing')
  and attempt_count>=20 and coalesce(lease_until,'epoch')<now() order by created_at limit 50 for update skip locked)
 update public.integration_outbox o set status='failed',transport_status='FAILED_PERMANENT',lease_until=null,
  last_error_code='TRANSPORT_ATTEMPTS_EXHAUSTED',last_error_message='Transport attempt limit reached; inspect before replay',updated_at=now()
 from exhausted where o.id=exhausted.id;
 return query
 with due as (select id from public.integration_outbox where provider='COMMUNICATIONS' and status in ('pending','processing')
  and attempt_count<20 and coalesce(next_attempt_at,'epoch')<=now() and coalesce(lease_until,'epoch')<now()
  order by case lane when 'REALTIME' then 0 else 1 end,priority desc,created_at limit least(greatest(p_limit,1),50) for update skip locked)
 update public.integration_outbox o set status='processing',transport_status='PUBLISHING',lease_until=now()+interval '2 minutes',attempt_count=attempt_count+1,updated_at=now()
 from due where o.id=due.id returning o.*;
end
$$;

-- Rules compile exclusively to this read model. No user SQL/JS is stored or executed.
create function private.communication_predicate(c jsonb, depth integer default 0) returns text language plpgsql immutable set search_path='' as $$
declare k text; f text; op text; v jsonb; result text; operator text; typ text; begin
 if depth>5 or octet_length(c::text)>8192 then raise exception 'RULE_COMPLEXITY_LIMIT';end if;
 foreach k in array array['all','any','none'] loop
  if c ? k then
   if jsonb_array_length(c->k)>20 then raise exception 'RULE_COMPLEXITY_LIMIT';end if;
   select string_agg('('||private.communication_predicate(value,depth+1)||')',case when k='all' then ' AND ' else ' OR ' end) into result from jsonb_array_elements(c->k);
   result:=coalesce(result,case when k='all' then 'TRUE' else 'FALSE' end);
   return case when k='none' then 'NOT ('||result||')' else result end;
  end if;
 end loop;
 f:=c->>'field';op:=c->>'op';v:=c->'value';
 if f = any(array['order_count','realized_spend_paise','average_order_value_paise','last_order_total_paise','active_subscription_count','discount_order_ratio','cart_value_paise']) then typ:='numeric';
 elsif f = any(array['last_order_at','first_order_at','next_subscription_charge_at','last_seen_at','last_cart_activity_at']) then typ:='timestamptz';
 elsif f = any(array['cart_checkout_started','cart_converted','email_marketing_allowed','whatsapp_marketing_allowed','sms_marketing_allowed']) then typ:='boolean';
 elsif f = any(array['subscription_status','last_payment_status','last_shipment_status','last_product_view']) then typ:='text';
 elsif f = any(array['ordered_product_codes','ordered_skus']) then typ:='text[]';
 else raise exception 'INVALID_RULE_FIELD';end if;
 if op='exists' then return format('%I IS %sNULL',f,case when v='false'::jsonb then '' else 'NOT ' end);end if;
 if op in ('days_since_gte','days_since_lte') and typ='timestamptz' then
  return format('%I %s (now() - make_interval(days => %s))',f,case when op='days_since_gte' then '<=' else '>=' end,greatest(0,least(3650,(v#>>'{}')::integer)));
 end if;
 if op='contains' and typ='text[]' then return format('%I @> ARRAY[%L]::text[]',f,v#>>'{}');end if;
 if op in ('in','not_in') then
  if jsonb_array_length(v)>20 then raise exception 'RULE_COMPLEXITY_LIMIT';end if;
  select string_agg(format('%L::%s',value,typ),',') into result from jsonb_array_elements_text(v);
  return format('%I %s (%s)',f,case when op='in' then 'IN' else 'NOT IN' end,coalesce(result,'NULL'));
 end if;
 operator:=case op when 'eq' then '=' when 'neq' then '<>' when 'gt' then '>' when 'gte' then '>=' when 'lt' then '<' when 'lte' then '<=' when 'before' then '<' when 'after' then '>' else null end;
 if operator is null or typ='text[]' then raise exception 'INVALID_RULE_OPERATOR';end if;
 return format('%I %s %L::%s',f,operator,v#>>'{}',typ);
end $$;

create function public.comm_audience(p_condition jsonb,p_cursor uuid default null,p_limit integer default 500,p_subject uuid default null)
 returns setof public.communication_customer_features language plpgsql set search_path='' set statement_timeout='2s' as $$ begin
 -- Parenthesize the entire DSL so OR cannot escape either the subject or keyset scope.
 return query execute format('select * from public.communication_customer_features where (%s) and ($1 is null or customer_id>$1) and ($3 is null or customer_id=$3) order by customer_id limit $2',private.communication_predicate(p_condition))
 using p_cursor,least(greatest(p_limit,1),500),p_subject;
end $$;

create function public.comm_start_run(p_rule_id uuid,p_expected_next timestamptz,p_next timestamptz,p_key text,p_dry boolean default true,p_subject uuid default null,p_message uuid default null,p_context jsonb default '{}')
 returns uuid language plpgsql set search_path='' as $$
declare r public.communication_rules; run_id uuid; begin
 select * into r from public.communication_rules where id=p_rule_id for update;
 if not found or r.status<>'ACTIVE' or (r.valid_from is not null and r.valid_from>now()) or (r.valid_until is not null and r.valid_until<=now()) then return null;end if;
 if p_expected_next is not null and (r.next_run_at is distinct from p_expected_next or r.next_run_at>now()) then return null;end if;
 insert into public.communication_runs(rule_id,rule_version,dedupe_key,rule_snapshot,dry_run,subject_customer_id,source_message_id,event_context)
 values(r.id,r.version,p_key,to_jsonb(r),p_dry,p_subject,p_message,p_context) on conflict(dedupe_key) do nothing returning id into run_id;
 if run_id is null then return null;end if;
 update public.communication_rules set next_run_at=case when p_expected_next is null then next_run_at else p_next end,last_scheduled_at=now(),last_status='QUEUED' where id=r.id;
 insert into public.integration_outbox(provider,operation,aggregate_id,idempotency_key,event_type,lane,payload)
 values('COMMUNICATIONS','AUDIENCE',run_id::text,'run:'||run_id,'communication.run.started',case when p_subject is not null then 'REALTIME' else 'BULK' end,jsonb_build_object('run_id',run_id));
 return run_id;
end $$;

create function public.comm_prepare_recipients(p_run_id uuid) returns integer language plpgsql set search_path='' as $$
declare r public.communication_runs;recipient public.communication_run_recipients;entry record;v public.communication_template_versions;msg uuid;delivery uuid;n integer:=0;begin
 select * into r from public.communication_runs where id=p_run_id;
 if not found or r.status='PAUSED_PERFORMANCE_GUARD' then return 0;end if;
 for recipient in select * from public.communication_run_recipients where run_id=r.id and status='PENDING' order by id limit 50 for update skip locked loop
  msg:=r.source_message_id;
  if msg is null then
   insert into public.customer_messages(customer_id,message_key,title,body,severity,metadata)
   values(recipient.customer_id,'COMMUNICATION_RULE',r.rule_snapshot->>'name','Scheduled communication','INFO',jsonb_build_object('communication_engine',true,'run_id',r.id)) returning id into msg;
  end if;
  for entry in select key,value from jsonb_each_text(r.rule_snapshot->'action_config'->'templates') loop
   select * into v from public.communication_template_versions where id=entry.value::uuid and channel=entry.key and status in ('ACTIVE','SUPERSEDED');
   if not found then raise exception 'INVALID_ACTIVE_TEMPLATE';end if;
   delivery:=null;
   insert into public.message_deliveries(customer_message_id,channel,provider,template_version_id,run_recipient_id,dedupe_key)
   values(msg,v.channel,case v.channel when 'EMAIL' then 'BREVO' when 'WHATSAPP' then 'META_WHATSAPP' when 'SMS' then 'MSG91' else 'LEMLIST' end,v.id,recipient.id,
    msg||':'||v.channel||':'||v.id||':'||recipient.customer_id)
   on conflict do nothing returning id into delivery;
   if delivery is not null then
    insert into public.integration_outbox(provider,operation,aggregate_id,idempotency_key,event_type,lane,payload)
    values('COMMUNICATIONS','SEND',delivery::text,'send:'||delivery,'communication.delivery.ready',case when v.category='MARKETING' then 'BULK' else 'REALTIME' end,jsonb_build_object('delivery_id',delivery,'provider',case v.channel when 'EMAIL' then 'brevo' when 'WHATSAPP' then 'whatsapp' when 'SMS' then 'msg91' else 'lemlist' end));
   end if;
  end loop;
  update public.communication_run_recipients set message_id=msg,status='QUEUED',updated_at=now() where id=recipient.id;n:=n+1;
 end loop;
 if exists(select 1 from public.communication_run_recipients where run_id=r.id and status='PENDING') then
  insert into public.integration_outbox(provider,operation,aggregate_id,idempotency_key,event_type,lane,payload)
  values('COMMUNICATIONS','RECIPIENTS',r.id::text,'recipients-advance:'||gen_random_uuid(),'communication.recipients.advance','BULK',jsonb_build_object('run_id',r.id));
 elsif r.status='SNAPSHOTTED' then
  update public.communication_runs set status='COMPLETED',completed_at=now(),updated_at=now() where id=r.id;
  update public.communication_rules set last_completed_at=now(),last_status='COMPLETED' where id=r.rule_id;
 end if;return n;
end $$;

create function public.comm_snapshot_batch(p_run_id uuid) returns integer language plpgsql set search_path='' set statement_timeout='3s' as $$
declare r public.communication_runs; ids uuid[]; candidate uuid; cnt integer; started timestamptz:=clock_timestamp();begin
 select * into r from public.communication_runs where id=p_run_id for update;
 if not found or r.status in ('COMPLETED','PAUSED_PERFORMANCE_GUARD','FAILED_PERMANENT') then return 0;end if;
 select array_agg(customer_id order by customer_id) into ids from public.comm_audience(r.rule_snapshot->'condition_config',r.cursor_customer_id,500,r.subject_customer_id);
 cnt:=coalesce(cardinality(ids),0);
 foreach candidate in array coalesce(ids,'{}') loop
  insert into public.communication_run_recipients(run_id,customer_id) values(r.id,candidate) on conflict(run_id,customer_id) do nothing;
 end loop;
 update public.communication_runs set cursor_customer_id=case when cnt>0 then ids[cnt] else cursor_customer_id end,
 contacts_processed=contacts_processed+cnt,batch_count=batch_count+1,query_duration_ms=(extract(epoch from clock_timestamp()-started)*1000)::integer,
 status=case when cnt<500 or r.subject_customer_id is not null then 'SNAPSHOTTED' else 'PROCESSING' end,started_at=coalesce(started_at,now()),updated_at=now() where id=r.id;
 insert into public.integration_outbox(provider,operation,aggregate_id,idempotency_key,event_type,lane,payload)
 values('COMMUNICATIONS','RECIPIENTS',r.id::text,'recipients:'||r.id||':'||(r.batch_count+1),'communication.recipients.ready',case when r.subject_customer_id is not null then 'REALTIME' else 'BULK' end,jsonb_build_object('run_id',r.id)) on conflict do nothing;
 if cnt=500 and r.subject_customer_id is null then
  insert into public.integration_outbox(provider,operation,aggregate_id,idempotency_key,event_type,lane,payload)
  values('COMMUNICATIONS','AUDIENCE',r.id::text,'audience:'||r.id||':'||ids[cnt],'communication.run.advance','BULK',jsonb_build_object('run_id',r.id)) on conflict do nothing;
 end if;
 return cnt;
end $$;

-- Atomic delivery reservation across duplicate QStash invocations. Expired SENDING is ambiguous, never resent.
create function public.comm_claim_delivery(p_id uuid) returns setof public.message_deliveries language sql set search_path='' as $$
 update public.message_deliveries set status='SENDING',lease_until=now()+interval '2 minutes',updated_at=now()
 where id=p_id and dedupe_key is not null and status in ('PENDING','FAILED_RETRYABLE') and coalesce(next_attempt_at,'epoch')<=now() returning *;
$$;

create function public.comm_reserve_marketing(p_delivery_id uuid,p_customer_id uuid,p_channel text,p_max_week integer,p_cooldown_hours integer)
 returns boolean language plpgsql set search_path='' as $$ begin
 perform pg_advisory_xact_lock(hashtextextended(p_customer_id::text,938));
 if exists(select 1 from public.communication_marketing_reservations where id=p_delivery_id) then return true;end if;
 if (select count(*) from public.communication_marketing_reservations where customer_id=p_customer_id and reserved_at>now()-interval '7 days' and status<>'CANCELLED') >= least(greatest(p_max_week,1),10)
 or exists(select 1 from public.communication_marketing_reservations where customer_id=p_customer_id and reserved_at>now()-make_interval(hours=>greatest(p_cooldown_hours,1)) and status<>'CANCELLED') then return false;end if;
 insert into public.communication_marketing_reservations(id,customer_id,channel) values(p_delivery_id,p_customer_id,p_channel);return true;
end $$;

create function public.comm_activate_template(p_version_id uuid) returns void language plpgsql set search_path='' as $$
declare v public.communication_template_versions;a public.communication_template_provider_artifacts;begin
 select * into v from public.communication_template_versions where id=p_version_id for update;
 if not found or v.status<>'DRAFT' then raise exception 'INVALID_TEMPLATE_VERSION';end if;
 perform pg_advisory_xact_lock(hashtextextended(v.template_id::text||v.channel,655));
 select * into a from public.communication_template_provider_artifacts where template_version_id=v.id;
 if v.channel='WHATSAPP' and (a.provider_status is distinct from 'APPROVED') then raise exception 'PROVIDER_APPROVAL_REQUIRED';end if;
 if v.channel='SMS' and (a.dlt_status is distinct from 'APPROVED' or a.msg91_status is distinct from 'READY' or a.dlt_entity_id is null or a.dlt_header_id is null or a.dlt_template_id is null or a.msg91_template_id is null) then raise exception 'DLT_MAPPING_REQUIRED';end if;
 if v.channel='LEMLIST' and (v.category<>'MARKETING' or a.lemlist_step_id is null) then raise exception 'LEMLIST_NURTURE_MAPPING_REQUIRED';end if;
 update public.communication_template_versions set status='SUPERSEDED' where template_id=v.template_id and channel=v.channel and status='ACTIVE';
 update public.communication_template_versions set status='ACTIVE',activated_at=now() where id=v.id;
 update public.communication_templates set status='ACTIVE',updated_at=now() where id=v.template_id;
end $$;

-- All communication state is operationally isolated and inaccessible to browser roles.
create function public.comm_create_otp(p_id uuid,p_phone text,p_email text,p_hash text,p_encrypted text,p_ip_key text,p_identity_key text,p_ttl integer) returns void language plpgsql set search_path='' as $$
declare k text;bucket public.communication_rate_limits;begin
 foreach k in array array['otp:ip:'||p_ip_key,'otp:identity:'||p_identity_key] loop
  insert into public.communication_rate_limits(bucket_key,window_start,count) values(k,now(),0) on conflict do nothing;
  select * into bucket from public.communication_rate_limits where bucket_key=k for update;
  if bucket.window_start<now()-interval '1 hour' then update public.communication_rate_limits set window_start=now(),count=0 where bucket_key=k;bucket.count:=0;end if;
  if bucket.count>=5 then raise exception 'OTP_RATE_LIMIT';end if;
  update public.communication_rate_limits set count=count+1 where bucket_key=k;
 end loop;
 perform pg_advisory_xact_lock(hashtextextended(p_identity_key,267));
 if exists(select 1 from public.communication_otp_challenges where coalesce(phone,email)=coalesce(p_phone,p_email) and created_at>now()-interval '60 seconds') then raise exception 'OTP_RESEND_COOLDOWN';end if;
 update public.communication_otp_challenges set expires_at=now(),encrypted_otp='' where coalesce(phone,email)=coalesce(p_phone,p_email) and verified_at is null;
 insert into public.communication_otp_challenges(id,phone,email,otp_hash,encrypted_otp,expires_at,send_channel_index)
 values(p_id,p_phone,p_email,p_hash,p_encrypted,now()+make_interval(secs=>least(greatest(p_ttl,60),600)),case when p_phone is null then 2 else 0 end);
 insert into public.integration_outbox(provider,operation,aggregate_id,idempotency_key,event_type,payload)
 values('COMMUNICATIONS','OTP',p_id::text,'otp:'||p_id||':initial','communication.otp.created',jsonb_build_object('challenge_id',p_id,'provider',case when p_phone is null then 'brevo' else 'whatsapp' end));
end $$;
create index otp_identity_cooldown_idx on public.communication_otp_challenges((coalesce(phone,email)),created_at desc);
create function public.comm_claim_otp(p_id uuid) returns setof public.communication_otp_challenges language plpgsql set search_path='' as $$begin
 update public.communication_otp_challenges set send_state='RECONCILIATION_PENDING' where id=p_id and send_state='SENDING' and send_lease_until<now() and provider_attempted_at is not null;
 return query update public.communication_otp_challenges set send_state='SENDING',last_sent_at=now(),send_lease_until=now()+interval '30 seconds'
 where id=p_id and (send_state='PENDING' or (send_state='SENDING' and send_lease_until<now() and provider_attempted_at is null)) and expires_at>now() and verified_at is null returning *;
end
$$;
create function public.comm_finish_otp(p_id uuid,p_success boolean,p_state text) returns void language plpgsql set search_path='' as $$
declare c public.communication_otp_challenges;begin
 select * into c from public.communication_otp_challenges where id=p_id for update;
 if not found or c.send_state<>'SENDING' or c.verified_at is not null then return;end if;
 if p_success then update public.communication_otp_challenges set send_state=p_state,send_lease_until=null where id=p_id;
 elsif c.send_channel_index<2 and c.expires_at>now() then
  update public.communication_otp_challenges set send_channel_index=send_channel_index+1,send_state='PENDING',send_lease_until=null,provider_attempted_at=null where id=p_id;
  insert into public.integration_outbox(provider,operation,aggregate_id,idempotency_key,event_type,payload)
  values('COMMUNICATIONS','OTP',p_id::text,'otp:'||p_id||':'||(c.send_channel_index+1),'communication.otp.fallback',jsonb_build_object('challenge_id',p_id,'provider',case when c.send_channel_index=0 then 'msg91' else 'brevo' end)) on conflict do nothing;
 else update public.communication_otp_challenges set send_state='FAILED_PERMANENT' where id=p_id;end if;
end $$;
create function public.comm_verify_otp(p_id uuid,p_hash text) returns boolean language plpgsql set search_path='' as $$
declare c public.communication_otp_challenges;begin
 select * into c from public.communication_otp_challenges where id=p_id for update;
 if not found or c.expires_at<=now() or c.attempts>=5 or c.verified_at is not null then return false;end if;
 update public.communication_otp_challenges set attempts=attempts+1 where id=p_id;
 if c.otp_hash=p_hash then update public.communication_otp_challenges set verified_at=now(),encrypted_otp='' where id=p_id;return true;end if;return false;
end $$;

create function private.communication_preference_audit() returns trigger language plpgsql set search_path='' as $$begin
 insert into public.communication_preference_history(customer_id,channel,purpose,allowed,source,evidence) values(new.customer_id,new.channel,new.purpose,new.allowed,new.source,new.evidence);
 insert into public.communication_customer_features(customer_id) values(new.customer_id) on conflict do nothing;
 if new.purpose='MARKETING' then
  update public.communication_customer_features set
   email_marketing_allowed=case when new.channel='EMAIL' then new.allowed else email_marketing_allowed end,
   whatsapp_marketing_allowed=case when new.channel='WHATSAPP' then new.allowed else whatsapp_marketing_allowed end,
   sms_marketing_allowed=case when new.channel='SMS' then new.allowed else sms_marketing_allowed end,updated_at=now() where customer_id=new.customer_id;
 end if;return new;
end $$;
create trigger communication_preference_audit after insert or update on public.communication_preferences for each row execute function private.communication_preference_audit();
create function public.comm_phone_opt_out(p_phone text,p_channel text) returns void language sql set search_path='' as $$
 insert into public.communication_preferences(customer_id,channel,purpose,allowed,source)
 select id,p_channel,'MARKETING',false,'PROVIDER_OPTOUT' from public.customers where normalized_phone=
  case when length(regexp_replace(p_phone,'[^0-9]','','g'))=10 then '+91' else '+' end||regexp_replace(p_phone,'[^0-9]','','g')
 on conflict(customer_id,channel,purpose) do update set allowed=false,source='PROVIDER_OPTOUT',updated_at=now();
$$;
create function public.comm_provider_event(p_provider text,p_event_id text,p_message_id text,p_status text,p_at timestamptz,p_email text default null,p_campaign text default null,p_step text default null) returns void language plpgsql set search_path='' as $$
declare inserted integer;d public.message_deliveries;c uuid;rank_old integer;rank_new integer;begin
 perform pg_advisory_xact_lock(hashtextextended(p_provider||':'||p_message_id,631));
 insert into public.communication_provider_events(provider,event_id,payload) values(p_provider,p_event_id,jsonb_build_object('message_id',p_message_id,'status',p_status,'at',p_at,'campaign_id',p_campaign,'step_id',p_step)) on conflict do nothing;
 get diagnostics inserted=row_count;
 if exists(select 1 from public.communication_provider_events where provider=p_provider and event_id=p_event_id and applied_at is not null) then return;end if;
 if inserted>0 and p_status in ('UNSUBSCRIBED','FAILED_PERMANENT') and p_email is not null then
  insert into public.communication_preferences(customer_id,channel,purpose,allowed,source)
  select id,'EMAIL',case when p_status='UNSUBSCRIBED' then 'MARKETING' else purpose end,false,'PROVIDER_EVENT'
  from public.customers cross join (values('TRANSACTIONAL'),('MARKETING')) purposes(purpose) where normalized_email=lower(p_email)
  group by id,case when p_status='UNSUBSCRIBED' then 'MARKETING' else purpose end
  on conflict(customer_id,channel,purpose) do update set allowed=false,source='PROVIDER_EVENT',updated_at=now();
 end if;
 select * into d from public.message_deliveries delivery where provider=p_provider and provider_message_id=p_message_id
  and (p_provider<>'LEMLIST' or p_campaign is null or exists(select 1 from public.communication_template_provider_artifacts artifact where artifact.template_version_id=delivery.template_version_id and artifact.lemlist_campaign_id=p_campaign and artifact.lemlist_step_id=p_step)) limit 1 for update;
 if not found then return;end if;
 update public.communication_provider_events set applied_at=now() where provider=p_provider and event_id=p_event_id;
 if p_provider='LEMLIST' and p_campaign is not null and not exists(select 1 from public.communication_template_provider_artifacts where template_version_id=d.template_version_id and lemlist_campaign_id=p_campaign and lemlist_step_id=p_step) then return;end if;
 rank_old:=case d.status when 'ACCEPTED' then 1 when 'SENT' then 2 when 'DELIVERED' then 3 when 'OPENED' then 4 when 'READ' then 4 when 'CLICKED' then 5 else 0 end;
 rank_new:=case p_status when 'SENT' then 2 when 'DELIVERED' then 3 when 'OPENED' then 4 when 'READ' then 4 when 'CLICKED' then 5 else 0 end;
 if rank_new>rank_old or (p_status='FAILED_PERMANENT' and rank_old<3) then
  update public.message_deliveries set status=p_status,delivered_at=case when rank_new>=3 then coalesce(delivered_at,p_at) else delivered_at end,updated_at=now() where id=d.id;
 end if;
 if rank_new>=3 and rank_old<3 then
  select customer_id into c from public.customer_messages where id=d.customer_message_id;
  update public.communication_marketing_reservations set status='DELIVERED' where id=d.id;
  update public.communication_customer_features set last_marketing_sent_at=greatest(last_marketing_sent_at,p_at),
   messages_last_24h=(select count(*) from public.communication_marketing_reservations where customer_id=c and reserved_at>now()-interval '24 hours'),
   messages_last_7d=(select count(*) from public.communication_marketing_reservations where customer_id=c and reserved_at>now()-interval '7 days'),updated_at=now() where customer_id=c and exists(select 1 from public.communication_marketing_reservations where id=d.id);
 end if;
end $$;
-- Acceptance and callbacks share a narrow provider-ID lock. Early callbacks stay durable and replay here.
create function public.comm_accept_delivery(p_id uuid,p_provider_id text,p_latency integer) returns void language plpgsql set search_path='' as $$
declare provider_name text;e record;begin
 select provider into provider_name from public.message_deliveries where id=p_id;
 perform pg_advisory_xact_lock(hashtextextended(provider_name||':'||p_provider_id,631));
 update public.message_deliveries set status='ACCEPTED',provider_message_id=p_provider_id,sent_at=now(),lease_until=null,latency_ms=p_latency where id=p_id and status='SENDING';
 for e in select * from public.communication_provider_events where provider=provider_name and payload->>'message_id'=p_provider_id and applied_at is null order by created_at limit 50 loop
  perform public.comm_provider_event(e.provider,e.event_id,p_provider_id,e.payload->>'status',(e.payload->>'at')::timestamptz,null,e.payload->>'campaign_id',e.payload->>'step_id');
 end loop;
end $$;
create index provider_pending_callback_idx on public.communication_provider_events(provider,(payload->>'message_id')) where applied_at is null;
create function public.comm_template_provider_event(p_provider_id text,p_status text,p_at timestamptz,p_reason text) returns void language sql set search_path='' as $$
 update public.communication_template_provider_artifacts set provider_status=p_status,provider_status_reason=left(p_reason,1000),
 last_provider_event_at=p_at,approved_at=case when p_status='APPROVED' then p_at else approved_at end,rejected_at=case when p_status='REJECTED' then p_at else rejected_at end,updated_at=now()
 where provider='META_WHATSAPP' and provider_template_id=p_provider_id and coalesce(last_provider_event_at,'epoch')<p_at;
$$;

create function public.comm_create_template_version(p_input jsonb,p_actor uuid) returns uuid language plpgsql set search_path='' as $$
declare template uuid;version_id uuid;n integer;begin
 perform pg_advisory_xact_lock(hashtextextended(p_input->>'logical_key',198));
 select id into template from public.communication_templates where logical_key=p_input->>'logical_key';
 if template is null then insert into public.communication_templates(logical_key,name,purpose) values(p_input->>'logical_key',p_input->>'name',p_input->>'category') returning id into template;end if;
 select coalesce(max(version),0)+1 into n from public.communication_template_versions where template_id=template and channel=p_input->>'channel';
 insert into public.communication_template_versions(template_id,version,channel,category,subject,html_content,text_content,structured_content,parameter_schema,change_reason,created_by)
 values(template,n,p_input->>'channel',p_input->>'category',p_input->>'subject',p_input->>'html_content',p_input->>'text_content',p_input->'structured_content',p_input->'parameter_schema',p_input->>'change_reason',p_actor) returning id into version_id;
 insert into public.communication_template_provider_artifacts(template_id,template_version_id,provider,provider_status,sync_mode)
 values(template,version_id,case p_input->>'channel' when 'EMAIL' then 'BREVO' when 'WHATSAPP' then 'META_WHATSAPP' when 'SMS' then 'MSG91' else 'LEMLIST' end,
 case when p_input->>'channel'='EMAIL' then 'NOT_REQUIRED' else 'DRAFT' end,case p_input->>'channel' when 'EMAIL' then 'DIRECT_CONTENT' when 'WHATSAPP' then 'PROVIDER_TEMPLATE' when 'SMS' then 'EXTERNAL_APPROVAL_MAPPING' else 'SEQUENCE_STEP' end);
 return version_id;
end $$;

create function public.comm_queue_template_test(p_version_id uuid,p_destination text) returns uuid language plpgsql set search_path='' as $$
declare v public.communication_template_versions;m uuid;d uuid;begin
 select * into v from public.communication_template_versions where id=p_version_id;if not found then raise exception 'TEMPLATE_NOT_FOUND';end if;
 insert into public.customer_messages(customer_id,message_key,title,body,severity,metadata)
 values(null,'TEMPLATE_TEST','Template test','Operator template test','INFO',jsonb_build_object('communication_engine',true,'communication_test',true,'test_destination',p_destination)) returning id into m;
 insert into public.message_deliveries(customer_message_id,channel,provider,template_version_id,dedupe_key)
 values(m,v.channel,case v.channel when 'EMAIL' then 'BREVO' when 'WHATSAPP' then 'META_WHATSAPP' when 'SMS' then 'MSG91' else 'LEMLIST' end,v.id,'test:'||m||':'||v.id) returning id into d;
 insert into public.integration_outbox(provider,operation,aggregate_id,idempotency_key,event_type,payload)
 values('COMMUNICATIONS','SEND',d::text,'test-send:'||d,'communication.template.test',jsonb_build_object('delivery_id',d,'provider',case v.channel when 'EMAIL' then 'brevo' when 'WHATSAPP' then 'whatsapp' when 'SMS' then 'msg91' else 'lemlist' end));return d;
end $$;

-- Recovery is explicitly bounded and manual: it is not part of normal rule evaluation.
create function public.comm_recover_orders(p_reset boolean default false) returns integer language plpgsql set search_path='' set statement_timeout='3s' as $$
declare cursor uuid;o public.orders;facts jsonb;n integer:=0;begin
 insert into public.communication_recovery_cursors(source) values('orders') on conflict do nothing;
 select cursor_id into cursor from public.communication_recovery_cursors where source='orders' for update;
 if p_reset then cursor:=null;end if;
 for o in select * from public.orders where (cursor is null or id>cursor) order by id limit 100 loop
  if o.status='CONFIRMED' then
   facts:=jsonb_build_object('projection_only',true,'order_id',o.id,'total_paise',o.total_paise,'discount_paise',o.discount_paise,'at',o.updated_at,
    'skus',(select coalesce(jsonb_agg(distinct sku),'[]') from public.order_items where order_id=o.id),
    'product_codes',(select coalesce(jsonb_agg(distinct snapshot->>'product_code'),'[]') from public.order_items where order_id=o.id));
   insert into public.integration_outbox(provider,operation,aggregate_id,idempotency_key,event_type,customer_id,payload)
    values('COMMUNICATIONS','EVENT',o.id::text,'order:'||o.id||':confirmed','commerce.order.confirmed',o.customer_id,facts) on conflict(idempotency_key) do nothing;
  end if;cursor:=o.id;n:=n+1;
 end loop;
 update public.communication_recovery_cursors set cursor_id=cursor,updated_at=now(),last_completed_at=case when n<100 then now() else last_completed_at end where source='orders';return n;
end $$;

-- Manual backfill reads at most 100 authoritative rows. Only the recovery cursor is locked.
-- Historical state is projection-only: enabling recovery must never launch old campaigns.
create function public.comm_recover_state(p_source text,p_reset boolean default false) returns integer language plpgsql set search_path='' set statement_timeout='3s' as $$
declare cursor uuid;r record;facts jsonb;kind text;dedupe text;n integer:=0;query text;begin
 if p_source='orders' then return public.comm_recover_orders(p_reset);end if;
 if p_source not in ('subscriptions','payments','shipments') then raise exception 'INVALID_RECOVERY_SOURCE';end if;
 insert into public.communication_recovery_cursors(source) values(p_source) on conflict do nothing;
 select cursor_id into cursor from public.communication_recovery_cursors where source=p_source for update;
 if p_reset then cursor:=null;end if;
 if p_source='subscriptions' then
  query:='select id,customer_id,status,interval_days,next_charge_at,updated_at from public.subscriptions where ($1 is null or id>$1) order by id limit 100';
 else
  query:=format('with batch as materialized (select id,order_id,status,updated_at from public.%I where ($1 is null or id>$1) order by id limit 100) select b.*,o.customer_id from batch b join public.orders o on o.id=b.order_id order by b.id',case p_source when 'payments' then 'payment_attempts' else 'shipments' end);
 end if;
 for r in execute query using cursor loop
  if p_source='subscriptions' then
   kind:='commerce.subscription.changed';dedupe:='subscription:'||r.id||':'||r.updated_at;
   facts:=jsonb_build_object('subscription_id',r.id,'status',r.status,'interval_days',r.interval_days,'next_charge_at',r.next_charge_at,'at',r.updated_at);
  elsif p_source='payments' then
   kind:='commerce.payment.changed';dedupe:='payment:'||r.id||':'||r.status;
   facts:=jsonb_build_object('payment_id',r.id,'order_id',r.order_id,'status',r.status,'at',r.updated_at);
  else
   kind:='commerce.shipment.changed';dedupe:='shipment:'||r.id||':'||r.status;
   facts:=jsonb_build_object('shipment_id',r.id,'order_id',r.order_id,'status',r.status,'at',r.updated_at);
  end if;
  insert into public.integration_outbox(provider,operation,aggregate_id,idempotency_key,event_type,customer_id,payload)
   values('COMMUNICATIONS','EVENT',r.id::text,dedupe,kind,r.customer_id,facts||'{"projection_only":true}'::jsonb) on conflict(idempotency_key) do nothing;
  cursor:=r.id;n:=n+1;
 end loop;
 update public.communication_recovery_cursors set cursor_id=cursor,updated_at=now(),last_completed_at=case when n<100 then now() else last_completed_at end where source=p_source;return n;
end $$;

create function private.prevent_communication_history_edit() returns trigger language plpgsql set search_path='' as $$begin raise exception 'IMMUTABLE_AUDIT_HISTORY';end $$;
create trigger communication_consent_history_immutable before update or delete on public.communication_preference_history for each row execute function private.prevent_communication_history_edit();

do $$ declare t text;r record;begin
 for t in select tablename from pg_tables where schemaname='public' and (tablename like 'communication_%' or tablename='integration_outbox') loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from anon,authenticated',t);
  execute format('grant all on public.%I to service_role',t);
 end loop;
 for r in select oid::regprocedure signature from pg_proc where pronamespace='public'::regnamespace and proname like 'comm_%' loop
  execute format('revoke all on function %s from public,anon,authenticated',r.signature);
  execute format('grant execute on function %s to service_role',r.signature);
 end loop;
end $$;
