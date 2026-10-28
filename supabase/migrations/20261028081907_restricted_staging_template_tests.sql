-- Additive, invoker-security wrapper. Legacy queue behavior is unchanged.
create function public.comm_queue_template_test_once(
 p_version_id uuid,p_destination text,p_request_key uuid,p_actor uuid,p_staging_window text default null
) returns uuid language plpgsql security invoker set search_path='' as $$
declare
 v_endpoint text:='communications.template-test:'||p_actor::text;
 v_destination text:=pg_catalog.lower(pg_catalog.btrim(p_destination));
 v_hash text;v_inserted uuid;v_record public.idempotency_records;v_delivery uuid;
begin
 if p_actor is null or p_request_key is null or v_destination is null or length(v_destination)<3 or length(v_destination)>254 then raise exception 'INVALID_TEST_REQUEST';end if;
 if not exists(select 1 from public.admin_memberships where user_id=p_actor and active and role='ADMIN') then raise exception 'TEST_ADMIN_REQUIRED';end if;
 v_hash:=pg_catalog.md5(pg_catalog.jsonb_build_array(p_version_id,v_destination,p_staging_window)::text);
 insert into public.idempotency_records(endpoint,idempotency_key,request_hash)
 values(v_endpoint,p_request_key::text,v_hash) on conflict(endpoint,idempotency_key) do nothing returning id into v_inserted;
 select * into v_record from public.idempotency_records ir where ir.endpoint=v_endpoint and ir.idempotency_key=p_request_key::text for update;
 if v_record.request_hash<>v_hash then raise exception 'TEST_REQUEST_CONFLICT';end if;
 if v_record.status='COMPLETED' and v_record.response_reference_type='COMM_TEMPLATE_TEST' and v_record.response_reference_id is not null then return v_record.response_reference_id;end if;
 if v_inserted is null then raise exception 'TEST_REQUEST_IN_PROGRESS';end if;
 v_delivery:=public.comm_queue_template_test(p_version_id,v_destination);
 update public.customer_messages m set metadata=coalesce(m.metadata,'{}'::jsonb)||pg_catalog.jsonb_build_object(
  'test_actor_id',p_actor,'test_request_key',p_request_key,'staging_test_window',p_staging_window,'test_issued_at',now())
 from public.message_deliveries d where d.id=v_delivery and m.id=d.customer_message_id;
 update public.idempotency_records set status='COMPLETED',response_status=200,response_body=pg_catalog.jsonb_build_object('delivery_id',v_delivery),
  response_reference_type='COMM_TEMPLATE_TEST',response_reference_id=v_delivery,completed_at=now() where id=v_record.id;
 return v_delivery;
end $$;
revoke all on function public.comm_queue_template_test_once(uuid,text,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.comm_queue_template_test_once(uuid,text,uuid,uuid,text) to service_role;
