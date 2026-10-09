create table public.promotion_versions (
 id uuid primary key default gen_random_uuid(),promotion_id uuid not null references public.promotions(id),version integer not null,
 snapshot jsonb not null,changed_by uuid,change_reason text,created_at timestamptz not null default now(),unique(promotion_id,version)
);
alter table public.promotion_versions enable row level security;
revoke all on public.promotion_versions from anon,authenticated;
grant select,insert on public.promotion_versions to service_role;
create function private.guard_promotion_history() returns trigger language plpgsql set search_path='' as $$begin
 raise exception 'IMMUTABLE_PROMOTION_HISTORY';
end $$;
create trigger promotion_history_immutable before update or delete on public.promotion_versions for each row execute function private.guard_promotion_history();

-- Only operator edits advance versions. Commerce usage accounting remains authoritative and independent.
create function public.comm_save_promotion(p_id uuid,p_expected_version integer,p_input jsonb,p_actor uuid,p_reason text) returns public.promotions
language plpgsql set search_path='' as $$
declare current public.promotions;result public.promotions;v integer;begin
 if p_id is not null then
  select * into current from public.promotions where id=p_id for update;
  if not found or current.version<>p_expected_version then raise exception 'PROMOTION_VERSION_CONFLICT';end if;
  insert into public.promotion_versions(promotion_id,version,snapshot,change_reason) values(current.id,current.version,to_jsonb(current),'Baseline before operator edit') on conflict do nothing;
  v:=current.version+1;
  update public.promotions set code=p_input->>'code',label=p_input->>'label',status=p_input->>'status',valid_from=(p_input->>'valid_from')::timestamptz,valid_until=(p_input->>'valid_until')::timestamptz,
   conditions=p_input->'conditions',actions=p_input->'actions',priority=(p_input->>'priority')::integer,stackable=(p_input->>'stackable')::boolean,
   stacking_group=p_input->>'stacking_group',usage_limit=(p_input->>'usage_limit')::integer,version=v,updated_at=now() where id=p_id returning * into result;
 else
  insert into public.promotions(code,label,status,valid_from,valid_until,conditions,actions,priority,stackable,stacking_group,usage_limit,version)
   values(p_input->>'code',p_input->>'label',p_input->>'status',(p_input->>'valid_from')::timestamptz,(p_input->>'valid_until')::timestamptz,p_input->'conditions',p_input->'actions',
    (p_input->>'priority')::integer,(p_input->>'stackable')::boolean,p_input->>'stacking_group',(p_input->>'usage_limit')::integer,1) returning * into result;
 end if;
 insert into public.promotion_versions(promotion_id,version,snapshot,changed_by,change_reason) values(result.id,result.version,to_jsonb(result),p_actor,left(p_reason,500));
 return result;
end $$;
revoke all on function public.comm_save_promotion(uuid,integer,jsonb,uuid,text) from public,anon,authenticated;
grant execute on function public.comm_save_promotion(uuid,integer,jsonb,uuid,text) to service_role;
