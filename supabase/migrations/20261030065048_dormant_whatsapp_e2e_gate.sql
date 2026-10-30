-- LOCAL ONLY. Depends on 20261029133013_whatsapp_seven_workflows and its prerequisites.
-- Dormant service-only budget. Does not change dispatch, dry-run, rules or senders.
create table public.communication_whatsapp_e2e_authorizations (
 id uuid primary key default gen_random_uuid(),
 approval_ref uuid not null unique,
 approved_by uuid not null references public.admin_memberships(user_id),
 consent_id uuid not null references public.communication_preference_history(id),
 delivery_id uuid not null unique references public.message_deliveries(id),
 intent_id uuid not null unique references public.communication_whatsapp_workflow_intents(id),
 shipment_id uuid not null unique references public.shipments(id),
 binding jsonb not null,
 created_at timestamptz not null default clock_timestamp(),
 expires_at timestamptz not null,
 consumed_at timestamptz,
 revoked_at timestamptz,
 attempt_count integer not null default 0 check(attempt_count in (0,1)),
 check(expires_at>created_at and expires_at<=created_at+interval '15 minutes'),
 check((consumed_at is null and attempt_count=0) or (consumed_at is not null and attempt_count=1))
);
alter table public.communication_whatsapp_e2e_authorizations enable row level security;
revoke all on public.communication_whatsapp_e2e_authorizations from public,anon,authenticated;
-- Remove Supabase-style default ALL grants before the narrow service grant.
revoke all on public.communication_whatsapp_e2e_authorizations from service_role;
grant select,insert,update on public.communication_whatsapp_e2e_authorizations to service_role;

create function private.whatsapp_e2e_context_valid(c jsonb) returns boolean
language sql immutable set search_path='' as $$
 select coalesce(jsonb_typeof(c)='object'
 and c->>'project_ref'='jwsivyxapfnyaafdcdos'
 and c->>'base_url'='https://staging.uppermost.store'
 and c->>'environment'='preview' and c->>'branch'='staging'
 and c->'dry_run'='true'::jsonb
 and c->>'build_sha' ~ '^[0-9a-f]{40}$'
 and c->>'reviewed_build_sha'=c->>'build_sha'
 and c->>'app_id' ~ '^[0-9]+$' and c->>'waba_id' ~ '^[0-9]+$' and c->>'sender_id' ~ '^[0-9]+$',false);
$$;

