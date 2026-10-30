-- Additive downstream-only timing support. No rules are activated or backfilled.
alter table public.communication_customer_features add column last_checkout_started_at timestamptz;

CREATE OR REPLACE FUNCTION private.communication_predicate(c jsonb, depth integer DEFAULT 0)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
declare k text; f text; op text; v jsonb; result text; operator text; typ text; begin
 if depth>5 or octet_length(c::text)>8192 then raise exception 'RULE_COMPLEXITY_LIMIT';end if;
 foreach k in array array['all','any','none'] loop
  if c ? k then
   if jsonb_array_length(c->k)>20 then raise exception 'RULE_COMPLEXITY_LIMIT';end if;
   select string_agg('('||private.communication_predicate(value,depth+1)||')',case when k='all' then ' AND ' else ' OR ' end) into result from jsonb_array_elements(c->k);
   result:=coalesce(result,case when k='all' then 'TRUE' else 'FALSE' end);
   return case when k='none' then 'NOT ('||result||')' else result end;
  end if;
 end loop;
 f:=c->>'field';op:=c->>'op';v:=c->'value';
 if f = any(array['order_count','realized_spend_paise','average_order_value_paise','last_order_total_paise','active_subscription_count','discount_order_ratio','cart_value_paise']) then typ:='numeric';
 elsif f = any(array['last_order_at','first_order_at','next_subscription_charge_at','last_seen_at','last_cart_activity_at','last_checkout_started_at','last_shipment_at']) then typ:='timestamptz';
 elsif f = any(array['cart_checkout_started','cart_converted','email_marketing_allowed','whatsapp_marketing_allowed','sms_marketing_allowed']) then typ:='boolean';
 elsif f = any(array['subscription_status','last_payment_status','last_shipment_status','last_product_view']) then typ:='text';
 elsif f = any(array['ordered_product_codes','ordered_skus']) then typ:='text[]';
 else raise exception 'INVALID_RULE_FIELD';end if;
 if op='exists' then return format('%I IS %sNULL',f,case when v='false'::jsonb then '' else 'NOT ' end);end if;
 if op in ('days_since_gte','days_since_lte') and typ='timestamptz' then
  return format('%I %s (now() - make_interval(days => %s))',f,case when op='days_since_gte' then '<=' else '>=' end,greatest(0,least(3650,(v#>>'{}')::integer)));
 end if;
 if op in ('hours_since_gte','hours_since_lte') and typ='timestamptz' then
  if jsonb_typeof(v)<>'number' or (v#>>'{}')::numeric<0 or (v#>>'{}')::numeric>87600 or trunc((v#>>'{}')::numeric)<>(v#>>'{}')::numeric then raise exception 'INVALID_RULE_VALUE';end if;
  return format('%I %s (now() - make_interval(hours => %s))',f,case when op='hours_since_gte' then '<=' else '>=' end,(v#>>'{}')::integer);
 end if;
 if op='contains' and typ='text[]' then return format('%I @> ARRAY[%L]::text[]',f,v#>>'{}');end if;
 if op in ('in','not_in') then
  if jsonb_array_length(v)>20 then raise exception 'RULE_COMPLEXITY_LIMIT';end if;
  select string_agg(format('%L::%s',value,typ),',') into result from jsonb_array_elements_text(v);
  return format('%I %s (%s)',f,case when op='in' then 'IN' else 'NOT IN' end,coalesce(result,'NULL'));
 end if;
 operator:=case op when 'eq' then '=' when 'neq' then '<>' when 'gt' then '>' when 'gte' then '>=' when 'lt' then '<' when 'lte' then '<=' when 'before' then '<' when 'after' then '>' else null end;
 if operator is null or typ='text[]' then raise exception 'INVALID_RULE_OPERATOR';end if;
 return format('%I %s %L::%s',f,operator,v#>>'{}',typ);
end $function$
;

CREATE OR REPLACE FUNCTION private.project_communication_behavior()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$ begin
 if new.customer_id is null then return new; end if;
 insert into public.communication_customer_features(customer_id,last_seen_at,last_product_view,last_cart_activity_at,cart_value_paise,cart_checkout_started,last_checkout_started_at)
 values(new.customer_id,new.last_seen_at,new.last_product_view,new.recent_add_to_cart_at,new.cart_value_paise,new.last_checkout_started_at is not null,new.last_checkout_started_at)
 on conflict(customer_id) do update set last_seen_at=greatest(public.communication_customer_features.last_seen_at,excluded.last_seen_at),
 last_product_view=case when excluded.last_seen_at>=coalesce(public.communication_customer_features.last_seen_at,'epoch') then excluded.last_product_view else public.communication_customer_features.last_product_view end,
 last_cart_activity_at=greatest(public.communication_customer_features.last_cart_activity_at,excluded.last_cart_activity_at),
 cart_value_paise=case when excluded.last_cart_activity_at>=coalesce(public.communication_customer_features.last_cart_activity_at,'epoch') then excluded.cart_value_paise else public.communication_customer_features.cart_value_paise end,
 last_checkout_started_at=greatest(public.communication_customer_features.last_checkout_started_at,excluded.last_checkout_started_at),
 cart_checkout_started=excluded.cart_checkout_started,
 cart_converted=case when excluded.last_cart_activity_at>coalesce(public.communication_customer_features.last_order_at,'epoch') then false else public.communication_customer_features.cart_converted end,updated_at=now();
 return new;
exception when others then raise warning 'behavior_projection_failed sqlstate=%',sqlstate; return new;
end $function$
;
