-- LOCAL ONLY: reviewed additive schema; apply to staging only after separate authorization.
-- Canonical customer_messages/message_deliveries and integration_outbox remain authoritative.
alter table public.integration_outbox add column whatsapp_evaluated_at timestamptz default now();
-- Never reinterpret historical outbox work as newly eligible campaigns.
alter table public.integration_outbox alter column whatsapp_evaluated_at drop default;
create index communication_whatsapp_source_due on public.integration_outbox(created_at,id)
 where provider='COMMUNICATIONS' and operation='EVENT' and whatsapp_evaluated_at is null;
alter table public.tracking_events add column communication_authenticated boolean not null default false;
alter table public.carts add column communication_checkout_session_id uuid unique references public.checkout_sessions(id);
insert into public.communication_recovery_cursors(source,last_completed_at) values('whatsapp_workflows_capture_floor',now());
create index whatsapp_paid_order_recovery on public.orders(paid_at,id) where status='CONFIRMED';
create index whatsapp_failed_payment_recovery on public.payment_attempts(updated_at,id) where status='FAILED';
create index whatsapp_authenticated_tracking_recovery on public.tracking_events(created_at,shipment_id) where communication_authenticated;

create table public.communication_whatsapp_workflow_intents (
 id uuid primary key default gen_random_uuid(),
 workflow text not null check(workflow in ('CART_RECOVERY','PAYMENT_FAILED','ORDER_CONFIRMATION','ORDER_SHIPPED','OUT_FOR_DELIVERY','DELIVERY_CONFIRMATION')),
 subject_id uuid not null,customer_id uuid not null references public.customers(id),
 order_id uuid references public.orders(id),payment_attempt_id uuid references public.payment_attempts(id),shipment_id uuid references public.shipments(id),
 source_outbox_id uuid references public.integration_outbox(id),source_at timestamptz not null,
 status text not null check(status in ('BLOCKED_DRAFT','PENDING','QUEUED','SUPPRESSED')),
 suppression_reason text,run_id uuid unique references public.communication_runs(id),message_id uuid unique references public.customer_messages(id),
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(workflow,subject_id)
);
create index communication_whatsapp_intent_due on public.communication_whatsapp_workflow_intents(created_at,id) where status in ('PENDING','QUEUED');
alter table public.communication_whatsapp_workflow_intents enable row level security;
revoke all on public.communication_whatsapp_workflow_intents from public,anon,authenticated;
grant all on public.communication_whatsapp_workflow_intents to service_role;

create function private.whatsapp_shipment_milestone(p_status text) returns text language sql immutable set search_path='' as $$
 select case lower(regexp_replace(btrim(p_status),'[_-]+',' ','g'))
 when 'shipped' then 'SHIPPED' when 'order shipped' then 'SHIPPED' when 'in transit' then 'SHIPPED'
 when 'picked up' then 'SHIPPED' when 'pickup complete' then 'SHIPPED'
 when 'out for delivery' then 'OUT_FOR_DELIVERY' when 'delivered' then 'DELIVERED' else null end;
$$;
create function private.whatsapp_shipment_rank(p_status text) returns integer language sql immutable set search_path='' as $$
 select case private.whatsapp_shipment_milestone(p_status) when 'SHIPPED' then 1 when 'OUT_FOR_DELIVERY' then 2 when 'DELIVERED' then 3 else 0 end;
$$;
create function private.whatsapp_shipment_terminal(p_status text) returns boolean language sql immutable set search_path='' as $$
 select normalized in ('cancelled','canceled','shipment cancelled','shipment canceled','cancellation requested','cancel requested','returned','return','rto','lost','damaged','shipment lost','shipment damaged')
 or normalized like 'rto %' or normalized like 'return %'
 from (select coalesce(lower(regexp_replace(btrim(p_status),'[_-]+',' ','g')),'') normalized) n;
