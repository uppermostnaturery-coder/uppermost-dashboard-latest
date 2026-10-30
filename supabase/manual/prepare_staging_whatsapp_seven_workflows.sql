-- LOCAL artifact only. Requires separate authorization to run against staging.
-- Idempotent DRAFT preparation. No provider calls, approvals, activation or scheduling.
do $seven$
declare w text;logical text;v uuid;rule_id uuid;body text;category text;params jsonb;event_type text;
begin
 foreach w in array array['WELCOME','CART_RECOVERY','PAYMENT_FAILED','ORDER_CONFIRMATION','ORDER_SHIPPED','OUT_FOR_DELIVERY','DELIVERY_CONFIRMATION'] loop
  logical:=case when w='WELCOME' then 'UPPERMOST_WELCOME_V1' else 'UPPERMOST_WHATSAPP_'||w||'_V1' end;
  category:=case when w in ('WELCOME','CART_RECOVERY') then 'MARKETING' else 'TRANSACTIONAL' end;
  body:=case w when 'WELCOME' then 'Hello {{1}}, welcome to Uppermost.' when 'CART_RECOVERY' then 'Hello {{1}}, your Uppermost selection is waiting. Reply if you need help.'
   when 'PAYMENT_FAILED' then 'Hello {{1}}, payment for Uppermost order {{2}} could not be completed. No shipment has been initiated for this payment.'
   when 'ORDER_CONFIRMATION' then 'Hello {{1}}, payment for Uppermost order {{2}} is confirmed.'
   when 'ORDER_SHIPPED' then 'Hello {{1}}, Uppermost order {{2}} has shipped.'
   when 'OUT_FOR_DELIVERY' then 'Hello {{1}}, Uppermost order {{2}} is out for delivery.'
   else 'Hello {{1}}, Uppermost order {{2}} has been delivered.' end;
  params:=case when w in ('WELCOME','CART_RECOVERY') then '["name"]'::jsonb else '["name","order_number"]'::jsonb end;
  select cv.id into v from public.communication_template_versions cv join public.communication_templates t on t.id=cv.template_id where t.logical_key=logical and cv.channel='WHATSAPP' and cv.status='DRAFT' order by cv.version desc limit 1;
  if v is null then
   v:=public.comm_create_template_version(jsonb_build_object('logical_key',logical,'name',logical,'channel','WHATSAPP','category',category,'text_content',body,
    'structured_content',jsonb_build_object('components',jsonb_build_array(jsonb_build_object('type','BODY','text',body,'example',jsonb_build_object('body_text',case when w in ('WELCOME','CART_RECOVERY') then '[["Sample Customer"]]'::jsonb else '[["Sample Customer","UM-TEST-001"]]'::jsonb end)))),
    'parameter_schema',jsonb_build_object('required',params,'body_parameters',params),'change_reason','Seven-workflow staging draft; copy and exact Meta approval/language required.'),null);
   update public.communication_template_provider_artifacts set provider_template_name=lower(logical),provider_language='en',sync_mode='PROVIDER_TEMPLATE' where template_version_id=v and provider_status='DRAFT';
  end if;
  event_type:=case w when 'WELCOME' then 'lead.whatsapp.completed' when 'CART_RECOVERY' then null when 'PAYMENT_FAILED' then 'commerce.payment.changed' when 'ORDER_CONFIRMATION' then 'commerce.order.confirmed' else 'commerce.shipment.changed' end;
  select id into rule_id from public.communication_rules where name='UPPERMOST_WHATSAPP_'||w||'_V1' order by created_at,id limit 1;
  if rule_id is null then
   insert into public.communication_rules(name,status,trigger_type,trigger_event_type,cron_expression,condition_config,action_config,channel_strategy,quiet_hours,next_run_at,description)
   values('UPPERMOST_WHATSAPP_'||w||'_V1','DRAFT',case when w='CART_RECOVERY' then 'SCHEDULE' else 'EVENT' end,event_type,case when w='CART_RECOVERY' then '*/15 * * * *' else null end,
    '{"all":[]}',jsonb_build_object('templates',jsonb_build_object('WHATSAPP',v),'variables','{}'::jsonb,'abandoned_cart',w='CART_RECOVERY'),'["WHATSAPP"]','{"start":0,"end":0}',null,'DRAFT ONLY: dedicated authoritative workflow intent; no automatic historical catch-up.');
  else
   update public.communication_rules set condition_config='{"all":[]}',action_config=jsonb_build_object('templates',jsonb_build_object('WHATSAPP',v),'variables','{}'::jsonb,'abandoned_cart',w='CART_RECOVERY'),next_run_at=null
    where id=rule_id and status='DRAFT';
  end if;
 end loop;
end $seven$;
