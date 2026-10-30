-- Additive WhatsApp intent/consent boundary. No provider calls or rule activation.
create table public.communication_whatsapp_opt_outs (
 normalized_phone text primary key check(normalized_phone ~ '^\+[1-9][0-9]{9,14}$'),
 created_at timestamptz not null default now()
);
create table public.communication_whatsapp_welcome_intents (
 id uuid primary key default gen_random_uuid(),
 normalized_phone text not null unique,
 lead_id uuid not null references public.um_leads(id),
 customer_id uuid not null references public.customers(id),
 status text not null default 'PENDING' check(status in ('PENDING','QUEUED','SUPPRESSED')),
 run_id uuid unique references public.communication_runs(id),
 message_id uuid unique references public.customer_messages(id),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index communication_whatsapp_pending_idx on public.communication_whatsapp_welcome_intents(created_at,id) where status='PENDING';
alter table public.communication_whatsapp_opt_outs enable row level security;
alter table public.communication_whatsapp_welcome_intents enable row level security;
revoke all on public.communication_whatsapp_opt_outs,public.communication_whatsapp_welcome_intents from public,anon,authenticated;
grant select,insert,update on public.communication_whatsapp_opt_outs,public.communication_whatsapp_welcome_intents to service_role;

create function public.comm_connect_whatsapp_welcome(p_lead_id uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare l public.um_leads%rowtype;c public.customers%rowtype;digits text;phone_key text;email_key text;identity_key text;ids uuid[];intent public.communication_whatsapp_welcome_intents;
begin
 select * into l from public.um_leads where id=p_lead_id for update;
 if not found then raise exception 'LEAD_NOT_FOUND';end if;
 if lower(coalesce(l.status,''))='unsubscribed' then return jsonb_build_object('status','opted_out');end if;
 if coalesce(l.metadata->>'lead_stage','') not in ('completed','launch_waitlist') or l.consent_recorded_at is null or nullif(btrim(l.phone),'') is null then
  return jsonb_build_object('status','ineligible');
 end if;
 digits:=regexp_replace(l.phone,'[^0-9]','','g');
 phone_key:=case when length(digits)=10 then '+91'||digits else '+'||digits end;
 email_key:=lower(btrim(l.email));
 if phone_key !~ '^\+[1-9][0-9]{9,14}$' or email_key !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then return jsonb_build_object('status','ineligible');end if;
 -- Match the existing email bridge's identity-lock ordering; STOP shares the phone lock.
 for identity_key in select value from unnest(array['email:'||email_key,'phone:'||phone_key]) value order by value loop
  perform pg_advisory_xact_lock(hashtextextended(identity_key,1826));
 end loop;
 if exists(select 1 from public.communication_whatsapp_opt_outs where normalized_phone=phone_key) then return jsonb_build_object('status','opted_out');end if;
 select array_agg(id) into ids from public.customers where normalized_email=email_key or normalized_phone=phone_key;
 if coalesce(cardinality(ids),0)=0 then
  if l.consent_whatsapp is not true then return jsonb_build_object('status','ineligible');end if;
  insert into public.customers(name,first_name,email,normalized_email,phone,normalized_phone)
  values(coalesce(nullif(btrim(concat_ws(' ',l.first_name,l.last_name)),''),'Uppermost Customer'),l.first_name,email_key,email_key,phone_key,phone_key) on conflict do nothing;
  select array_agg(id) into ids from public.customers where normalized_email=email_key or normalized_phone=phone_key;
 end if;
 if coalesce(cardinality(ids),0)<>1 then raise exception 'CUSTOMER_IDENTITY_CONFLICT';end if;
 select * into c from public.customers where id=ids[1] for update;
 if c.normalized_email is distinct from email_key or c.normalized_phone is distinct from phone_key then raise exception 'CUSTOMER_IDENTITY_CONFLICT';end if;
 if l.consent_whatsapp is not true then
  insert into public.communication_preferences(customer_id,channel,purpose,allowed,source,evidence)
  values(c.id,'WHATSAPP','MARKETING',false,'EXPLICIT_SIGNUP_WITHDRAWAL',jsonb_build_object('lead_id',l.id,'recorded_at',l.consent_recorded_at))
  on conflict(customer_id,channel,purpose) do update set allowed=false,source=excluded.source,evidence=excluded.evidence,updated_at=now();
  update public.communication_whatsapp_welcome_intents set status='SUPPRESSED',updated_at=now() where normalized_phone=phone_key and status='PENDING';
  return jsonb_build_object('status','opted_out');
 end if;
 -- Independent channel permission. A repeated signup never overwrites an opt-out.
 insert into public.communication_preferences(customer_id,channel,purpose,allowed,source,evidence)
 values(c.id,'WHATSAPP','MARKETING',true,'EXPLICIT_SIGNUP',jsonb_build_object('lead_id',l.id,'recorded_at',l.consent_recorded_at,'stage',l.metadata->>'lead_stage')) on conflict do nothing;
 if not exists(select 1 from public.communication_preferences where customer_id=c.id and channel='WHATSAPP' and purpose='MARKETING' and allowed) then return jsonb_build_object('status','opted_out');end if;
 select * into intent from public.communication_whatsapp_welcome_intents where normalized_phone=phone_key;
 if found then return jsonb_build_object('status','already_connected','customer_id',c.id);end if;
 insert into public.communication_whatsapp_welcome_intents(normalized_phone,lead_id,customer_id) values(phone_key,l.id,c.id);
 return jsonb_build_object('status','pending','customer_id',c.id);
end $$;

create or replace function public.comm_phone_opt_out(p_phone text,p_channel text) returns void
language plpgsql security invoker set search_path='' as $$
declare digits text;phone_key text;
begin
 digits:=regexp_replace(p_phone,'[^0-9]','','g');phone_key:=case when length(digits)=10 then '+91'||digits else '+'||digits end;
 if phone_key !~ '^\+[1-9][0-9]{9,14}$' then return;end if;
 perform pg_advisory_xact_lock(hashtextextended('phone:'||phone_key,1826));
 if p_channel='WHATSAPP' then
  insert into public.communication_whatsapp_opt_outs(normalized_phone) values(phone_key) on conflict do nothing;
  update public.communication_whatsapp_welcome_intents set status='SUPPRESSED',updated_at=now() where normalized_phone=phone_key and status='PENDING';
 end if;
 insert into public.communication_preferences(customer_id,channel,purpose,allowed,source)
 select id,p_channel,'MARKETING',false,'PROVIDER_OPTOUT' from public.customers where normalized_phone=phone_key
 on conflict(customer_id,channel,purpose) do update set allowed=false,source='PROVIDER_OPTOUT',updated_at=now();
end $$;

create function public.comm_whatsapp_marketing_allowed(p_customer_id uuid) returns boolean
language sql stable security invoker set search_path='' as $$
 select exists(select 1 from public.customers c join public.communication_preferences p on p.customer_id=c.id
 where c.id=p_customer_id and p.channel='WHATSAPP' and p.purpose='MARKETING' and p.allowed
 and not exists(select 1 from public.communication_whatsapp_opt_outs o where o.normalized_phone=c.normalized_phone)
 and not exists(select 1 from public.communication_whatsapp_welcome_intents i join public.um_leads l on l.id=i.lead_id
  where i.customer_id=c.id and i.status in ('PENDING','QUEUED') and l.consent_whatsapp is not true));
$$;

create function public.comm_whatsapp_phone_allowed(p_phone text) returns boolean
language sql stable security invoker set search_path='' as $$
 select not exists(select 1 from public.communication_whatsapp_opt_outs where normalized_phone=
 case when length(regexp_replace(p_phone,'[^0-9]','','g'))=10 then '+91' else '+' end||regexp_replace(p_phone,'[^0-9]','','g'));
$$;

create function public.comm_dispatch_whatsapp_welcomes(p_limit integer default 50,p_dry boolean default true) returns integer
language plpgsql security invoker set search_path='' as $$
declare intent public.communication_whatsapp_welcome_intents;r public.communication_rules;msg uuid;run uuid;n integer:=0;
begin
 select * into r from public.communication_rules where name='UPPERMOST_WHATSAPP_WELCOME_V1' and status='ACTIVE'
 and (valid_from is null or valid_from<=now()) and (valid_until is null or valid_until>now())
 and trigger_type='EVENT' and trigger_event_type='lead.whatsapp.completed'
 and action_config->'templates' ? 'WHATSAPP' and (select count(*) from jsonb_object_keys(action_config->'templates'))=1
 and exists(select 1 from public.communication_template_versions v join public.communication_template_provider_artifacts a on a.template_version_id=v.id
  where v.id=(action_config->'templates'->>'WHATSAPP')::uuid and v.channel='WHATSAPP' and v.category='MARKETING' and v.status='ACTIVE' and a.provider='META_WHATSAPP' and a.provider_status='APPROVED')
 order by created_at,id limit 1;
 if not found then return 0;end if;
 for intent in select * from public.communication_whatsapp_welcome_intents where status='PENDING' order by created_at,id limit least(greatest(p_limit,1),50) for update skip locked loop
  if not public.comm_whatsapp_marketing_allowed(intent.customer_id) or not exists(select 1 from public.um_leads where id=intent.lead_id and consent_whatsapp is true) then
   update public.communication_whatsapp_welcome_intents set status='SUPPRESSED',updated_at=now() where id=intent.id;continue;
  end if;
  insert into public.customer_messages(customer_id,message_key,title,body,severity,metadata)
  values(intent.customer_id,'WHATSAPP_WELCOME','Welcome to Uppermost','Welcome to Uppermost','INFO',jsonb_build_object('communication_engine',true,'lead_id',intent.lead_id,'whatsapp_welcome_intent_id',intent.id)) returning id into msg;
  run:=public.comm_start_run(r.id,null,null,'whatsapp-welcome:'||intent.id,p_dry,intent.customer_id,msg,jsonb_build_object('lead_id',intent.lead_id,'whatsapp_welcome_intent_id',intent.id,'event_type','lead.whatsapp.completed'));
  if run is null then raise exception 'WHATSAPP_WELCOME_RULE_CHANGED';end if;
  update public.communication_whatsapp_welcome_intents set status='QUEUED',run_id=run,message_id=msg,updated_at=now() where id=intent.id;n:=n+1;
 end loop;
 return n;
end $$;

-- Canonical delivery records retain the source lead without exposing its contact fields.
alter table public.message_deliveries add column lead_id uuid references public.um_leads(id);
create function private.communication_whatsapp_lead() returns trigger language plpgsql set search_path='' as $$
begin
 if new.channel='WHATSAPP' then select nullif(metadata->>'lead_id','')::uuid into new.lead_id from public.customer_messages where id=new.customer_message_id;end if;
 return new;
end $$;
create trigger communication_whatsapp_lead before insert on public.message_deliveries for each row execute function private.communication_whatsapp_lead();

-- Compatibility for pre-existing legacy sends; canonical callbacks remain in the existing ledger.
create function public.comm_whatsapp_legacy_event(p_message_id text,p_status text,p_at timestamptz) returns void
language plpgsql security invoker set search_path='' as $$
begin
 if p_status not in ('SENT','DELIVERED','READ','FAILED_PERMANENT') then return;end if;
 update public.whatsapp_messages set
 status=case p_status when 'FAILED_PERMANENT' then 'failed' else lower(p_status) end,
 sent_at=case when p_status='SENT' then coalesce(sent_at,p_at) else sent_at end,
 delivered_at=case when p_status in ('DELIVERED','READ') then coalesce(delivered_at,p_at) else delivered_at end,
 read_at=case when p_status='READ' then coalesce(read_at,p_at) else read_at end,
 failed_at=case when p_status='FAILED_PERMANENT' then coalesce(failed_at,p_at) else failed_at end
 where meta_message_id=p_message_id and (
  (case p_status when 'SENT' then 1 when 'DELIVERED' then 2 when 'READ' then 3 else 0 end)>
  (case lower(status) when 'sent' then 1 when 'delivered' then 2 when 'read' then 3 else 0 end)
  or (p_status='FAILED_PERMANENT' and lower(status) not in ('delivered','read')));
end $$;

revoke all on function public.comm_connect_whatsapp_welcome(uuid),public.comm_dispatch_whatsapp_welcomes(integer,boolean),public.comm_whatsapp_marketing_allowed(uuid),public.comm_whatsapp_phone_allowed(text),public.comm_whatsapp_legacy_event(text,text,timestamptz) from public,anon,authenticated;
grant execute on function public.comm_connect_whatsapp_welcome(uuid),public.comm_dispatch_whatsapp_welcomes(integer,boolean),public.comm_whatsapp_marketing_allowed(uuid),public.comm_whatsapp_phone_allowed(text),public.comm_whatsapp_legacy_event(text,text,timestamptz) to service_role;
-- Reassert the existing opt-out RPC boundary after replacement.
revoke all on function public.comm_phone_opt_out(text,text) from public,anon,authenticated;
grant execute on function public.comm_phone_opt_out(text,text) to service_role;

-- Prepare one independent DRAFT rule only when an existing WhatsApp welcome version exists.
insert into public.communication_rules(name,status,trigger_type,trigger_event_type,timezone,condition_config,action_config,channel_strategy,quiet_hours)
select 'UPPERMOST_WHATSAPP_WELCOME_V1','DRAFT','EVENT','lead.whatsapp.completed','Asia/Kolkata',
 '{"all":[{"field":"whatsapp_marketing_allowed","op":"eq","value":true}]}'::jsonb,
 jsonb_build_object('templates',jsonb_build_object('WHATSAPP',v.id),'variables','{}'::jsonb),'["WHATSAPP"]'::jsonb,'{"start":21,"end":9}'::jsonb
from public.communication_template_versions v join public.communication_templates t on t.id=v.template_id
where t.logical_key='UPPERMOST_WELCOME_V1' and v.channel='WHATSAPP' and v.status='DRAFT'
and not exists(select 1 from public.communication_rules where name='UPPERMOST_WHATSAPP_WELCOME_V1') order by v.version desc limit 1;