-- Build the binding from authoritative rows, never from a browser's claim.
-- Caller holds the phone advisory lock when reserving, shared with STOP ingestion.
create function private.whatsapp_e2e_snapshot(p_delivery uuid,p_context jsonb,p_approval uuid,p_actor uuid,p_consent uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare d public.message_deliveries;m public.customer_messages;i public.communication_whatsapp_workflow_intents;
 r public.communication_rules;run public.communication_runs;rr public.communication_run_recipients;
 c public.customers;o public.orders;s public.shipments;v public.communication_template_versions;
 a public.communication_template_provider_artifacts;h public.communication_preference_history;ev public.tracking_events;phone text;
begin
 if not private.whatsapp_e2e_context_valid(p_context) then return null;end if;
 perform 1 from public.admin_memberships where user_id=p_actor and active and role='ADMIN' for share nowait;
 if not found then return null;end if;
 select * into d from public.message_deliveries where id=p_delivery;
 if not found or d.channel<>'WHATSAPP' or d.provider<>'META_WHATSAPP' or d.provider_message_id is not null
 or d.status not in ('PENDING','SENDING') or d.retry_count<>0 then return null;end if;
 select * into m from public.customer_messages where id=d.customer_message_id for share nowait;
 if not found then return null;end if;
 select * into i from public.communication_whatsapp_workflow_intents where message_id=m.id for share nowait;
 if not found or i.workflow<>'ORDER_SHIPPED' or i.status<>'QUEUED'
 or public.comm_whatsapp_delivery_permission(d.id) is not null then return null;end if;
 if m.customer_id is distinct from i.customer_id or m.order_id is distinct from i.order_id
 or m.shipment_id is distinct from i.shipment_id or m.payment_attempt_id is distinct from i.payment_attempt_id
 or m.metadata->>'whatsapp_workflow_intent_id' is distinct from i.id::text
 or m.metadata->'communication_engine' is distinct from 'true'::jsonb then return null;end if;
 select * into rr from public.communication_run_recipients where id=d.run_recipient_id for share nowait;
 if not found or rr.customer_id<>i.customer_id or rr.run_id<>i.run_id then return null;end if;
 select * into run from public.communication_runs where id=i.run_id for share nowait;
 if not found or run.subject_customer_id is distinct from i.customer_id or run.source_message_id is distinct from m.id
 or run.event_context->>'whatsapp_workflow_intent_id' is distinct from i.id::text
 or run.event_context->>'order_id' is distinct from i.order_id::text
 or run.event_context->>'event_type' is distinct from 'commerce.shipment.changed'
 or run.event_context->>'status' is distinct from 'SHIPPED' then return null;end if;
 select * into r from public.communication_rules where id=run.rule_id for share nowait;
 if not found or r.name<>'UPPERMOST_WHATSAPP_ORDER_SHIPPED_V1' or r.status<>'ACTIVE'
 or r.version<>run.rule_version
 or (run.rule_snapshot-array['next_run_at','last_scheduled_at','last_started_at','last_completed_at','last_status','last_error','updated_at'])
 is distinct from (to_jsonb(r)-array['next_run_at','last_scheduled_at','last_started_at','last_completed_at','last_status','last_error','updated_at'])
 or r.trigger_type<>'EVENT' or r.trigger_event_type<>'commerce.shipment.changed'
 or r.action_config->'templates' is distinct from jsonb_build_object('WHATSAPP',d.template_version_id)
 or r.channel_strategy is distinct from '["WHATSAPP"]'::jsonb then return null;end if;
 select * into c from public.customers where id=i.customer_id for share nowait;
 if not found then return null;end if;
 -- Require already-canonical names so SQL binds exactly the JS .trim() payload.
 if nullif(c.name,'') is null or c.name is distinct from btrim(c.name,U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF') then return null;end if;
 phone:='+'||regexp_replace(coalesce(c.phone,''),'[^0-9]','','g');
 if phone !~ '^\+[1-9][0-9]{9,14}$' or c.normalized_phone is distinct from phone
 or exists(select 1 from public.communication_whatsapp_opt_outs where normalized_phone=phone)
 then return null;end if;
 perform 1 from public.communication_preferences where customer_id=c.id and channel='WHATSAPP' and purpose='TRANSACTIONAL' and allowed for share nowait;
 if not found then return null;end if;
 select * into h from public.communication_preference_history where id=p_consent for share nowait;
 if not found or h.customer_id<>c.id or h.channel<>'WHATSAPP' or h.purpose<>'TRANSACTIONAL' or not h.allowed
 or h.source<>'EXPLICIT_E2E_TEST' or h.evidence->>'approval_ref' is distinct from p_approval::text
 or h.evidence->>'recipient' is distinct from phone or h.created_at>clock_timestamp() then return null;end if;
 select * into o from public.orders where id=i.order_id and customer_id=c.id for share nowait;
 if not found or o.pricing_snapshot->>'communication_e2e_fixture' is distinct from 'true' then return null;end if;
 perform 1 from public.payment_attempts where order_id=o.id for share nowait;
 if not private.whatsapp_order_paid(o.id) then return null;end if;
 select * into s from public.shipments where id=i.shipment_id and order_id=o.id for share nowait;
 if not found or private.whatsapp_shipment_milestone(s.status) is distinct from 'SHIPPED' then return null;end if;
 select * into ev from public.tracking_events where shipment_id=s.id and communication_authenticated
 and private.whatsapp_shipment_milestone(status)='SHIPPED' order by occurred_at desc,id desc limit 1 for share nowait;
 if not found or ev.raw_payload->>'e2e_test' is distinct from 'true' then return null;end if;
 select * into v from public.communication_template_versions where id=d.template_version_id for share nowait;
 if not found or v.channel<>'WHATSAPP' or v.category<>'TRANSACTIONAL' or v.status<>'ACTIVE'
 or v.parameter_schema->'body_parameters' is distinct from '["name","order_number"]'::jsonb
 or v.parameter_schema->'required' is distinct from '["name","order_number"]'::jsonb then return null;end if;
 select * into a from public.communication_template_provider_artifacts where template_version_id=v.id for share nowait;
 if not found or a.provider<>'META_WHATSAPP' or a.sync_mode<>'PROVIDER_TEMPLATE'
 or a.provider_status<>'APPROVED' or a.provider_category is distinct from 'UTILITY'
 or nullif(a.provider_template_id,'') is null or nullif(a.provider_template_name,'') is null or nullif(a.provider_language,'') is null then return null;end if;
 -- Recheck after locking sources: a mutation committed before its lock must
 -- invalidate this snapshot; later normal mutations cannot commit until release.
 if public.comm_whatsapp_delivery_permission(d.id) is not null then return null;end if;
 return jsonb_build_object('context',p_context,'approval_ref',p_approval,'approved_by',p_actor,'consent',to_jsonb(h),
 'delivery_id',d.id,'intent_id',i.id,'customer_id',c.id,'recipient',phone,'order_id',o.id,'shipment_id',s.id,
 'event',jsonb_build_object('id',ev.id,'provider_event_id',ev.provider_event_id,'occurred_at',ev.occurred_at,'status',ev.status),
 'rule',to_jsonb(r),'template',to_jsonb(v),'artifact',to_jsonb(a),
 'message',jsonb_build_object('id',m.id,'customer_id',m.customer_id,'order_id',m.order_id,'shipment_id',m.shipment_id,'metadata',m.metadata),
 'run',jsonb_build_object('id',run.id,'rule_id',run.rule_id,'rule_version',run.rule_version,'event_context',run.event_context,'recipient_id',rr.id,'customer_id',rr.customer_id),
 'parameters',jsonb_build_array(c.name,o.order_number::text),
 'order',jsonb_build_object('number',o.order_number,'total_paise',o.total_paise,'currency',o.currency,'paid_at',o.paid_at));
end $$;

-- No reset, rebinding, expiry extension or deletion, even after failure/revocation.
create function private.whatsapp_e2e_immutable() returns trigger language plpgsql set search_path='' as $$
begin
 if TG_OP in ('DELETE','TRUNCATE') then raise exception 'E2E_AUTHORIZATION_IMMUTABLE';end if;
 if TG_OP='INSERT' then
 if new.consumed_at is not null or new.revoked_at is not null or new.attempt_count<>0
  or new.intent_id::text is distinct from new.binding->>'intent_id' or new.shipment_id::text is distinct from new.binding->>'shipment_id'
  or new.created_at<clock_timestamp()-interval '1 minute' or new.created_at>clock_timestamp()
  or new.expires_at<=clock_timestamp() or new.expires_at>clock_timestamp()+interval '15 minutes'
  or new.binding is distinct from private.whatsapp_e2e_snapshot(new.delivery_id,new.binding->'context',new.approval_ref,new.approved_by,new.consent_id)
  or new.binding is null then raise exception 'E2E_BINDING_INVALID';end if;
  return new;
 end if;
 if (to_jsonb(new)-'consumed_at'-'revoked_at'-'attempt_count') is distinct from (to_jsonb(old)-'consumed_at'-'revoked_at'-'attempt_count')
 or (old.consumed_at is not null and (new.consumed_at is distinct from old.consumed_at or new.attempt_count<>old.attempt_count))
 or (old.revoked_at is not null and new.revoked_at is distinct from old.revoked_at)
 or (new.consumed_at is not null and old.consumed_at is null and (old.revoked_at is not null or old.expires_at<=clock_timestamp()))
 then raise exception 'E2E_AUTHORIZATION_IMMUTABLE';end if;
 return new;
end $$;
create trigger whatsapp_e2e_immutable before insert or update or delete on public.communication_whatsapp_e2e_authorizations
for each row execute function private.whatsapp_e2e_immutable();
create trigger whatsapp_e2e_no_truncate before truncate on public.communication_whatsapp_e2e_authorizations
for each statement execute function private.whatsapp_e2e_immutable();

create function public.comm_authorize_whatsapp_e2e(p_delivery_id uuid,p_context jsonb,p_approval_ref uuid,p_approved_by uuid,p_consent_id uuid,p_expires_at timestamptz)
returns uuid language plpgsql security invoker set search_path='' as $$
declare b jsonb;existing public.communication_whatsapp_e2e_authorizations;result uuid;
begin
 if not private.whatsapp_e2e_context_valid(p_context) then raise exception 'E2E_CONTEXT_INVALID';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_approval_ref::text,30065048));
 select * into existing from public.communication_whatsapp_e2e_authorizations where approval_ref=p_approval_ref;
 if found then
  if existing.delivery_id is distinct from p_delivery_id or existing.approved_by is distinct from p_approved_by
  or existing.consent_id is distinct from p_consent_id or existing.binding->'context' is distinct from p_context then raise exception 'E2E_APPROVAL_CONFLICT';end if;
  return existing.id; -- replay never renews expiry, restores budget or revocation.
 end if;
 if p_expires_at is null or p_expires_at<=clock_timestamp() or p_expires_at>clock_timestamp()+interval '15 minutes' then raise exception 'E2E_EXPIRY_INVALID';end if;
 b:=private.whatsapp_e2e_snapshot(p_delivery_id,p_context,p_approval_ref,p_approved_by,p_consent_id);
 if b is null then raise exception 'E2E_BINDING_INVALID';end if;
 begin
  insert into public.communication_whatsapp_e2e_authorizations(approval_ref,approved_by,consent_id,delivery_id,intent_id,shipment_id,binding,expires_at)
  values(p_approval_ref,p_approved_by,p_consent_id,p_delivery_id,(b->>'intent_id')::uuid,(b->>'shipment_id')::uuid,b,p_expires_at) returning id into result;
 exception when unique_violation then raise exception 'E2E_APPROVAL_CONFLICT';end;
 return result;
