-- Additive prerequisite. Anonymous analytics lockdown is deliberately a separate manual rollout step.
create table public.admin_memberships (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('ADMIN','VIEWER')),
  active boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
alter table public.admin_memberships enable row level security;
revoke all on public.admin_memberships from anon, authenticated;
grant all on public.admin_memberships to service_role;

create or replace function public.is_uppermost_operator() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.admin_memberships where user_id = auth.uid() and active);
$$;
revoke all on function public.is_uppermost_operator() from public, anon;
grant execute on function public.is_uppermost_operator() to authenticated;

-- Existing dashboard subscriptions retain admin-scoped reads. No browser role can write business state.
do $$ declare t text; begin
  foreach t in array array['analytics_visitors','analytics_sessions','analytics_events'] loop
    if to_regclass('public.' || t) is not null then
      execute format('grant select on public.%I to authenticated', t);
      execute format('create policy operator_read on public.%I for select to authenticated using (public.is_uppermost_operator())', t);
    end if;
  end loop;
end $$;

create table public.analytics_identity_links (
  id uuid primary key default gen_random_uuid(), visitor_id text not null,
  customer_id uuid not null references public.customers(id), lead_id uuid,
  identified_session_id text, source text not null check(source in ('CHECKOUT','OTP_LOGIN','AUTH','LEAD_CONVERSION')),
  confidence text not null default 'IDENTIFIED' check(confidence in ('IDENTIFIED','VERIFIED')),
  source_reference_id uuid, linked_at timestamptz not null default now(), last_seen_at timestamptz not null default now(),
  valid_from timestamptz not null default now(), valid_until timestamptz, is_current boolean not null default true,
  metadata jsonb not null default '{}', created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index identity_current_visitor_idx on public.analytics_identity_links(visitor_id) where is_current;
create index identity_customer_idx on public.analytics_identity_links(customer_id, linked_at);
create index identity_session_idx on public.analytics_identity_links(identified_session_id) where identified_session_id is not null;
alter table public.analytics_identity_links enable row level security;
revoke all on public.analytics_identity_links from anon, authenticated;
grant all on public.analytics_identity_links to service_role;

create table public.communication_behavior_features (
  visitor_id text primary key, customer_id uuid references public.customers(id),
  last_seen_at timestamptz, last_session_id text, last_product_view text,
  recent_product_views jsonb not null default '[]', recent_add_to_cart_at timestamptz,
  last_checkout_started_at timestamptz, last_purchase_at timestamptz,
  cart_value_paise bigint not null default 0, friction_score integer not null default 0,
  rage_click_count_recent integer not null default 0, dead_click_count_recent integer not null default 0,
  updated_at timestamptz not null default now()
);
alter table public.communication_behavior_features enable row level security;
revoke all on public.communication_behavior_features from anon, authenticated;
grant all on public.communication_behavior_features to service_role;

-- Serialize only one browser's mapping; preserve shared-device history without commerce locks.
create function public.link_analytics_identity(p_visitor_id text, p_session_id text, p_customer_id uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare current_link public.analytics_identity_links; result uuid; stamp timestamptz := clock_timestamp(); begin
  if p_visitor_id !~ '^v_([0-9a-fA-F-]{36}|id-[0-9]{13}-[a-zA-Z0-9]{1,20})$' then raise exception 'invalid visitor'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_visitor_id, 847));
  select * into current_link from public.analytics_identity_links where visitor_id=p_visitor_id and is_current;
  if current_link.customer_id = p_customer_id then
    update public.analytics_identity_links set last_seen_at=stamp, updated_at=stamp,
      identified_session_id=coalesce(p_session_id, identified_session_id) where id=current_link.id returning id into result;
  else
    -- A shared browser's old facts belong to the closed identity interval, never its next customer.
    if current_link.customer_id is not null then
      update public.communication_behavior_features set customer_id=null,last_product_view=null,recent_product_views='[]',
        recent_add_to_cart_at=null,last_checkout_started_at=null,last_purchase_at=null,cart_value_paise=0,
        friction_score=0,rage_click_count_recent=0,dead_click_count_recent=0 where visitor_id=p_visitor_id;
    end if;
    update public.analytics_identity_links set is_current=false, valid_until=stamp, updated_at=stamp
      where visitor_id=p_visitor_id and is_current;
    insert into public.analytics_identity_links(visitor_id,customer_id,identified_session_id,source,valid_from)
      values(p_visitor_id,p_customer_id,p_session_id,'CHECKOUT',stamp) returning id into result;
  end if;
  insert into public.communication_behavior_features(visitor_id,customer_id,last_session_id)
    values(p_visitor_id,p_customer_id,p_session_id) on conflict(visitor_id) do update set customer_id=excluded.customer_id,last_session_id=excluded.last_session_id;
  return result;
end $$;
revoke all on function public.link_analytics_identity(text,text,uuid) from public, anon, authenticated;
grant execute on function public.link_analytics_identity(text,text,uuid) to service_role;

alter table public.analytics_events add column if not exists client_event_id uuid;
-- New nullable column means existing rows cannot collide. It does not index the historical payload.
create unique index analytics_client_event_idx on public.analytics_events(client_event_id) where client_event_id is not null;
-- Journey lookups are bounded by visitor and timestamp, never rule-engine scans.
create index if not exists analytics_event_visitor_time_idx on public.analytics_events(visitor_id,created_at desc);

