import {PGlite} from '@electric-sql/pglite';
import {readFileSync,readdirSync} from 'node:fs';
import {beforeAll,afterAll,describe,it,expect,vi} from 'vitest';
let db:PGlite;let sequence=0;
vi.mock('../../lib/supabaseAdmin',()=>({supabaseAdmin:{rpc:async(name:string,args:{p_payload:unknown})=>{
 if(name!=='comm_ingest_shipment_event')throw new Error('UNEXPECTED_RPC');
 try{return {data:(await db.query<{result:unknown}>('select comm_ingest_shipment_event($1) result',[JSON.stringify(args.p_payload)])).rows[0].result,error:null};}catch{return {data:null,error:{message:'fixture failure'}};}
}}}));
const one=async(sql:string,params:unknown[]=[]) => (await db.query<Record<string,any>>(sql,params)).rows[0];
beforeAll(async()=>{
 vi.stubGlobal('fetch',vi.fn(()=>{throw new Error('REAL_NETWORK_FORBIDDEN');}));
 db=new PGlite();
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql as $$select null::uuid$$;
 create table analytics_visitors(visitor_id text primary key,current_session_id text,last_seen_at timestamptz default now(),is_online boolean default true,device_type text,browser text,os text,time_zone text,country text,city text,region text,ip_timezone text,referrer text,utm_source text,utm_medium text,utm_campaign text);
 create table analytics_sessions(session_id text primary key,visitor_id text,last_seen_at timestamptz default now(),is_online boolean default true,is_active boolean default true,device_type text,browser text,os text,time_zone text,country text,city text,region text,ip_timezone text,referrer text,utm_source text,utm_medium text,utm_campaign text,source text,medium text,campaign text);
 create table analytics_events(id bigint generated always as identity primary key,visitor_id text,session_id text,event_name text,metadata jsonb,created_at timestamptz,page_url text,page_path text,page_title text,device_type text,time_zone text,country text,city text,region text,ip_timezone text);
 create table um_leads(id uuid primary key default gen_random_uuid(),email text not null,phone text,first_name text,last_name text,status text default 'new',consent_email boolean default false,consent_whatsapp boolean default false,consent_recorded_at timestamptz,metadata jsonb default '{}');
 create table whatsapp_messages(id uuid primary key default gen_random_uuid(),lead_id uuid,email text,phone text,template_name text,template_language text,status text,meta_message_id text,created_at timestamptz default now(),sent_at timestamptz,delivered_at timestamptz,read_at timestamptz,failed_at timestamptz);
 grant select,update on um_leads to service_role;`);
 for(const f of readdirSync('supabase/migrations').filter(f=>f.endsWith('.sql')).sort())await db.exec(readFileSync('supabase/migrations/'+f,'utf8').replace(/create extension if not exists pgcrypto;/gi,''));
},60000);
afterAll(async()=>{await db?.close();vi.unstubAllGlobals();});
async function customer(){const n=++sequence;const c=await one("insert into customers(name,normalized_email,normalized_phone,phone) values('Fixture',$1,$2,$2) returning id",[`wf${n}@example.test`,`+9192000${String(n).padStart(5,'0')}`]);await db.query("insert into communication_preferences(customer_id,channel,purpose,allowed,source) values($1,'WHATSAPP','MARKETING',true,'TEST')",[c.id]);return c.id as string;}
async function order(c:string,paid=true){return (await one("insert into orders(customer_id,status,subtotal_paise,total_paise,address_snapshot,pricing_snapshot,paid_at) values($1,$2,10000,10000,'{}','{}',case when $3 then now() else null end) returning id",[c,paid?'CONFIRMED':'PAYMENT_PENDING',paid])).id as string;}
// A verified payment fixture has the same exact provider evidence persisted by reconciliation.
async function payment(o:string,status='CAPTURED',valid=true){
 const n=++sequence,owner=await one('select customer_id,checkout_session_id from orders where id=$1',[o]);let session=owner.checkout_session_id;
 if(!session){
  const quote=await one("insert into commerce_quotes(public_id,token_hash,customer_id,cart_fingerprint,items,price_snapshot,pricing_version,promotion_version,valid_until) values($1,'fixture',$2,'fixture','[]','{}','1','1',now()+interval '1 hour') returning id",[`quote${n}`,owner.customer_id]);
  const address=await one("insert into customer_addresses(customer_id,name,phone,line1,city,state,postal_code) values($1,'Fixture','9000000000','Fixture','Fixture','Fixture','110001') returning id",[owner.customer_id]);
  session=(await one("insert into checkout_sessions(quote_id,customer_id,address_id,guest_session_id,payment_kind,purchase_shape,amount_paise,address_snapshot,pricing_snapshot,order_id) values($1,$2,$3,'fixture','ONE_TIME','BUY_ONCE',10000,'{}','{}',$4) returning id",[quote.id,owner.customer_id,address.id,o])).id;
  await db.query('update orders set checkout_session_id=$1 where id=$2',[session,o]);
 }
 return (await one("insert into payment_attempts(order_id,checkout_session_id,kind,status,amount_paise,provider_order_id,provider_payment_id,raw_metadata) values($1,$2,'ONE_TIME',$3,10000,$4,$5,$6) returning id",[o,session,status,`order_wf${n}`,`pay_wf${n}`,JSON.stringify({id:`pay_wf${n}`,order_id:`order_wf${n}`,status:status.toLowerCase(),amount:valid?10000:999,currency:'INR'})])).id as string;
}
async function event(type:string,c:string,subject:string,payload:Record<string,unknown>){return (await one("insert into integration_outbox(provider,operation,aggregate_id,idempotency_key,event_type,customer_id,payload) values('COMMUNICATIONS','EVENT',$1,$2,$3,$4,$5) returning id",[subject,`fixture:${++sequence}`,type,c,JSON.stringify({...payload,at:new Date().toISOString()})])).id as string;}
async function capture(){await db.query('select comm_capture_whatsapp_workflows(50)');}
const intent=async(w:string,s:string)=>one('select * from communication_whatsapp_workflow_intents where workflow=$1 and subject_id=$2',[w,s]);
async function enable(w:string){await db.query("update communication_rules set status='ACTIVE',approved_at=now()-interval '1 day',valid_from=now()-interval '1 day' where name=$1",[`UPPERMOST_WHATSAPP_${w}_V1`]);}

describe('seven WhatsApp workflows on the canonical engine',()=>{
 it('ingests one authenticated synthetic shipment for a known local order without any provider call',async()=>{
  vi.stubEnv('VERCEL_ENV','preview');vi.stubEnv('VERCEL_GIT_COMMIT_REF','staging');vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL','https://jwsivyxapfnyaafdcdos.supabase.co');vi.stubEnv('COMMUNICATION_BASE_URL','https://staging.uppermost.store');vi.stubEnv('COMMUNICATION_DRY_RUN','true');vi.stubEnv('SHIPROCKET_WEBHOOK_SECRET','synthetic-local-only');vi.stubEnv('SHIPROCKET_PICKUP_POSTCODE','110001');
  try{
   await db.exec(readFileSync('supabase/manual/prepare_staging_whatsapp_seven_workflows.sql','utf8'));
   const c=await customer(),o=await order(c);await payment(o);
   const sid=`synthetic-local-${++sequence}`,s=await one('insert into shipments(order_id,provider_shipment_id) values($1,$2) returning id',[o,sid]);
   const {POST}=await import('../../app/api/webhooks/shiprocket/route');
   const request=(secret:string)=>new Request('https://staging.uppermost.store/api/webhooks/carrier-events',{method:'POST',headers:{'x-api-key':secret},body:JSON.stringify({shipment_id:sid,event_id:sid+'-shipped',current_status:'shipped'})});
   expect((await POST(request('wrong'))).status).toBe(401);
   expect((await db.query('select id from tracking_events where shipment_id=$1',[s.id])).rows).toHaveLength(0);
   expect((await POST(request('synthetic-local-only'))).status).toBe(200);
   expect((await (await POST(request('synthetic-local-only'))).json()).duplicate).toBe(true);
   await capture();expect(await intent('ORDER_SHIPPED',s.id)).toMatchObject({order_id:o,status:'BLOCKED_DRAFT'});
   expect((await db.query('select id from tracking_events where shipment_id=$1',[s.id])).rows).toHaveLength(1);expect(fetch).not.toHaveBeenCalled();
  }finally{vi.unstubAllEnvs();}
 },15000);
 it('prepares seven distinct drafts idempotently without approval or provider calls',async()=>{
  const sql=readFileSync('supabase/manual/prepare_staging_whatsapp_seven_workflows.sql','utf8');await db.exec(sql);await db.exec(sql);
  const rows=(await db.query("select status,next_run_at from communication_rules where name=any($1)",[['WELCOME','CART_RECOVERY','PAYMENT_FAILED','ORDER_CONFIRMATION','ORDER_SHIPPED','OUT_FOR_DELIVERY','DELIVERY_CONFIRMATION'].map(w=>`UPPERMOST_WHATSAPP_${w}_V1`)])).rows;
  expect(rows).toHaveLength(7);expect(rows.every((r:any)=>r.status==='DRAFT'&&r.next_run_at===null)).toBe(true);expect(fetch).not.toHaveBeenCalled();
 });
 it('records but never releases a DRAFT-time order intent after activation',async()=>{
  const c=await customer(),o=await order(c);await payment(o);await event('commerce.order.confirmed',c,o,{order_id:o});await capture();expect((await intent('ORDER_CONFIRMATION',o)).status).toBe('BLOCKED_DRAFT');await enable('ORDER_CONFIRMATION');await db.query('select comm_dispatch_whatsapp_workflows(50,true)');expect((await intent('ORDER_CONFIRMATION',o)).run_id).toBeNull();
 });
 it('deduplicates verified confirmation across duplicate source events and rule versions',async()=>{
  const c=await customer(),o=await order(c);await payment(o);await enable('ORDER_CONFIRMATION');await event('commerce.order.confirmed',c,o,{order_id:o});await event('commerce.order.confirmed',c,o,{order_id:o});await Promise.all([capture(),capture()]);expect((await intent('ORDER_CONFIRMATION',o)).status).toBe('PENDING');expect((await one("select count(*)::int n from communication_whatsapp_workflow_intents where subject_id=$1",[o])).n).toBe(1);
 });
 it('rejects a confirmed order without captured evidence and cross-customer facts',async()=>{
  const c=await customer(),other=await customer(),o=await order(c);await event('commerce.order.confirmed',c,o,{order_id:o});await capture();expect(await intent('ORDER_CONFIRMATION',o)).toBeUndefined();await payment(o);await event('commerce.order.confirmed',other,o,{order_id:o});await capture();
  // Source recovery may now create the legitimate owner's intent; the forged
  // event cannot redirect that intent to another customer or become its source.
  expect(await intent('ORDER_CONFIRMATION',o)).toMatchObject({customer_id:c,source_outbox_id:null});expect((await db.query('select id from communication_whatsapp_workflow_intents where customer_id=$1',[other])).rows).toHaveLength(0);
 });
 it('rejects mismatched provider amount and unverified failed payment',async()=>{
  const c=await customer(),o=await order(c,false),p=await payment(o,'FAILED',false);await event('commerce.payment.changed',c,p,{order_id:o,payment_id:p,status:'FAILED'});await capture();expect(await intent('PAYMENT_FAILED',p)).toBeUndefined();
 });
 it('creates one failed-payment intent and cancels it when a later settlement succeeds',async()=>{
  await enable('PAYMENT_FAILED');const c=await customer(),o=await order(c,false),p=await payment(o,'FAILED');await event('commerce.payment.changed',c,p,{order_id:o,payment_id:p,status:'FAILED'});await capture();const i=await intent('PAYMENT_FAILED',p);expect(i.status).toBe('PENDING');await payment(o);await db.query("update orders set status='CONFIRMED',paid_at=now() where id=$1",[o]);expect((await one('select comm_whatsapp_workflow_permission($1) reason',[i.id])).reason).toBe('PAYMENT_OBSOLETE');await db.query('select comm_dispatch_whatsapp_workflows(50,true)');expect((await intent('PAYMENT_FAILED',p)).status).toBe('SUPPRESSED');
 });
 it.each([['shipped','ORDER_SHIPPED'],['out for delivery','OUT_FOR_DELIVERY'],['delivered','DELIVERY_CONFIRMATION']])('captures authenticated %s once',async(status,w)=>{
  await enable(w);const c=await customer(),o=await order(c);await payment(o);const s=await one("insert into shipments(order_id,provider_shipment_id,awb_code) values($1,$2,$3) returning id",[o,`sr${++sequence}`,`awb${sequence}`]);const data={shipment_id:`sr${sequence}`,awb:`awb${sequence}`,event_id:`evt${sequence}`,current_status:status};await db.query('select comm_ingest_shipment_event($1)',[JSON.stringify(data)]);await db.query('select comm_ingest_shipment_event($1)',[JSON.stringify(data)]);await capture();expect((await intent(w,s.id)).status).toBe('PENDING');expect((await one('select count(*)::int n from tracking_events where shipment_id=$1',[s.id])).n).toBe(1);
 });
 it('does not turn undelivered/RTO/unknown statuses into customer delivery',async()=>{
  const c=await customer(),o=await order(c);await payment(o);const s=await one("insert into shipments(order_id,provider_shipment_id) values($1,$2) returning id",[o,`sr${++sequence}`]);const sr=`sr${sequence}`;
  for(const [n,status] of ['undelivered','RTO Delivered','delivered','out for delivery','shipped'].entries())await db.query('select comm_ingest_shipment_event($1)',[JSON.stringify({shipment_id:sr,event_id:`${sr}-${n}`,current_status:status})]);
  expect((await one('select status from shipments where id=$1',[s.id])).status).toBe('RTO DELIVERED');await capture();expect(await intent('ORDER_SHIPPED',s.id)).toBeUndefined();expect(await intent('OUT_FOR_DELIVERY',s.id)).toBeUndefined();expect(await intent('DELIVERY_CONFIRMATION',s.id)).toBeUndefined();
 });
 it('rejects conflicting shipment identifiers and unproven shipment updates',async()=>{
  const c=await customer(),o=await order(c);await payment(o);const s=await one("insert into shipments(order_id,provider_shipment_id,awb_code,status) values($1,$2,'owned-awb','DELIVERED') returning id",[o,`sr${++sequence}`]);await expect(db.query('select comm_ingest_shipment_event($1)',[JSON.stringify({shipment_id:`sr${sequence}`,awb:'different',current_status:'delivered',event_id:'conflict'})])).rejects.toThrow('SHIPMENT_IDENTITY_CONFLICT');await event('commerce.shipment.changed',c,s.id,{shipment_id:s.id,order_id:o,status:'DELIVERED'});await capture();expect(await intent('DELIVERY_CONFIRMATION',s.id)).toBeUndefined();
 });
 it('creates one recovery per server cart episode and cancels it on withdrawal/purchase',async()=>{
  await enable('CART_RECOVERY');const c=await customer();const cart=await one("insert into carts(customer_id,updated_at) values($1,now()-interval '2 hours') returning id",[c]);
  // Use the existing catalog fixture rather than accepting client prices.
  const variant=await one('select id from product_variants limit 1');await db.query("insert into cart_items(cart_id,line_id,product_variant_id,quantity,purchase_mode) values($1,'line',$2,1,'BUY_ONCE')",[cart.id,variant.id]);
  await capture();await capture();const i=await intent('CART_RECOVERY',cart.id);expect(i.status).toBe('PENDING');expect((await one('select count(*)::int n from communication_whatsapp_workflow_intents where subject_id=$1',[cart.id])).n).toBe(1);
  await db.query("update communication_preferences set allowed=false where customer_id=$1 and channel='WHATSAPP'",[c]);expect((await one('select comm_whatsapp_workflow_permission($1) reason',[i.id])).reason).toBe('CONSENT_REQUIRED');await db.query('select comm_dispatch_whatsapp_workflows(50,true)');expect((await intent('CART_RECOVERY',cart.id)).status).toBe('SUPPRESSED');
 });
 it('honors STOP for cart recovery and explicit transactional withdrawal',async()=>{
  const c=await customer(),o=await order(c);await payment(o);await event('commerce.order.confirmed',c,o,{order_id:o});await capture();const i=await intent('ORDER_CONFIRMATION',o);await db.query("insert into communication_preferences(customer_id,channel,purpose,allowed,source) values($1,'WHATSAPP','TRANSACTIONAL',false,'TEST')",[c]);expect((await one('select comm_whatsapp_workflow_permission($1) reason',[i.id])).reason).toBe('CONSENT_REQUIRED');
 });
 it('restricts intent data and shipment RPCs to server roles',async()=>{
  expect((await one("select has_table_privilege('anon','communication_whatsapp_workflow_intents','select') a,has_function_privilege('authenticated','comm_ingest_shipment_event(jsonb)','execute') b")).a).toBe(false);expect((await one("select has_function_privilege('authenticated','comm_ingest_shipment_event(jsonb)','execute') b")).b).toBe(false);
 });
 it.each(['CART_RECOVERY','PAYMENT_FAILED','ORDER_CONFIRMATION','ORDER_SHIPPED','OUT_FOR_DELIVERY','DELIVERY_CONFIRMATION'])('queues exactly one canonical %s delivery after fixture-only approval',async(w)=>{
  await enable(w);
  const version=await one("select (action_config->'templates'->>'WHATSAPP')::uuid id from communication_rules where name=$1",[`UPPERMOST_WHATSAPP_${w}_V1`]);
  await db.query("update communication_template_provider_artifacts set provider_status='APPROVED' where template_version_id=$1",[version.id]);await db.query('select comm_activate_template($1)',[version.id]);
  const c=await customer();let subject:string;
  if(w==='CART_RECOVERY'){
   subject=(await one("insert into carts(customer_id,updated_at) values($1,now()-interval '2 hours') returning id",[c])).id;
   const v=await one('select id from product_variants limit 1');await db.query("insert into cart_items(cart_id,line_id,product_variant_id,quantity,purchase_mode) values($1,'line',$2,1,'BUY_ONCE')",[subject,v.id]);
  }else{
   const o=await order(c,w!=='PAYMENT_FAILED'),p=await payment(o,w==='PAYMENT_FAILED'?'FAILED':'CAPTURED');subject=w==='PAYMENT_FAILED'?p:o;
   if(w==='ORDER_CONFIRMATION')await event('commerce.order.confirmed',c,o,{order_id:o});
   if(w.startsWith('ORDER_SHIPPED')||w==='OUT_FOR_DELIVERY'||w==='DELIVERY_CONFIRMATION'){
    const sid=`canonical-sr-${++sequence}`;subject=(await one('insert into shipments(order_id,provider_shipment_id) values($1,$2) returning id',[o,sid])).id;
    await db.query('select comm_ingest_shipment_event($1)',[JSON.stringify({shipment_id:sid,event_id:sid,current_status:{ORDER_SHIPPED:'shipped',OUT_FOR_DELIVERY:'out for delivery',DELIVERY_CONFIRMATION:'delivered'}[w]})]);
   }
  }
  await capture();await db.query('select comm_dispatch_whatsapp_workflows(50,true)');const i=await intent(w,subject!);expect(i.status).toBe('QUEUED');
  const run=await one('select event_context from communication_runs where id=$1',[i.run_id]);expect(run.event_context.event_type).toBe(w==='CART_RECOVERY'?'commerce.cart.abandoned':w==='PAYMENT_FAILED'?'commerce.payment.changed':w==='ORDER_CONFIRMATION'?'commerce.order.confirmed':'commerce.shipment.changed');
  await db.query('select comm_snapshot_batch($1)',[i.run_id]);await db.query('select comm_prepare_recipients($1)',[i.run_id]);await db.query('select comm_prepare_recipients($1)',[i.run_id]);await capture();await db.query('select comm_dispatch_whatsapp_workflows(50,true)');
  const deliveries=(await db.query('select id,customer_message_id,channel from message_deliveries where customer_message_id=$1 and channel=\'WHATSAPP\'',[i.message_id])).rows;expect(deliveries).toHaveLength(1);
  expect((await one('select comm_whatsapp_delivery_permission($1) reason',[(deliveries[0] as any).id])).reason).toBeNull();expect(fetch).not.toHaveBeenCalled();
 });
 it('never releases a draft-time welcome after activation',async()=>{
  await db.query("update communication_rules set status='DRAFT' where name='UPPERMOST_WHATSAPP_WELCOME_V1'");
  const n=++sequence,l=await one("insert into um_leads(email,phone,first_name,consent_whatsapp,consent_recorded_at,metadata) values($1,$2,'Fixture',true,now(),'{\"lead_stage\":\"completed\"}') returning id",[`welcome${n}@example.test`,`92000${String(n).padStart(5,'0')}`]);
  await db.query('select comm_connect_whatsapp_welcome($1)',[l.id]);await enable('WELCOME');expect((await one('select comm_dispatch_whatsapp_welcomes(50,true) n')).n).toBe(0);
  expect((await one('select status from communication_whatsapp_welcome_intents where lead_id=$1',[l.id])).status).toBe('SUPPRESSED');
 });
 it('does not turn an old signup into fresh consent by connecting it after activation',async()=>{
  await enable('WELCOME');const n=++sequence,l=await one("insert into um_leads(email,phone,first_name,consent_whatsapp,consent_recorded_at,metadata) values($1,$2,'Fixture',true,now()-interval '2 days','{\"lead_stage\":\"completed\"}') returning id",[`old${n}@example.test`,`93000${String(n).padStart(5,'0')}`]);
  await db.query('select comm_connect_whatsapp_welcome($1)',[l.id]);expect((await one('select activation_eligible from communication_whatsapp_welcome_intents where lead_id=$1',[l.id])).activation_eligible).toBe(false);
 });
 it('cancels recovery immediately after a purchase even before feature projection',async()=>{
  const c=await customer(),v=await one('select id from product_variants limit 1'),cart=await one("insert into carts(customer_id,updated_at) values($1,now()-interval '2 hours') returning id",[c]);await db.query("insert into cart_items(cart_id,line_id,product_variant_id,quantity,purchase_mode) values($1,'line',$2,1,'BUY_ONCE')",[cart.id,v.id]);await capture();const i=await intent('CART_RECOVERY',cart.id);await order(c);expect((await one('select comm_whatsapp_workflow_permission($1) reason',[i.id])).reason).toBe('CART_OBSOLETE');
 });
 it('suppresses STOP, expired work and paused rules before a queued send',async()=>{
  const c=await customer(),v=await one('select id from product_variants limit 1'),cart=await one("insert into carts(customer_id,updated_at) values($1,now()-interval '2 hours') returning id",[c]);await db.query("insert into cart_items(cart_id,line_id,product_variant_id,quantity,purchase_mode) values($1,'line',$2,1,'BUY_ONCE')",[cart.id,v.id]);await capture();const i=await intent('CART_RECOVERY',cart.id);
  await db.query("select comm_phone_opt_out((select phone from customers where id=$1),'WHATSAPP')",[c]);expect((await one('select comm_whatsapp_workflow_permission($1) reason',[i.id])).reason).toBe('CONSENT_REQUIRED');
  const owner=await customer(),o=await order(owner);await payment(o);await event('commerce.order.confirmed',owner,o,{order_id:o});await capture();const confirmed=await intent('ORDER_CONFIRMATION',o);
  await db.query("update communication_whatsapp_workflow_intents set source_at=now()-interval '2 days' where id=$1",[confirmed.id]);expect((await one('select comm_whatsapp_workflow_permission($1) reason',[confirmed.id])).reason).toBe('WORKFLOW_EXPIRED');
  await db.query('update communication_whatsapp_workflow_intents set source_at=now() where id=$1',[confirmed.id]);await db.query("update communication_rules set status='PAUSED' where name='UPPERMOST_WHATSAPP_ORDER_CONFIRMATION_V1'");expect((await one('select comm_whatsapp_workflow_permission($1) reason',[confirmed.id])).reason).toBe('RULE_NOT_ACTIVE');await enable('ORDER_CONFIRMATION');
 });
 it('recovers new verified source facts when the exception-isolated outbox bridge fails',async()=>{
  const c=await customer(),o=await order(c);await payment(o);await db.query('delete from integration_outbox where customer_id=$1',[c]);await capture();expect((await intent('ORDER_CONFIRMATION',o)).status).toBe('PENDING');
 });
 it('materializes recovery carts from owned prepared checkouts without changing financial records',async()=>{
  const c=await customer(),o=await order(c,false);await payment(o,'CREATED');const session=await one('select checkout_session_id id from orders where id=$1',[o]);const v=await one('select id,product_id,sku from product_variants limit 1');
  await db.query("insert into order_items(order_id,line_id,product_id,product_variant_id,sku,product_name,variant_name,quantity,purchase_mode,unit_price_paise,line_subtotal_paise,line_total_paise,snapshot) values($1,'line',$2,$3,$4,'Fixture','Fixture',1,'BUY_ONCE',10000,10000,10000,'{}')",[o,v.product_id,v.id,v.sku]);
  await db.query("update checkout_sessions set provider_order_id='prepared-fixture',created_at=now()-interval '2 hours' where id=$1",[session.id]);
  // The floor prevents historical backfill, so this disposable fixture explicitly
  // models a checkout created after installation but already inactive for two hours.
  await db.query("update communication_recovery_cursors set last_completed_at=now()-interval '3 hours' where source='whatsapp_workflows_capture_floor'");
  await capture();await capture();const cart=await one('select * from carts where communication_checkout_session_id=$1',[session.id]);expect(cart.customer_id).toBe(c);expect((await intent('CART_RECOVERY',cart.id)).status).toBe('PENDING');expect((await one('select status,total_paise from orders where id=$1',[o])).status).toBe('PAYMENT_PENDING');
 });
 it('reclaims the same canonical delivery for a definite retry but never an ambiguous send',async()=>{
  const d=await one("select d.id,d.customer_message_id from message_deliveries d join communication_whatsapp_workflow_intents i on i.message_id=d.customer_message_id where i.workflow='ORDER_CONFIRMATION' and d.channel='WHATSAPP' and d.status='PENDING' limit 1");
  expect((await db.query('select * from comm_claim_delivery($1)',[d.id])).rows).toHaveLength(1);
  await db.query("update message_deliveries set status='FAILED_RETRYABLE',lease_until=null,retry_count=1,next_attempt_at=now() where id=$1",[d.id]);
  const claims=await Promise.all([db.query('select * from comm_claim_delivery($1)',[d.id]),db.query('select * from comm_claim_delivery($1)',[d.id])]);expect(claims.reduce((n,r)=>n+r.rows.length,0)).toBe(1);
  await db.query("update message_deliveries set status='RECONCILIATION_PENDING',lease_until=null where id=$1",[d.id]);expect((await db.query('select * from comm_claim_delivery($1)',[d.id])).rows).toHaveLength(0);expect((await one("select count(*)::int n from message_deliveries where customer_message_id=$1 and channel='WHATSAPP'",[d.customer_message_id])).n).toBe(1);expect(fetch).not.toHaveBeenCalled();
 });
 it('holds early authenticated courier evidence until payment is verified, then recovers it',async()=>{
  const c=await customer(),o=await order(c,false),p=await payment(o,'CREATED'),sr=`early-${++sequence}`,s=await one('insert into shipments(order_id,provider_shipment_id) values($1,$2) returning id',[o,sr]);
  await db.query('select comm_ingest_shipment_event($1)',[JSON.stringify({shipment_id:sr,event_id:sr,current_status:'delivered'})]);await capture();expect(await intent('DELIVERY_CONFIRMATION',s.id)).toBeUndefined();
  await db.query("update payment_attempts set status='CAPTURED',raw_metadata=jsonb_set(raw_metadata,'{status}','\"captured\"') where id=$1",[p]);await db.query("update orders set status='CONFIRMED',paid_at=now() where id=$1",[o]);await capture();expect((await intent('DELIVERY_CONFIRMATION',s.id)).status).toBe('PENDING');
 });
 it('rolls back tracking, milestone and message together on persistence failure',async()=>{
  const c=await customer(),o=await order(c);await payment(o);const sr=`rollback-${++sequence}`,s=await one('insert into shipments(order_id,provider_shipment_id) values($1,$2) returning id',[o,sr]);
  await db.exec("create function private.wf_test_fail() returns trigger language plpgsql as $$begin raise exception 'TEST_PERSISTENCE_FAILURE';end$$;create trigger wf_test_fail before update on shipments for each row execute function private.wf_test_fail();");
  try{await expect(db.query('select comm_ingest_shipment_event($1)',[JSON.stringify({shipment_id:sr,event_id:sr,current_status:'shipped'})])).rejects.toThrow('TEST_PERSISTENCE_FAILURE');}finally{await db.exec('drop trigger wf_test_fail on shipments;drop function private.wf_test_fail();');}
  expect((await db.query('select id from tracking_events where shipment_id=$1',[s.id])).rows).toHaveLength(0);expect((await one('select status from shipments where id=$1',[s.id])).status).toBe('PENDING');
  await db.query('select comm_ingest_shipment_event($1)',[JSON.stringify({shipment_id:sr,event_id:sr,current_status:'shipped'})]);expect((await one('select status from shipments where id=$1',[s.id])).status).toBe('SHIPPED');
 });
 it.each(['CANCELLED','RTO Delivered','Returned','Lost'])('suppresses queued shipping after authenticated %s and never resurrects it',async(terminal)=>{
  const c=await customer(),o=await order(c);await payment(o);const sr=`terminal-${++sequence}`,s=await one('insert into shipments(order_id,provider_shipment_id) values($1,$2) returning id',[o,sr]);
  await db.query('select comm_ingest_shipment_event($1)',[JSON.stringify({shipment_id:sr,event_id:sr+'-shipped',current_status:'shipped',event_time:new Date(Date.now()-60000).toISOString()})]);await capture();const i=await intent('ORDER_SHIPPED',s.id);expect(i.status).toBe('PENDING');
  await db.query('select comm_ingest_shipment_event($1)',[JSON.stringify({shipment_id:sr,event_id:sr+'-terminal',current_status:terminal})]);expect((await one('select comm_whatsapp_workflow_permission($1) reason',[i.id])).reason).toBe('SHIPMENT_OBSOLETE_OR_UNVERIFIED');
  await db.query('select comm_ingest_shipment_event($1)',[JSON.stringify({shipment_id:sr,event_id:sr+'-late-positive',current_status:'delivered'})]);await capture();expect(await intent('DELIVERY_CONFIRMATION',s.id)).toBeUndefined();await db.query('select comm_dispatch_whatsapp_workflows(50,true)');expect((await intent('ORDER_SHIPPED',s.id)).status).toBe('SUPPRESSED');
 });
 it('does not regress delivered state after late lower courier milestones',async()=>{
  const c=await customer(),o=await order(c);await payment(o);const sr=`monotonic-${++sequence}`,s=await one('insert into shipments(order_id,provider_shipment_id) values($1,$2) returning id',[o,sr]);
  for(const [n,status] of ['delivered','out for delivery','shipped'].entries())await db.query('select comm_ingest_shipment_event($1)',[JSON.stringify({shipment_id:sr,event_id:sr+n,current_status:status})]);
  expect((await one('select status from shipments where id=$1',[s.id])).status).toBe('DELIVERED');
 });
});
