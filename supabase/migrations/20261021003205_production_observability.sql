-- Sanitized telemetry only. No customer IDs, raw URLs, payloads, or diagnostic text.
create table public.observability_events (
 event_id text primary key check(length(event_id) between 8 and 100),
 at timestamptz not null,
 received_at timestamptz not null default now(),
 source text not null check(source in ('app','platform')),
 route text not null check(length(route)<=120),
 method text not null check(method in ('GET','POST','PUT','PATCH','DELETE','OPTIONS','HEAD','OTHER')),
 status integer check(status between 100 and 599),
 check(source='platform' or status is not null),
 duration_ms double precision check(duration_ms>=0 and duration_ms<=86400000),
 outcome text not null check(outcome in ('success','redirect','rejected','validation','rate_limit','server_error','exception','business_failure','dependency_failure')),
 release text check(release is null or release ~ '^[a-f0-9]{7,40}$'),
 request_id text check(request_id is null or length(request_id)<=100)
);
create index observability_events_at on public.observability_events(at desc);
create index observability_events_route_at on public.observability_events(route,at desc);
alter table public.observability_events enable row level security;
revoke all on public.observability_events from public,anon,authenticated,service_role;
grant select,insert,delete on public.observability_events to service_role;

create or replace function public.observability_health(p_hours integer default 24,p_route text default null,p_method text default null,p_status text default null,p_release text default null)
returns jsonb language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare result jsonb;
begin
 if p_hours not in (1,24,168,720) or (p_status is not null and p_status not in ('2xx','3xx','4xx','5xx')) then raise exception 'Invalid health filters'; end if;
 with observations as materialized (
  select * from public.observability_events where source='app' and at>=now()-make_interval(hours=>p_hours) and at<=now()
   and (p_route is null or route=p_route) and (p_method is null or method=p_method)
   and (p_status is null or status/100=left(p_status,1)::integer) and (p_release is null or release=p_release)
 ), totals as (select count(*) as total,
count(*) filter(where status between 200 and 299) as s2xx,
count(*) filter(where status between 300 and 399) as s3xx,
count(*) filter(where status between 400 and 499) as s4xx,
count(*) filter(where status>=500) as s5xx,
count(*) filter(where outcome='validation') as validation,
count(*) filter(where outcome='business_failure') as business_failures,
count(*) filter(where duration_ms>=2000) as slow,
percentile_cont(.5) within group(order by duration_ms) as p50,
percentile_cont(.95) within group(order by duration_ms) as p95,
percentile_cont(.99) within group(order by duration_ms) as p99,
max(at) filter(where status>=500 or outcome in ('business_failure','dependency_failure','exception')) as last_failure from observations),
 routes as (select route,method,count(*) as total,
count(*) filter(where status between 200 and 299) as s2xx,
count(*) filter(where status between 300 and 399) as s3xx,
count(*) filter(where status between 400 and 499) as s4xx,
count(*) filter(where status>=500) as s5xx,
count(*) filter(where outcome='validation') as validation,
count(*) filter(where outcome='business_failure') as business_failures,
count(*) filter(where duration_ms>=2000) as slow,
percentile_cont(.5) within group(order by duration_ms) as p50,
percentile_cont(.95) within group(order by duration_ms) as p95,
percentile_cont(.99) within group(order by duration_ms) as p99,
max(at) filter(where status>=500 or outcome in ('business_failure','dependency_failure','exception')) as last_failure from observations group by route,method),
 series as (select date_trunc(case when p_hours=1 then 'minute' else 'hour' end,at) as at,count(*) as total,
count(*) filter(where status between 200 and 299) as s2xx,
count(*) filter(where status between 300 and 399) as s3xx,
count(*) filter(where status between 400 and 499) as s4xx,
count(*) filter(where status>=500) as s5xx,
count(*) filter(where outcome='validation') as validation,
count(*) filter(where outcome='business_failure') as business_failures,
count(*) filter(where duration_ms>=2000) as slow,
percentile_cont(.5) within group(order by duration_ms) as p50,
percentile_cont(.95) within group(order by duration_ms) as p95,
percentile_cont(.99) within group(order by duration_ms) as p99,
max(at) filter(where status>=500 or outcome in ('business_failure','dependency_failure','exception')) as last_failure from observations group by 1),
 platform as (select count(*) filter(where status>=500 or outcome='exception') as platform_failures,count(*) filter(where outcome='exception' and status is null) as platform_crashes,count(*) filter(where route='/api/unknown') as platform_unknown_routes,count(*) filter(where status=405) as platform_unsupported_methods from public.observability_events where source='platform' and at>=now()-make_interval(hours=>p_hours) and at<=now()),
 coverage as (select min(at) filter(where source='app') as first_observed,max(at) filter(where source='app') as last_observed,max(at) filter(where source='platform') as last_platform from public.observability_events where at>=now()-interval '30 days' and at<=now())
 select to_jsonb(totals)||to_jsonb(coverage)||to_jsonb(platform)||jsonb_build_object(
  'routes',coalesce((select jsonb_agg(to_jsonb(routes) order by total desc,route,method) from routes),'[]'::jsonb),
  'series',coalesce((select jsonb_agg(to_jsonb(series) order by at) from series),'[]'::jsonb),
  'releases',coalesce((select jsonb_agg(distinct release) from observations where release is not null),'[]'::jsonb))
 into result from totals cross join coverage cross join platform;
 return result;
end; $$;
revoke all on function public.observability_health(integer,text,text,text,text) from public,anon,authenticated;
grant execute on function public.observability_health(integer,text,text,text,text) to service_role;