end $$;

create function public.comm_reserve_whatsapp_e2e(p_id uuid,p_context jsonb) returns boolean
language plpgsql security invoker set search_path='' as $$
declare a public.communication_whatsapp_e2e_authorizations;d public.message_deliveries;b jsonb;
begin
 if not private.whatsapp_e2e_context_valid(p_context) then return false;end if;
 select * into a from public.communication_whatsapp_e2e_authorizations where id=p_id for update;
 if not found or a.consumed_at is not null or a.revoked_at is not null or a.expires_at<=clock_timestamp()
 or a.binding->'context' is distinct from p_context then return false;end if;
 perform pg_advisory_xact_lock(hashtextextended('phone:'||(a.binding->>'recipient'),1826));
 -- Match dispatcher order (intent before delivery); reject busy source rows rather
 -- than waiting behind a mutation and sending from a stale snapshot.
 perform 1 from public.communication_whatsapp_workflow_intents where id=a.intent_id for share nowait;
 select * into d from public.message_deliveries where id=a.delivery_id for update nowait;
 if not found or d.status<>'SENDING' or d.lease_until is null or d.lease_until<=clock_timestamp() then return false;end if;
 b:=private.whatsapp_e2e_snapshot(a.delivery_id,p_context,a.approval_ref,a.approved_by,a.consent_id);
 if b is null or b is distinct from a.binding or a.expires_at<=clock_timestamp() then return false;end if;
 update public.communication_whatsapp_e2e_authorizations set consumed_at=clock_timestamp(),attempt_count=1 where id=a.id;
 return true;
exception when lock_not_available then return false;
end $$;

create function public.comm_revoke_whatsapp_e2e(p_id uuid) returns void
language sql security invoker set search_path='' as $$
 update public.communication_whatsapp_e2e_authorizations set revoked_at=clock_timestamp() where id=p_id and revoked_at is null;
$$;

do $$declare p record;begin
 for p in select oid::regprocedure signature from pg_proc where pronamespace in ('public'::regnamespace,'private'::regnamespace)
 and proname in ('whatsapp_e2e_context_valid','whatsapp_e2e_snapshot','whatsapp_e2e_immutable','comm_authorize_whatsapp_e2e','comm_reserve_whatsapp_e2e','comm_revoke_whatsapp_e2e') loop
 execute 'revoke all on function '||p.signature||' from public,anon,authenticated';
 execute 'grant execute on function '||p.signature||' to service_role';
 end loop;
end $$;
