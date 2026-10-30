-- Local staging simulation only. No provider or financial mutations.
alter table public.shipments drop constraint shipments_provider_check;
alter table public.shipments add constraint shipments_provider_check check(provider in ('SHIPROCKET','STAGING_SIMULATION'));
create table public.shipment_simulation_audit (
 id uuid primary key default gen_random_uuid(),event_id uuid unique,order_id uuid not null references public.orders(id),
 shipment_id uuid not null references public.shipments(id),actor_id uuid references public.admin_memberships(user_id),
 status text not null,context jsonb not null,created_at timestamptz not null default now()
);
alter table public.shipment_simulation_audit enable row level security;
revoke all on public.shipment_simulation_audit from public,anon,authenticated,service_role;
grant select,insert on public.shipment_simulation_audit to service_role;
create function private.shipment_simulation_append_only() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'SIMULATION_AUDIT_IMMUTABLE';end $$;
create trigger shipment_simulation_audit_immutable before update or delete on public.shipment_simulation_audit for each row execute function private.shipment_simulation_append_only();
create trigger shipment_simulation_audit_no_truncate before truncate on public.shipment_simulation_audit for each statement execute function private.shipment_simulation_append_only();
create function private.shipment_simulation_context(p jsonb) returns void language plpgsql set search_path='' as $$
begin
 if p is null or jsonb_typeof(p)<>'object' or p - 'build_sha' - 'test_pincodes' <> '{"project_ref":"jwsivyxapfnyaafdcdos","base_url":"https://staging.uppermost.store","environment":"preview","branch":"staging","dry_run":true,"api_enabled":false,"simulation_enabled":true,"razorpay_test_key":true}'::jsonb
 or coalesce(p->>'build_sha','') !~ '^[0-9a-fA-F]{40}$' then raise exception 'SIMULATION_CONTEXT_INVALID';end if;
 if jsonb_typeof(p->'test_pincodes') is distinct from 'array' then raise exception 'SIMULATION_CONTEXT_INVALID';end if;
 if jsonb_array_length(p->'test_pincodes')=0 or exists(select 1 from jsonb_array_elements(p->'test_pincodes') pin where jsonb_typeof(pin)<>'string' or pin#>>'{}' !~ '^[1-9][0-9]{5}$') then raise exception 'SIMULATION_CONTEXT_INVALID';end if;
end $$;
create function private.shipment_simulation_order(p_order uuid,p_context jsonb) returns void language plpgsql set search_path='' as $$
declare o public.orders;
begin
 select * into o from public.orders where id=p_order for update;
 -- Hold captured evidence stable through creation or milestone persistence.
 perform 1 from public.payment_attempts where order_id=p_order for share;
 if not found or o.order_kind<>'INITIAL' or not private.whatsapp_order_paid(p_order) then raise exception 'SIMULATION_PAID_ORDER_REQUIRED';end if;
 perform 1 from public.checkout_sessions where id=o.checkout_session_id for share;
 if not exists(select 1 from public.checkout_sessions c join public.payment_attempts p on p.checkout_session_id=c.id
 where c.id=o.checkout_session_id and c.order_id=o.id and c.customer_id=o.customer_id and c.amount_paise=o.total_paise
 and p.order_id=o.id and p.kind=c.payment_kind and p.amount_paise=o.total_paise and p.currency=o.currency
 and private.whatsapp_payment_proven(p,'CAPTURED')) then raise exception 'SIMULATION_PAID_ORDER_REQUIRED';end if;
 if o.pricing_snapshot#>'{shipping,simulated}' is distinct from 'true'::jsonb
 or o.pricing_snapshot#>'{shipping,serviceable}' is distinct from 'true'::jsonb
 or o.pricing_snapshot#>>'{shipping,simulation_project_ref}' is distinct from 'jwsivyxapfnyaafdcdos'
 or nullif(o.address_snapshot->>'postal_code','') is null
 or not (p_context->'test_pincodes' @> jsonb_build_array(o.address_snapshot->>'postal_code'))
 or o.pricing_snapshot#>>'{shipping,simulation_postal_code}' is distinct from o.address_snapshot->>'postal_code'
 then raise exception 'SIMULATION_QUOTE_REQUIRED';end if;
end $$;
create function private.guard_simulated_shipment() returns trigger language plpgsql set search_path='' as $$
begin
 if (case when TG_OP='INSERT' then new.provider='STAGING_SIMULATION' else old.provider='STAGING_SIMULATION' or new.provider='STAGING_SIMULATION' end)
 and coalesce(current_setting('uppermost.shipment_simulation',true),'')<>'on' then raise exception 'SIMULATION_MUTATION_FORBIDDEN';end if;
 if TG_OP='UPDATE' and old.provider='STAGING_SIMULATION' and (new.provider is distinct from old.provider or new.order_id is distinct from old.order_id or new.provider_shipment_id is distinct from old.provider_shipment_id or new.awb_code is not null or new.courier_id is not null or new.provider_order_id is not null) then raise exception 'SIMULATION_IDENTITY_IMMUTABLE';end if;
 return new;
end $$;
create trigger guard_simulated_shipment before insert or update on public.shipments for each row execute function private.guard_simulated_shipment();
create function private.guard_simulated_tracking() returns trigger language plpgsql set search_path='' as $$
begin
 if exists(select 1 from public.shipments where provider='STAGING_SIMULATION' and
 (id=case when TG_OP<>'DELETE' then new.shipment_id else null end or id=case when TG_OP<>'INSERT' then old.shipment_id else null end))
 and coalesce(current_setting('uppermost.shipment_simulation',true),'')<>'on' then raise exception 'SIMULATION_TRACKING_FORBIDDEN';end if;
 if TG_OP='DELETE' then return old;end if;return new;
end $$;
create trigger guard_simulated_tracking before insert or update or delete on public.tracking_events for each row execute function private.guard_simulated_tracking();
alter function public.comm_ingest_shipment_event(jsonb) rename to comm_ingest_shipment_event_before_simulation;
create function public.comm_ingest_shipment_event(p_payload jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
begin
 if exists(select 1 from public.shipments where provider='STAGING_SIMULATION' and (provider_shipment_id=p_payload->>'shipment_id' or awb_code=p_payload->>'awb'))
 and coalesce(current_setting('uppermost.shipment_simulation',true),'')<>'on' then raise exception 'SIMULATION_INGEST_FORBIDDEN';end if;
 return public.comm_ingest_shipment_event_before_simulation(p_payload);
end $$;
create function public.comm_create_simulated_shipment(p_order_id uuid,p_context jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare s public.shipments;sid uuid:=gen_random_uuid();previous text:=coalesce(current_setting('uppermost.shipment_simulation',true),'');shipping jsonb;
begin
 perform private.shipment_simulation_context(p_context);perform private.shipment_simulation_order(p_order_id,p_context);
 select * into s from public.shipments where order_id=p_order_id for update;
 if found then
  if s.provider<>'STAGING_SIMULATION' then raise exception 'SIMULATION_SHIPMENT_CONFLICT';end if;
 else
  perform set_config('uppermost.shipment_simulation','on',true);
  select pricing_snapshot->'shipping' into shipping from public.orders where id=p_order_id;
  insert into public.shipments(id,order_id,provider,status,provider_shipment_id,courier_name,raw_metadata,expected_from,expected_to)
  values(sid,p_order_id,'STAGING_SIMULATION','ORDER_CREATED','sim_'||sid,'Simulated staging shipment','{"simulated":true}',
   nullif(left(shipping->>'estimated_delivery_from',10),'')::date,nullif(left(shipping->>'estimated_delivery_to',10),'')::date) returning * into s;
  perform set_config('uppermost.shipment_simulation',previous,true);
  insert into public.shipment_simulation_audit(order_id,shipment_id,status,context) values(p_order_id,s.id,'ORDER_CREATED',p_context);
 end if;
 return jsonb_build_object('shipment_id',s.id,'status',s.status,'simulated',true);
end $$;
create function public.comm_transition_simulated_shipment(p_order_id uuid,p_shipment_id uuid,p_status text,p_event_id uuid,p_actor_id uuid,p_context jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare s public.shipments;a public.shipment_simulation_audit;previous text:=coalesce(current_setting('uppermost.shipment_simulation',true),'');
begin
 perform private.shipment_simulation_context(p_context);
 perform 1 from public.admin_memberships where user_id=p_actor_id and active and role='ADMIN' for share;
 if not found then raise exception 'SIMULATION_ADMIN_REQUIRED';end if;
 perform private.shipment_simulation_order(p_order_id,p_context);
 select * into s from public.shipments where id=p_shipment_id and order_id=p_order_id for update;
 if not found or s.provider<>'STAGING_SIMULATION' then raise exception 'SIMULATION_SHIPMENT_REQUIRED';end if;
 if p_event_id is null or p_status is null or p_status not in ('SHIPPED','OUT_FOR_DELIVERY','DELIVERED') then raise exception 'SIMULATION_TRANSITION_INVALID';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_event_id::text,0));
 select * into a from public.shipment_simulation_audit where event_id=p_event_id;
 if found then
  if a.order_id<>p_order_id or a.shipment_id<>p_shipment_id or a.actor_id<>p_actor_id or a.status<>p_status or a.context<>p_context then raise exception 'SIMULATION_EVENT_CONFLICT';end if;
  return jsonb_build_object('shipment_id',s.id,'status',a.status,'simulated',true,'duplicate',true);
 end if;
 if p_status is distinct from (case s.status when 'ORDER_CREATED' then 'SHIPPED' when 'SHIPPED' then 'OUT_FOR_DELIVERY' when 'OUT_FOR_DELIVERY' then 'DELIVERED' else null end) then raise exception 'SIMULATION_TRANSITION_INVALID';end if;
 perform set_config('uppermost.shipment_simulation','on',true);
 perform public.comm_ingest_shipment_event(jsonb_build_object('shipment_id',s.provider_shipment_id,'event_id',p_event_id,'current_status',p_status,'simulated',true));
 update public.tracking_events set description='Simulated staging shipment update' where provider_event_id=p_event_id::text and shipment_id=s.id;
 perform set_config('uppermost.shipment_simulation',previous,true);
 insert into public.shipment_simulation_audit(event_id,order_id,shipment_id,actor_id,status,context) values(p_event_id,p_order_id,s.id,p_actor_id,p_status,p_context);
 return jsonb_build_object('shipment_id',s.id,'status',p_status,'simulated',true);
end $$;
revoke all on function public.comm_create_simulated_shipment(uuid,jsonb),public.comm_transition_simulated_shipment(uuid,uuid,text,uuid,uuid,jsonb),public.comm_ingest_shipment_event(jsonb),public.comm_ingest_shipment_event_before_simulation(jsonb),private.shipment_simulation_context(jsonb),private.shipment_simulation_order(uuid,jsonb),private.guard_simulated_shipment(),private.guard_simulated_tracking(),private.shipment_simulation_append_only() from public,anon,authenticated;
grant execute on function public.comm_create_simulated_shipment(uuid,jsonb),public.comm_transition_simulated_shipment(uuid,uuid,text,uuid,uuid,jsonb),public.comm_ingest_shipment_event(jsonb),public.comm_ingest_shipment_event_before_simulation(jsonb),private.shipment_simulation_context(jsonb),private.shipment_simulation_order(uuid,jsonb) to service_role;
