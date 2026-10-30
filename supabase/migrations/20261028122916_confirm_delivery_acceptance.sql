-- Preserve the existing RPC signature and invoker permissions.
create or replace function public.comm_accept_delivery(p_id uuid,p_provider_id text,p_latency integer)
returns void language plpgsql security invoker set search_path='' as $$
declare provider_name text; d public.message_deliveries; e record; changed integer;
begin
 if p_provider_id is null or length(btrim(p_provider_id))=0 then
  raise exception 'INVALID_PROVIDER_MESSAGE_ID';
 end if;
 select provider into provider_name from public.message_deliveries where id=p_id;
 if not found then raise exception 'DELIVERY_NOT_FOUND';end if;
 -- Same advisory-lock-before-row-lock order as comm_provider_event.
 perform pg_advisory_xact_lock(hashtextextended(provider_name||':'||p_provider_id,631));
 select * into d from public.message_deliveries where id=p_id for update;
 if not found then raise exception 'DELIVERY_NOT_FOUND';end if;
 if d.provider_message_id is not null and d.provider_message_id<>p_provider_id then
  raise exception 'DELIVERY_PROVIDER_ID_CONFLICT';
 end if;
 if d.provider_message_id=p_provider_id and d.sent_at is not null then
  -- An identical replay must not regress callback state or replace the original timestamp.
  null;
 else
  if d.status<>'SENDING' and not(d.status='RECONCILIATION_PENDING' and d.suppression_reason is not distinct from 'EXPIRED_SEND_RESERVATION') then
   raise exception 'DELIVERY_ACCEPTANCE_STATE_CONFLICT';
  end if;
  update public.message_deliveries
  set status='ACCEPTED',provider_message_id=p_provider_id,sent_at=now(),lease_until=null,
      latency_ms=greatest(coalesce(p_latency,0),0),suppression_reason=null,next_attempt_at=null,updated_at=now()
  where id=p_id and status=d.status and provider_message_id is not distinct from d.provider_message_id;
  get diagnostics changed=row_count;
  if changed<>1 then raise exception 'DELIVERY_ACCEPTANCE_NOT_PERSISTED';end if;
 end if;
 for e in select * from public.communication_provider_events
  where provider=provider_name and payload->>'message_id'=p_provider_id and applied_at is null
  order by created_at limit 50 loop
  perform public.comm_provider_event(e.provider,e.event_id,p_provider_id,e.payload->>'status',
   (e.payload->>'at')::timestamptz,null,e.payload->>'campaign_id',e.payload->>'step_id');
 end loop;
end $$;
revoke all on function public.comm_accept_delivery(uuid,text,integer) from public,anon,authenticated;
grant execute on function public.comm_accept_delivery(uuid,text,integer) to service_role;