create function public.ingest_analytics_batch(p_batch jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare e jsonb; event_at timestamptz; v text:=p_batch->>'visitorId'; s text:=p_batch->>'sessionId'; inserted integer; identity_start timestamptz;t text; begin
  perform pg_advisory_xact_lock(hashtextextended(v,847));
  select valid_from into identity_start from public.analytics_identity_links where visitor_id=v and is_current;
  if jsonb_array_length(p_batch->'events') > 50 or octet_length(p_batch::text)>32768 then raise exception 'batch bound'; end if;
  insert into public.analytics_visitors(visitor_id,current_session_id,last_seen_at,device_type,browser,os,time_zone,is_online)
    values(v,s,now(),p_batch->>'device_type',p_batch->>'browser',p_batch->>'os',p_batch->>'timezone',coalesce((p_batch->>'is_online')::boolean,true)) on conflict(visitor_id) do update set current_session_id=excluded.current_session_id,last_seen_at=greatest(public.analytics_visitors.last_seen_at,excluded.last_seen_at),is_online=excluded.is_online,
    device_type=coalesce(excluded.device_type,public.analytics_visitors.device_type),browser=coalesce(excluded.browser,public.analytics_visitors.browser),os=coalesce(excluded.os,public.analytics_visitors.os),time_zone=coalesce(excluded.time_zone,public.analytics_visitors.time_zone);
  insert into public.analytics_sessions(session_id,visitor_id,last_seen_at,device_type,browser,os,time_zone,is_active,is_online)
    values(s,v,now(),p_batch->>'device_type',p_batch->>'browser',p_batch->>'os',p_batch->>'timezone',coalesce((p_batch->>'is_online')::boolean,true),coalesce((p_batch->>'is_online')::boolean,true)) on conflict(session_id) do update set last_seen_at=greatest(public.analytics_sessions.last_seen_at,excluded.last_seen_at),is_online=excluded.is_online,is_active=excluded.is_active,
    device_type=coalesce(excluded.device_type,public.analytics_sessions.device_type),browser=coalesce(excluded.browser,public.analytics_sessions.browser),os=coalesce(excluded.os,public.analytics_sessions.os),time_zone=coalesce(excluded.time_zone,public.analytics_sessions.time_zone)
    where public.analytics_sessions.visitor_id=excluded.visitor_id;
  get diagnostics inserted=row_count;if inserted=0 then raise exception 'SESSION_VISITOR_CONFLICT';end if;
  foreach t in array array['analytics_visitors','analytics_sessions'] loop
    execute format('update public.%I set country=coalesce($3->>''country'',country),city=coalesce($3->>''city'',city),region=coalesce($3->>''region'',region),ip_timezone=coalesce($3->>''ip_timezone'',ip_timezone),referrer=coalesce($3->>''referrer'',referrer),utm_source=coalesce($3->>''utm_source'',utm_source),utm_medium=coalesce($3->>''utm_medium'',utm_medium),utm_campaign=coalesce($3->>''utm_campaign'',utm_campaign) where visitor_id=$1 %s',t,case when t='analytics_sessions' then 'and session_id=$2' else '' end) using v,s,p_batch;
  end loop;
  update public.analytics_sessions set source=coalesce(p_batch->>'utm_source',source),medium=coalesce(p_batch->>'utm_medium',medium),campaign=coalesce(p_batch->>'utm_campaign',campaign) where visitor_id=v and session_id=s;
  insert into public.communication_behavior_features(visitor_id,last_session_id,last_seen_at)
    values(v,s,now()) on conflict(visitor_id) do update set last_seen_at=greatest(public.communication_behavior_features.last_seen_at,excluded.last_seen_at),last_session_id=excluded.last_session_id,updated_at=now();
  for e in select value from jsonb_array_elements(p_batch->'events') loop
    event_at := (e->>'created_at')::timestamptz;
    insert into public.analytics_events(visitor_id,session_id,event_name,metadata,created_at,page_url,page_path,page_title,client_event_id,device_type,time_zone,country,city,region,ip_timezone)
      values(v,s,e->>'event_name',coalesce(e->'metadata','{}'),event_at,e->>'page_url',e->>'page_path',e->>'page_title',(e->>'client_event_id')::uuid,p_batch->>'device_type',p_batch->>'timezone',p_batch->>'country',p_batch->>'city',p_batch->>'region',p_batch->>'ip_timezone')
      on conflict(client_event_id) where client_event_id is not null do nothing;
    get diagnostics inserted = row_count;
    if inserted=0 then continue; end if;
    -- Delayed telemetry remains historical but cannot cross a shared-device identity boundary.
    if identity_start is not null and event_at<identity_start then continue;end if;
    update public.communication_behavior_features set
      last_product_view=case when e->>'event_name' in ('product_view','view_item') and (last_seen_at is null or event_at>=last_seen_at-interval '1 minute') then coalesce(e->'metadata'->>'product_code',e->>'page_path',last_product_view) else last_product_view end,
      recent_add_to_cart_at=case when e->>'event_name' in ('add_to_cart','cart_updated') then greatest(recent_add_to_cart_at,event_at) else recent_add_to_cart_at end,
      last_checkout_started_at=case when e->>'event_name' in ('checkout_started','begin_checkout') then greatest(last_checkout_started_at,event_at) else last_checkout_started_at end,
      last_purchase_at=case when e->>'event_name'='purchase' then greatest(last_purchase_at,event_at) else last_purchase_at end,
      cart_value_paise=case when e->>'event_name' in ('add_to_cart','cart_updated') and event_at >= coalesce(recent_add_to_cart_at,'epoch') then greatest(0,least(100000000,coalesce((e->'metadata'->>'cart_value_paise')::bigint,cart_value_paise))) else cart_value_paise end,
      updated_at=now() where visitor_id=v;
  end loop;
end $$;
revoke all on function public.ingest_analytics_batch(jsonb) from public, anon, authenticated;
grant execute on function public.ingest_analytics_batch(jsonb) to service_role;