$$;
create function private.whatsapp_payment_proven(p public.payment_attempts,p_status text) returns boolean language sql stable set search_path='' as $$
 select p.status=p_status and p.provider_payment_id is not null and
 p.raw_metadata->>'id'=p.provider_payment_id and p.raw_metadata->>'order_id'=p.provider_order_id and
 p.raw_metadata->>'status'=lower(p_status) and p.raw_metadata->>'amount'=p.amount_paise::text and
 p.raw_metadata->>'currency'=p.currency;
$$;
create function private.whatsapp_order_paid(p_order uuid) returns boolean language sql stable set search_path='' as $$
 select exists(select 1 from public.orders o join public.payment_attempts p on p.order_id=o.id
 where o.id=p_order and o.status='CONFIRMED' and o.paid_at is not null
 and p.amount_paise=o.total_paise and p.currency=o.currency and private.whatsapp_payment_proven(p,'CAPTURED'));
$$;

-- Called only after the HTTP layer authenticates the courier secret. No outbound API.
create function public.comm_ingest_shipment_event(p_payload jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare s public.shipments;ev public.tracking_events;awb text:=nullif(p_payload->>'awb','');sid text:=nullif(p_payload->>'shipment_id','');
 event_key text:=p_payload->>'event_id';raw_status text:=p_payload->>'current_status';milestone text;stamp timestamptz;msg uuid;customer uuid;key text;
begin
 if awb is null and sid is null then raise exception 'SHIPMENT_ID_REQUIRED';end if;
 if length(coalesce(awb,''))>128 or length(coalesce(sid,''))>128 or nullif(event_key,'') is null or length(event_key)>256 or nullif(raw_status,'') is null then raise exception 'INVALID_SHIPMENT_EVENT';end if;
 select * into s from public.shipments where (awb is not null and awb_code=awb) or (sid is not null and provider_shipment_id=sid) for update;
 if not found then return '{"ignored":true}'::jsonb;end if;
 if (awb is not null and s.awb_code is distinct from awb) or (sid is not null and s.provider_shipment_id is distinct from sid)
 or exists(select 1 from public.shipments where id<>s.id and ((awb is not null and awb_code=awb) or (sid is not null and provider_shipment_id=sid))) then raise exception 'SHIPMENT_IDENTITY_CONFLICT';end if;
 stamp:=coalesce(nullif(p_payload->>'event_time','')::timestamptz,now());
 if stamp>now()+interval '5 minutes' then raise exception 'INVALID_SHIPMENT_TIME';end if;
 select * into ev from public.tracking_events where provider_event_id=event_key;
 if found then
  if ev.shipment_id<>s.id or ev.status<>raw_status then raise exception 'SHIPMENT_EVENT_ID_CONFLICT';end if;
  return jsonb_build_object('duplicate',true);
 end if;
 milestone:=private.whatsapp_shipment_milestone(raw_status);
 insert into public.tracking_events(shipment_id,provider_event_id,status,occurred_at,raw_payload,communication_authenticated)
 values(s.id,event_key,raw_status,stamp,p_payload,true);
 if private.whatsapp_shipment_terminal(raw_status) and not exists(select 1 from public.tracking_events where shipment_id=s.id and communication_authenticated and occurred_at>stamp) then
  update public.shipments set status=upper(raw_status),raw_metadata=p_payload,updated_at=now() where id=s.id;
  return '{"ignored":true,"reason":"TERMINAL_SHIPMENT"}'::jsonb;
 end if;
 if private.whatsapp_shipment_terminal(s.status) or milestone is null or private.whatsapp_shipment_rank(milestone)<=private.whatsapp_shipment_rank(s.status)
 or exists(select 1 from public.tracking_events where shipment_id=s.id and communication_authenticated and occurred_at>stamp) then return '{"ignored":true}'::jsonb;end if;
 -- Record authenticated courier facts even if payment reconciliation arrives late.
 -- This does not create fulfilment, confirm an order, or authorize a notification.
 update public.shipments set status=milestone,raw_metadata=p_payload,updated_at=now() where id=s.id;
 if not private.whatsapp_order_paid(s.order_id) then return '{"held":true,"reason":"PAYMENT_NOT_VERIFIED"}'::jsonb;end if;
 select customer_id into customer from public.orders where id=s.order_id;
 key:=case milestone when 'SHIPPED' then 'ORDER_SHIPPED' when 'OUT_FOR_DELIVERY' then 'OUT_FOR_DELIVERY' else 'DELIVERED' end;
 insert into public.customer_messages(customer_id,order_id,shipment_id,message_key,title,body,severity)
 values(customer,s.order_id,s.id,key,key,'Your Uppermost order has a verified shipping update.','INFO') on conflict do nothing returning id into msg;
 if msg is not null then
  insert into public.message_deliveries(customer_message_id,channel,provider,status,attempt_number,delivered_at)
  values(msg,'IN_APP','UPPERMOST','DELIVERED',1,now()) on conflict do nothing;
 end if;
 return jsonb_build_object('ok',true,'milestone',milestone);
end $$;

create function public.comm_whatsapp_workflow_permission(p_intent_id uuid) returns text language plpgsql security invoker set search_path='' as $$
declare i public.communication_whatsapp_workflow_intents;c public.customers;o public.orders;p public.payment_attempts;s public.shipments;cart public.carts;expected text;
begin
 select * into i from public.communication_whatsapp_workflow_intents where id=p_intent_id;
 if not found then return 'WORKFLOW_INTENT_MISSING';end if;
 if i.status in ('SUPPRESSED','BLOCKED_DRAFT') then return coalesce(i.suppression_reason,'HISTORICAL_DRAFT');end if;
 if i.source_at<now()-interval '24 hours' then return 'WORKFLOW_EXPIRED';end if;
 if not exists(select 1 from public.communication_rules where name='UPPERMOST_WHATSAPP_'||i.workflow||'_V1' and status='ACTIVE' and approved_at is not null and i.source_at>=approved_at and (valid_from is null or i.source_at>=valid_from) and (valid_until is null or now()<valid_until)) then return 'RULE_NOT_ACTIVE';end if;
 select * into c from public.customers where id=i.customer_id;
 if not found or nullif(c.phone,'') is null then return 'INVALID_DESTINATION';end if;
 if exists(select 1 from public.communication_preferences where customer_id=i.customer_id and channel='WHATSAPP' and purpose=case when i.workflow='CART_RECOVERY' then 'MARKETING' else 'TRANSACTIONAL' end and not allowed) then return 'CONSENT_REQUIRED';end if;
 if i.workflow='CART_RECOVERY' then
  if not public.comm_whatsapp_marketing_allowed(i.customer_id) then return 'CONSENT_REQUIRED';end if;
  select * into cart from public.carts where id=i.subject_id and customer_id=i.customer_id;
  if not found or cart.status not in ('OPEN','ABANDONED') or cart.updated_at<>i.source_at
   or cart.updated_at>now()-interval '1 hour' or cart.updated_at<=now()-interval '24 hours'
   or not exists(select 1 from public.cart_items where cart_id=cart.id and quantity>0)
   or exists(select 1 from public.orders where customer_id=i.customer_id and status='CONFIRMED' and paid_at>=cart.updated_at)
   then return 'CART_OBSOLETE';end if;
  return null;
 end if;
 select * into o from public.orders where id=i.order_id and customer_id=i.customer_id;
 if not found then return 'ORDER_IDENTITY_CONFLICT';end if;
 if i.workflow='PAYMENT_FAILED' then
  select * into p from public.payment_attempts where id=i.payment_attempt_id and order_id=o.id;
  if not found or not coalesce(private.whatsapp_payment_proven(p,'FAILED'),false) or o.status='CONFIRMED'
   or p.amount_paise<>o.total_paise or p.currency<>o.currency
   or exists(select 1 from public.payment_attempts where order_id=o.id and id<>p.id and (status in ('CAPTURED','CONFIRMED','AUTHORIZED','CREATED') or created_at>p.created_at))
   then return 'PAYMENT_OBSOLETE';end if;
  if i.source_at<now()-interval '24 hours' then return 'WORKFLOW_EXPIRED';end if;
  return null;
 end if;
 if not private.whatsapp_order_paid(o.id) then return 'PAYMENT_NOT_VERIFIED';end if;
 if i.workflow='ORDER_CONFIRMATION' then return null;end if;
 select * into s from public.shipments where id=i.shipment_id and order_id=o.id;
 expected:=case i.workflow when 'ORDER_SHIPPED' then 'SHIPPED' when 'OUT_FOR_DELIVERY' then 'OUT_FOR_DELIVERY' when 'DELIVERY_CONFIRMATION' then 'DELIVERED' end;
 if not found or private.whatsapp_shipment_milestone(s.status) is distinct from expected
 or exists(select 1 from public.tracking_events where shipment_id=s.id and communication_authenticated and occurred_at>=i.source_at and private.whatsapp_shipment_terminal(status)) or not exists(
  select 1 from public.tracking_events where shipment_id=s.id and communication_authenticated and private.whatsapp_shipment_milestone(status)=expected)
  then return 'SHIPMENT_OBSOLETE_OR_UNVERIFIED';end if;
 return null;
end $$;

create function private.record_whatsapp_intent(w text,subject uuid,customer uuid,ord uuid,pay uuid,ship uuid,src uuid,stamp timestamptz) returns void language plpgsql set search_path='' as $$
declare r public.communication_rules;intent uuid;reason text;
begin
 select * into r from public.communication_rules where name='UPPERMOST_WHATSAPP_'||w||'_V1' order by created_at,id limit 1;
 insert into public.communication_whatsapp_workflow_intents(workflow,subject_id,customer_id,order_id,payment_attempt_id,shipment_id,source_outbox_id,source_at,status,suppression_reason)
 values(w,subject,customer,ord,pay,ship,src,stamp,
 case when r.status='ACTIVE' and r.approved_at is not null and stamp>=r.approved_at and (r.valid_from is null or stamp>=r.valid_from) and (r.valid_until is null or now()<r.valid_until) then 'PENDING' else 'BLOCKED_DRAFT' end,
 case when r.status='ACTIVE' and r.approved_at is not null and stamp>=r.approved_at and (r.valid_from is null or stamp>=r.valid_from) and (r.valid_until is null or now()<r.valid_until) then null else 'HISTORICAL_DRAFT' end)
 on conflict(workflow,subject_id) do nothing returning id into intent;
 if intent is not null then
  insert into public.communication_customer_features(customer_id) values(customer) on conflict do nothing;
  reason:=public.comm_whatsapp_workflow_permission(intent);
  if reason is not null and reason<>'HISTORICAL_DRAFT' then update public.communication_whatsapp_workflow_intents set status='SUPPRESSED',suppression_reason=reason where id=intent;end if;
 end if;
end $$;

create function public.comm_capture_whatsapp_workflows(p_limit integer default 50) returns integer language plpgsql security invoker set search_path='' as $$
declare e public.integration_outbox;o public.orders;p public.payment_attempts;s public.shipments;cart public.carts;w text;stamp timestamptz;n integer:=0;floor_at timestamptz;cs public.checkout_sessions;new_cart uuid;
begin
 select last_completed_at into floor_at from public.communication_recovery_cursors where source='whatsapp_workflows_capture_floor';
 for e in select * from public.integration_outbox where provider='COMMUNICATIONS' and operation='EVENT' and whatsapp_evaluated_at is null order by created_at,id limit least(greatest(p_limit,1),50) for update skip locked loop
  if e.customer_id is not null and coalesce(e.payload->>'projection_only','false')<>'true' then
   if e.event_type='commerce.order.confirmed' then
    select * into o from public.orders where id::text=e.payload->>'order_id' and customer_id=e.customer_id;
    if found and private.whatsapp_order_paid(o.id) then perform private.record_whatsapp_intent('ORDER_CONFIRMATION',o.id,o.customer_id,o.id,null,null,e.id,e.created_at);end if;
   elsif e.event_type='commerce.payment.changed' and e.payload->>'status'='FAILED' then
    select p1.* into p from public.payment_attempts p1 join public.orders o1 on o1.id=p1.order_id where p1.id::text=e.payload->>'payment_id' and p1.order_id::text=e.payload->>'order_id' and o1.customer_id=e.customer_id and p1.amount_paise=o1.total_paise and p1.currency=o1.currency;
    if found and private.whatsapp_payment_proven(p,'FAILED') then perform private.record_whatsapp_intent('PAYMENT_FAILED',p.id,e.customer_id,p.order_id,p.id,null,e.id,e.created_at);end if;
   elsif e.event_type='commerce.shipment.changed' then
    select s1.* into s from public.shipments s1 join public.orders o1 on o1.id=s1.order_id where s1.id::text=e.payload->>'shipment_id' and s1.order_id::text=e.payload->>'order_id' and o1.customer_id=e.customer_id;
    if found and private.whatsapp_order_paid(s.order_id) and private.whatsapp_shipment_milestone(s.status)=private.whatsapp_shipment_milestone(e.payload->>'status') and exists(select 1 from public.tracking_events where shipment_id=s.id and communication_authenticated and private.whatsapp_shipment_milestone(status)=private.whatsapp_shipment_milestone(s.status)) then
     w:=case private.whatsapp_shipment_milestone(s.status) when 'SHIPPED' then 'ORDER_SHIPPED' when 'OUT_FOR_DELIVERY' then 'OUT_FOR_DELIVERY' when 'DELIVERED' then 'DELIVERY_CONFIRMATION' end;
     select max(occurred_at) into stamp from public.tracking_events where shipment_id=s.id and communication_authenticated and private.whatsapp_shipment_milestone(status)=private.whatsapp_shipment_milestone(s.status);
     if w is not null then perform private.record_whatsapp_intent(w,s.id,e.customer_id,s.order_id,null,s.id,e.id,stamp);end if;
    end if;
   end if;
  end if;
  update public.integration_outbox set whatsapp_evaluated_at=now() where id=e.id;n:=n+1;
 end loop;
 -- Exception-isolated commerce hooks must not veto money transitions. Recover only
 -- post-installation facts from durable verified source rows if their outbox bridge failed.
 for o in select * from public.orders o1 where o1.status='CONFIRMED' and o1.paid_at>=floor_at and private.whatsapp_order_paid(o1.id)
 and not exists(select 1 from public.communication_whatsapp_workflow_intents where workflow='ORDER_CONFIRMATION' and subject_id=o1.id)
 order by o1.paid_at,o1.id limit least(greatest(p_limit,1),50) loop
  perform private.record_whatsapp_intent('ORDER_CONFIRMATION',o.id,o.customer_id,o.id,null,null,null,o.paid_at);
 end loop;
 for p in select * from public.payment_attempts p1 where p1.status='FAILED' and p1.updated_at>=floor_at and private.whatsapp_payment_proven(p1,'FAILED')
 and not exists(select 1 from public.communication_whatsapp_workflow_intents where workflow='PAYMENT_FAILED' and subject_id=p1.id)
 order by p1.updated_at,p1.id limit least(greatest(p_limit,1),50) loop
  select * into o from public.orders where id=p.order_id and total_paise=p.amount_paise and currency=p.currency;
  if found then perform private.record_whatsapp_intent('PAYMENT_FAILED',p.id,o.customer_id,o.id,p.id,null,null,p.updated_at);end if;
 end loop;
 for s in select * from public.shipments s1 where private.whatsapp_order_paid(s1.order_id)
 and exists(select 1 from public.tracking_events where shipment_id=s1.id and communication_authenticated and created_at>=floor_at and private.whatsapp_shipment_milestone(status)=private.whatsapp_shipment_milestone(s1.status))
 and not exists(select 1 from public.communication_whatsapp_workflow_intents where shipment_id=s1.id and workflow=case private.whatsapp_shipment_milestone(s1.status) when 'SHIPPED' then 'ORDER_SHIPPED' when 'OUT_FOR_DELIVERY' then 'OUT_FOR_DELIVERY' when 'DELIVERED' then 'DELIVERY_CONFIRMATION' end)
 order by s1.updated_at,s1.id limit least(greatest(p_limit,1),50) loop
  w:=case private.whatsapp_shipment_milestone(s.status) when 'SHIPPED' then 'ORDER_SHIPPED' when 'OUT_FOR_DELIVERY' then 'OUT_FOR_DELIVERY' when 'DELIVERED' then 'DELIVERY_CONFIRMATION' end;
  select customer_id into o.customer_id from public.orders where id=s.order_id;
  select max(occurred_at) into stamp from public.tracking_events where shipment_id=s.id and communication_authenticated and private.whatsapp_shipment_milestone(status)=private.whatsapp_shipment_milestone(s.status);
  if w is not null then perform private.record_whatsapp_intent(w,s.id,o.customer_id,s.order_id,null,s.id,null,stamp);end if;
 end loop;
 -- Prepared checkout is the existing server-owned contact/cart boundary. Copy only
 -- validated immutable order lines, never browser totals/telemetry. No checkout writes.
 for cs in select c1.* from public.checkout_sessions c1 join public.orders o1 on o1.id=c1.order_id and o1.customer_id=c1.customer_id and o1.checkout_session_id=c1.id
 join public.commerce_quotes q on q.id=c1.quote_id where c1.created_at>=floor_at and c1.provider_order_id is not null and c1.amount_paise>0 and c1.amount_paise=o1.total_paise and o1.status='PAYMENT_PENDING'
 and q.cart_id is null and exists(select 1 from public.order_items where order_id=o1.id)
 and not exists(select 1 from public.carts where communication_checkout_session_id=c1.id)
 order by c1.created_at,c1.id limit least(greatest(p_limit,1),50) loop
  insert into public.carts(customer_id,guest_session_id,status,communication_checkout_session_id,updated_at)
  values(cs.customer_id,cs.guest_session_id,'OPEN',cs.id,cs.created_at) on conflict(communication_checkout_session_id) do nothing returning id into new_cart;
  if new_cart is not null then
   insert into public.cart_items(cart_id,line_id,product_variant_id,quantity,purchase_mode,interval_days)
   select new_cart,line_id,product_variant_id,quantity,purchase_mode,interval_days from public.order_items where order_id=cs.order_id;
  end if;
 end loop;
 -- Only server-owned cart rows, never client telemetry prices or arbitrary customer IDs.
 for cart in select c.* from public.carts c where c.customer_id is not null and c.status in ('OPEN','ABANDONED') and c.updated_at<=now()-interval '1 hour' and c.updated_at>now()-interval '24 hours'
 and exists(select 1 from public.cart_items where cart_id=c.id) and not exists(select 1 from public.communication_whatsapp_workflow_intents where workflow='CART_RECOVERY' and subject_id=c.id)
 order by c.updated_at,c.id limit least(greatest(p_limit,1),50) loop
  perform private.record_whatsapp_intent('CART_RECOVERY',cart.id,cart.customer_id,null,null,null,null,cart.updated_at);
 end loop;
 return n;
end $$;

create function public.comm_dispatch_whatsapp_workflows(p_limit integer default 50,p_dry boolean default true) returns integer language plpgsql security invoker set search_path='' as $$
declare i public.communication_whatsapp_workflow_intents;r public.communication_rules;msg uuid;run uuid;reason text;n integer:=0;v uuid;
begin
 for i in select * from public.communication_whatsapp_workflow_intents where status in ('PENDING','QUEUED') order by (status='PENDING') desc,created_at,id limit least(greatest(p_limit,1),50) for update skip locked loop
  reason:=public.comm_whatsapp_workflow_permission(i.id);
  if reason is not null then
   update public.communication_whatsapp_workflow_intents set status='SUPPRESSED',suppression_reason=reason,updated_at=now() where id=i.id;
   update public.message_deliveries set status='SUPPRESSED',suppression_reason=reason,lease_until=null where customer_message_id=i.message_id and channel='WHATSAPP' and status in ('PENDING','FAILED_RETRYABLE');continue;
  end if;
  if i.status='QUEUED' then continue;end if;
  select * into r from public.communication_rules where name='UPPERMOST_WHATSAPP_'||i.workflow||'_V1' and status='ACTIVE' and approved_at is not null and i.source_at>=approved_at and (valid_from is null or i.source_at>=valid_from) and (valid_until is null or now()<valid_until) order by created_at,id limit 1;
  if not found then continue;end if;
  select v1.id into v from public.communication_template_versions v1 join public.communication_template_provider_artifacts a on a.template_version_id=v1.id
  where v1.id::text=r.action_config->'templates'->>'WHATSAPP' and v1.channel='WHATSAPP' and v1.status='ACTIVE' and a.provider_status='APPROVED';
  if v is null or (select count(*) from jsonb_object_keys(r.action_config->'templates'))<>1 then continue;end if;
  insert into public.customer_messages(customer_id,order_id,payment_attempt_id,shipment_id,message_key,title,body,severity,metadata)
  values(i.customer_id,i.order_id,i.payment_attempt_id,i.shipment_id,'WHATSAPP_WORKFLOW',i.workflow,'Uppermost update','INFO',jsonb_build_object('communication_engine',true,'whatsapp_workflow_intent_id',i.id)) returning id into msg;
  run:=public.comm_start_run(r.id,null,null,'whatsapp-workflow:'||i.id,p_dry,i.customer_id,msg,jsonb_build_object('whatsapp_workflow_intent_id',i.id,'order_id',i.order_id,'at',i.source_at,'status',case i.workflow when 'CART_RECOVERY' then 'ABANDONED' when 'ORDER_SHIPPED' then 'SHIPPED' when 'OUT_FOR_DELIVERY' then 'OUT_FOR_DELIVERY' when 'DELIVERY_CONFIRMATION' then 'DELIVERED' when 'PAYMENT_FAILED' then 'FAILED' else 'CONFIRMED' end,'event_type',case when i.workflow='CART_RECOVERY' then 'commerce.cart.abandoned' when i.shipment_id is not null then 'commerce.shipment.changed' when i.payment_attempt_id is not null then 'commerce.payment.changed' else 'commerce.order.confirmed' end));
  if run is null then raise exception 'WHATSAPP_WORKFLOW_RULE_CHANGED';end if;
  update public.communication_whatsapp_workflow_intents set status='QUEUED',run_id=run,message_id=msg,updated_at=now() where id=i.id;n:=n+1;
 end loop;return n;
end $$;

-- Welcome already has an intent. Record eligibility at capture; activation never
-- retroactively changes it. Preserve the existing connector's return contract.
alter table public.communication_whatsapp_welcome_intents add column activation_eligible boolean not null default false;
create function private.whatsapp_welcome_activation() returns trigger language plpgsql set search_path='' as $$begin
 new.activation_eligible:=exists(select 1 from public.communication_rules r join public.um_leads l on l.id=new.lead_id where r.name='UPPERMOST_WHATSAPP_WELCOME_V1' and r.status='ACTIVE' and r.approved_at is not null and l.consent_recorded_at>=r.approved_at and new.created_at>=r.approved_at and (r.valid_from is null or l.consent_recorded_at>=r.valid_from) and (r.valid_until is null or now()<r.valid_until));return new;
end $$;
create trigger whatsapp_welcome_activation before insert on public.communication_whatsapp_welcome_intents for each row execute function private.whatsapp_welcome_activation();
alter function public.comm_dispatch_whatsapp_welcomes(integer,boolean) rename to comm_dispatch_whatsapp_welcomes_before_cutoff;
create function public.comm_dispatch_whatsapp_welcomes(p_limit integer default 50,p_dry boolean default true) returns integer language plpgsql security invoker set search_path='' as $$begin
 update public.communication_whatsapp_welcome_intents set status='SUPPRESSED',updated_at=now() where status='PENDING' and (not activation_eligible or created_at<now()-interval '24 hours');
 return public.comm_dispatch_whatsapp_welcomes_before_cutoff(p_limit,p_dry);
end $$;

create function public.comm_whatsapp_delivery_permission(p_delivery_id uuid) returns text language plpgsql security invoker set search_path='' as $$
declare m public.customer_messages;i public.communication_whatsapp_workflow_intents;w public.communication_whatsapp_welcome_intents;
begin
 select cm.* into m from public.customer_messages cm join public.message_deliveries d on d.customer_message_id=cm.id where d.id=p_delivery_id and d.channel='WHATSAPP';
 if m.metadata ? 'whatsapp_workflow_intent_id' then
  select * into i from public.communication_whatsapp_workflow_intents where id::text=m.metadata->>'whatsapp_workflow_intent_id';
  if not found or i.customer_id<>m.customer_id or i.message_id is distinct from m.id or i.order_id is distinct from m.order_id or i.payment_attempt_id is distinct from m.payment_attempt_id or i.shipment_id is distinct from m.shipment_id then return 'WORKFLOW_IDENTITY_CONFLICT';end if;
  return public.comm_whatsapp_workflow_permission(i.id);
 elsif m.metadata ? 'whatsapp_welcome_intent_id' then
  select * into w from public.communication_whatsapp_welcome_intents where id::text=m.metadata->>'whatsapp_welcome_intent_id';
  if not found or not w.activation_eligible or w.customer_id<>m.customer_id or w.message_id is distinct from m.id or w.created_at<now()-interval '24 hours' then return 'HISTORICAL_DRAFT';end if;
  if w.status='SUPPRESSED' or not public.comm_whatsapp_marketing_allowed(w.customer_id) then return 'CONSENT_REQUIRED';end if;
  if not exists(select 1 from public.communication_rules where name='UPPERMOST_WHATSAPP_WELCOME_V1' and status='ACTIVE' and approved_at is not null and w.created_at>=approved_at and (valid_from is null or w.created_at>=valid_from) and (valid_until is null or now()<valid_until)) then return 'RULE_NOT_ACTIVE';end if;
 end if;
 return null;
end $$;

do $$declare p record;begin
 for p in select oid::regprocedure as signature from pg_proc where pronamespace in ('public'::regnamespace,'private'::regnamespace) and proname in
 ('whatsapp_shipment_milestone','whatsapp_shipment_rank','whatsapp_shipment_terminal','whatsapp_payment_proven','whatsapp_order_paid','record_whatsapp_intent','whatsapp_welcome_activation',
 'comm_ingest_shipment_event','comm_whatsapp_workflow_permission','comm_capture_whatsapp_workflows','comm_dispatch_whatsapp_workflows','comm_whatsapp_delivery_permission','comm_dispatch_whatsapp_welcomes','comm_dispatch_whatsapp_welcomes_before_cutoff') loop
 execute 'revoke all on function '||p.signature||' from public,anon,authenticated';execute 'grant execute on function '||p.signature||' to service_role';
 end loop;
end $$;
