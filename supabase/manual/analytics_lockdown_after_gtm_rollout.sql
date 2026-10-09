-- MANUAL ONLY. Do not place this in automatic migrations.
-- Apply only after /api/analytics/ingest is deployed, GTM is published, and telemetry is verified.
begin;
do $$ declare t text;p record;begin
 foreach t in array array['analytics_visitors','analytics_sessions','analytics_events'] loop
  -- Old permissive policies apply to PUBLIC as well as explicit anon/authenticated roles.
  for p in select policyname from pg_policies where schemaname='public' and tablename=t and policyname<>'operator_read' loop
   execute format('drop policy %I on public.%I',p.policyname,t);
  end loop;
  execute format('revoke all on public.%I from anon,authenticated',t);
  execute format('grant select on public.%I to authenticated',t);
 end loop;
end $$;
commit;
