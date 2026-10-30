import {PGlite} from '@electric-sql/pglite';
import {readFileSync,readdirSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {beforeAll,afterAll,describe,it,expect,vi} from 'vitest';
let db:PGlite;let sequence=0;
type DatabaseRow={id:string;customer_id:string;checkout_session_id:string|null;n:number;status:string;reason:string|null;result:{shipment_id:string;status:string;simulated:boolean;duplicate?:boolean}};
const one=async(sql:string,params:unknown[]=[]) => (await db.query<DatabaseRow>(sql,params)).rows[0];
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


const context={project_ref:'jwsivyxapfnyaafdcdos',base_url:'https://staging.uppermost.store',environment:'preview',branch:'staging',dry_run:true,api_enabled:false,simulation_enabled:true,razorpay_test_key:true,build_sha:'a'.repeat(40),test_pincodes:['110001']};
const create=async(o:string,ctx:unknown=context)=>(await one('select comm_create_simulated_shipment($1,$2) result',[o,JSON.stringify(ctx)])).result;
const transition=async(o:string,s:string,status:string,actor:string,event=randomUUID(),ctx:unknown=context)=>(await one('select comm_transition_simulated_shipment($1,$2,$3,$4,$5,$6) result',[o,s,status,event,actor,JSON.stringify(ctx)])).result;
async function fixture(paid=true){const c=await customer(),o=await order(c,paid);const p=await payment(o,paid?'CAPTURED':'CREATED');await db.query("update orders set address_snapshot=$2,pricing_snapshot=$3 where id=$1",[o,JSON.stringify({postal_code:'110001'}),JSON.stringify({shipping:{simulated:true,serviceable:true,simulation_project_ref:context.project_ref,simulation_postal_code:'110001'}})]);return {c,o,p};}
async function admin(role='ADMIN'){const id=randomUUID();await db.query('insert into auth.users(id) values($1)',[id]);await db.query('insert into admin_memberships(user_id,role) values($1,$2)',[id,role]);return id;}

describe('staging shipment simulation isolated database',()=>{
 it.each(['project_ref','base_url','environment','branch','dry_run','api_enabled','simulation_enabled','razorpay_test_key','build_sha','test_pincodes'])('rejects wrong or missing %s without a shipment',async(key)=>{
  const {o}=await fixture();const invalid={...context,[key]:'wrong'};await expect(create(o,invalid)).rejects.toThrow('SIMULATION_CONTEXT_INVALID');delete invalid[key as keyof typeof invalid];await expect(create(o,invalid)).rejects.toThrow('SIMULATION_CONTEXT_INVALID');expect((await one('select count(*)::int n from shipments where order_id=$1',[o])).n).toBe(0);
 });
 it('rejects null context and extra untrusted context fields',async()=>{const {o}=await fixture();for(const ctx of [null,[],{...context,unexpected:true}])await expect(create(o,ctx)).rejects.toThrow('SIMULATION_CONTEXT_INVALID');});
 it('requires captured evidence and exact provider amount and identity',async()=>{
  const unpaid=await fixture(false);await expect(create(unpaid.o)).rejects.toThrow('SIMULATION_PAID_ORDER_REQUIRED');
  for(const field of ['amount','id','order_id','currency']){const {o,p}=await fixture();await db.query('update payment_attempts set raw_metadata=jsonb_set(raw_metadata,array[$2],to_jsonb($3::text)) where id=$1',[p,field,'wrong']);await expect(create(o)).rejects.toThrow('SIMULATION_PAID_ORDER_REQUIRED');}
 });
 it('rejects mismatched checkout ownership even with captured evidence',async()=>{const {o}=await fixture(),other=await customer();await db.query('update checkout_sessions set customer_id=$2 where id=(select checkout_session_id from orders where id=$1)',[o,other]);await expect(create(o)).rejects.toThrow('SIMULATION_PAID_ORDER_REQUIRED');});
 it.each(['simulated','serviceable','simulation_project_ref','simulation_postal_code'])('binds %s in the quote to staging and the actual address',async(field)=>{const {o}=await fixture();await db.query("update orders set pricing_snapshot=jsonb_set(pricing_snapshot,array['shipping',$2],to_jsonb('wrong'::text)) where id=$1",[o,field]);await expect(create(o)).rejects.toThrow('SIMULATION_QUOTE_REQUIRED');});
 it('creates once concurrently without changing financial records or claiming an AWB',async()=>{
  const {o,p}=await fixture();const before=await one('select to_jsonb(o) o,to_jsonb(p) p from orders o join payment_attempts p on p.order_id=o.id where o.id=$1',[o]);const [a,b]=await Promise.all([create(o),create(o)]);expect(a).toEqual(b);expect(a).toMatchObject({status:'ORDER_CREATED',simulated:true});
  const s=await one('select * from shipments where order_id=$1',[o]);expect(s).toMatchObject({provider:'STAGING_SIMULATION',provider_shipment_id:'sim_'+a.shipment_id,awb_code:null,courier_id:null,provider_order_id:null,courier_name:'Simulated staging shipment'});expect((await one('select count(*)::int n from shipment_simulation_audit where order_id=$1',[o])).n).toBe(1);expect(await one('select to_jsonb(o) o,to_jsonb(p) p from orders o join payment_attempts p on p.order_id=o.id where o.id=$1',[o])).toEqual(before);expect(p).toBeTruthy();
 });
 it('copies only the authoritative quote delivery dates and leaves missing estimates null',async()=>{
  const {o}=await fixture();await db.query("update orders set pricing_snapshot=jsonb_set(jsonb_set(pricing_snapshot,'{shipping,estimated_delivery_from}','\"2026-11-02T11:00:00.000Z\"'),'{shipping,estimated_delivery_to}','\"2026-11-04T11:00:00.000Z\"') where id=$1",[o]);
  const s=await create(o);expect(await one('select expected_from::text,expected_to::text from shipments where id=$1',[s.shipment_id])).toEqual({expected_from:'2026-11-02',expected_to:'2026-11-04'});
  const missing=await fixture(),empty=await create(missing.o);expect(await one('select expected_from,expected_to from shipments where id=$1',[empty.shipment_id])).toEqual({expected_from:null,expected_to:null});
 });
 it('blocks real ingestion and unrelated service updates including provider conversion',async()=>{
  const {o}=await fixture(),s=await create(o);await expect(db.query('select comm_ingest_shipment_event($1)',[JSON.stringify({shipment_id:'sim_'+s.shipment_id,event_id:randomUUID(),current_status:'shipped'})])).rejects.toThrow('SIMULATION_INGEST_FORBIDDEN');
  await expect(db.query("update shipments set status='DELIVERED' where id=$1",[s.shipment_id])).rejects.toThrow('SIMULATION_MUTATION_FORBIDDEN');await expect(db.query("update shipments set provider='SHIPROCKET' where id=$1",[s.shipment_id])).rejects.toThrow('SIMULATION_MUTATION_FORBIDDEN');expect((await one('select count(*)::int n from tracking_events where shipment_id=$1',[s.shipment_id])).n).toBe(0);
  await expect(db.query("insert into tracking_events(shipment_id,status,occurred_at) values($1,'SHIPPED',now())",[s.shipment_id])).rejects.toThrow('SIMULATION_TRACKING_FORBIDDEN');
  await transition(o,s.shipment_id,'SHIPPED',await admin());await expect(db.query("update tracking_events set status='DELIVERED' where shipment_id=$1",[s.shipment_id])).rejects.toThrow('SIMULATION_TRACKING_FORBIDDEN');await expect(db.query('delete from tracking_events where shipment_id=$1',[s.shipment_id])).rejects.toThrow('SIMULATION_TRACKING_FORBIDDEN');
 });
 it('denies revoked postcodes, renewal orders and cancelled orders',async()=>{const {o}=await fixture();await expect(create(o,{...context,test_pincodes:['400001']})).rejects.toThrow('SIMULATION_QUOTE_REQUIRED');const s=await create(o),actor=await admin();await expect(transition(o,s.shipment_id,'SHIPPED',actor,randomUUID(),{...context,test_pincodes:['400001']})).rejects.toThrow('SIMULATION_QUOTE_REQUIRED');await db.query("update orders set order_kind='RENEWAL' where id=$1",[o]);await expect(create(o)).rejects.toThrow('SIMULATION_PAID_ORDER_REQUIRED');});
 it('denies reused event IDs across different owned orders',async()=>{const a=await fixture(),b=await fixture(),sa=await create(a.o),sb=await create(b.o),actor=await admin(),event=randomUUID();await transition(a.o,sa.shipment_id,'SHIPPED',actor,event);await expect(transition(b.o,sb.shipment_id,'SHIPPED',actor,event)).rejects.toThrow('SIMULATION_EVENT_CONFLICT');});
 it('preserves genuine authenticated courier ingestion',async()=>{const {o}=await fixture();const sid='real-'+randomUUID();const s=await one('insert into shipments(order_id,provider_shipment_id) values($1,$2) returning id',[o,sid]);await db.query('select comm_ingest_shipment_event($1)',[JSON.stringify({shipment_id:sid,event_id:randomUUID(),current_status:'shipped'})]);expect((await one('select status from shipments where id=$1',[s.id])).status).toBe('SHIPPED');await expect(create(o)).rejects.toThrow('SIMULATION_SHIPMENT_CONFLICT');});
 it('permits only active admins and strictly ordered owned milestones',async()=>{
  const {o}=await fixture(),s=await create(o),actor=await admin(),viewer=await admin('VIEWER'),other=await fixture();await expect(transition(o,s.shipment_id,'SHIPPED',viewer)).rejects.toThrow('SIMULATION_ADMIN_REQUIRED');await expect(transition(other.o,s.shipment_id,'SHIPPED',actor)).rejects.toThrow('SIMULATION_SHIPMENT_REQUIRED');await expect(transition(o,s.shipment_id,'DELIVERED',actor)).rejects.toThrow('SIMULATION_TRANSITION_INVALID');await db.query('update admin_memberships set active=false where user_id=$1',[actor]);await expect(transition(o,s.shipment_id,'SHIPPED',actor)).rejects.toThrow('SIMULATION_ADMIN_REQUIRED');
 });
 it('audits each canonical milestone once and permits old identical retries without resetting state',async()=>{
  await db.exec(readFileSync('supabase/manual/prepare_staging_whatsapp_seven_workflows.sql','utf8'));const {o}=await fixture(),s=await create(o),actor=await admin(),event=randomUUID();
  const pair=await Promise.all([transition(o,s.shipment_id,'SHIPPED',actor,event),transition(o,s.shipment_id,'SHIPPED',actor,event)]);expect(pair.filter(x=>x.duplicate)).toHaveLength(1);
  await db.query('select comm_capture_whatsapp_workflows(50)');await transition(o,s.shipment_id,'OUT_FOR_DELIVERY',actor);await db.query('select comm_capture_whatsapp_workflows(50)');await transition(o,s.shipment_id,'DELIVERED',actor);await db.query('select comm_capture_whatsapp_workflows(50)');
  expect(await transition(o,s.shipment_id,'SHIPPED',actor,event)).toMatchObject({duplicate:true});expect((await one('select status from shipments where id=$1',[s.shipment_id])).status).toBe('DELIVERED');expect((await one('select count(*)::int n from tracking_events where shipment_id=$1 and communication_authenticated and description=$2',[s.shipment_id,'Simulated staging shipment update'])).n).toBe(3);expect((await one('select count(*)::int n from shipment_simulation_audit where shipment_id=$1',[s.shipment_id])).n).toBe(4);
  expect((await db.query('select workflow from communication_whatsapp_workflow_intents where shipment_id=$1 order by workflow',[s.shipment_id])).rows).toEqual([{workflow:'DELIVERY_CONFIRMATION'},{workflow:'ORDER_SHIPPED'},{workflow:'OUT_FOR_DELIVERY'}]);await expect(transition(o,s.shipment_id,'DELIVERED',actor,event)).rejects.toThrow('SIMULATION_EVENT_CONFLICT');await expect(transition(o,s.shipment_id,'SHIPPED',await admin(),event)).rejects.toThrow('SIMULATION_EVENT_CONFLICT');await expect(transition(o,s.shipment_id,'SHIPPED',actor)).rejects.toThrow('SIMULATION_TRANSITION_INVALID');
 });
 it('suppresses captured workflow intents after transactional withdrawal or order cancellation',async()=>{
  await db.query("update communication_rules set status='ACTIVE',approved_at=now()-interval '1 day',valid_from=now()-interval '1 day' where name='UPPERMOST_WHATSAPP_ORDER_SHIPPED_V1'");const {o,c}=await fixture(),s=await create(o),actor=await admin();await transition(o,s.shipment_id,'SHIPPED',actor);await db.query('select comm_capture_whatsapp_workflows(50)');const i=await one("select id from communication_whatsapp_workflow_intents where shipment_id=$1 and workflow='ORDER_SHIPPED'",[s.shipment_id]);
  await db.query("insert into communication_preferences(customer_id,channel,purpose,allowed,source) values($1,'WHATSAPP','TRANSACTIONAL',false,'TEST')",[c]);expect((await one('select comm_whatsapp_workflow_permission($1) reason',[i.id])).reason).toBe('CONSENT_REQUIRED');await db.query("delete from communication_preferences where customer_id=$1 and purpose='TRANSACTIONAL'",[c]);await db.query("update orders set status='CANCELLED' where id=$1",[o]);expect((await one('select comm_whatsapp_workflow_permission($1) reason',[i.id])).reason).not.toBeNull();await expect(transition(o,s.shipment_id,'OUT_FOR_DELIVERY',actor)).rejects.toThrow('SIMULATION_PAID_ORDER_REQUIRED');
 });
 it('restricts audit and simulation RPCs to service calls and keeps audit immutable',async()=>{
  expect(await one("select has_function_privilege('anon','comm_create_simulated_shipment(uuid,jsonb)','execute') a,has_function_privilege('authenticated','comm_transition_simulated_shipment(uuid,uuid,text,uuid,uuid,jsonb)','execute') b,has_table_privilege('anon','shipment_simulation_audit','select') c,has_table_privilege('service_role','shipment_simulation_audit','delete') d")).toEqual({a:false,b:false,c:false,d:false});await expect(db.exec('delete from shipment_simulation_audit')).rejects.toThrow('SIMULATION_AUDIT_IMMUTABLE');
 });
 it('prevents privileged audit truncation and bypass ingestion through the retained canonical alias',async()=>{
  await expect(db.exec('truncate shipment_simulation_audit')).rejects.toThrow('SIMULATION_AUDIT_IMMUTABLE');
  const {o}=await fixture(),s=await create(o);await expect(db.query('select comm_ingest_shipment_event_before_simulation($1)',[JSON.stringify({shipment_id:'sim_'+s.shipment_id,event_id:randomUUID(),current_status:'shipped'})])).rejects.toThrow('SIMULATION_TRACKING_FORBIDDEN');expect((await one('select count(*)::int n from tracking_events where shipment_id=$1',[s.shipment_id])).n).toBe(0);
 });
});
