import {PGlite} from '@electric-sql/pglite';
import {readFileSync,readdirSync} from 'node:fs';
import {beforeAll,afterAll,describe,it,expect,vi} from 'vitest';
let db:PGlite;let sequence=0;
type GateRow={id:string;customer_id:string;checkout_session_id:string;run_id:string;message_id:string;action_config:{templates:{WHATSAPP:string}};[key:string]:unknown};
const one=async(sql:string,params:unknown[]=[]) => (await db.query<GateRow>(sql,params)).rows[0];
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
 // Supabase installations may grant ALL to service_role by default.
 await db.exec('alter default privileges in schema public grant all on tables to service_role');
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
async function capture(){await db.query('select comm_capture_whatsapp_workflows(50)');}
const intent=async(w:string,s:string)=>one('select * from communication_whatsapp_workflow_intents where workflow=$1 and subject_id=$2',[w,s]);
async function enable(w:string){await db.query("update communication_rules set status='ACTIVE',approved_at=now()-interval '1 day',valid_from=now()-interval '1 day' where name=$1",[`UPPERMOST_WHATSAPP_${w}_V1`]);}

const context={project_ref:'jwsivyxapfnyaafdcdos',base_url:'https://staging.uppermost.store',environment:'preview',branch:'staging',dry_run:true,build_sha:'a'.repeat(40),reviewed_build_sha:'a'.repeat(40),app_id:'111',waba_id:'222',sender_id:'333'};
async function fixture(){
 await db.exec(readFileSync('supabase/manual/prepare_staging_whatsapp_seven_workflows.sql','utf8'));await enable('ORDER_SHIPPED');
 const rule=await one("select * from communication_rules where name='UPPERMOST_WHATSAPP_ORDER_SHIPPED_V1'");const v=rule.action_config.templates.WHATSAPP;
 await db.query("update communication_template_provider_artifacts set provider_status='APPROVED',provider_category='UTILITY',provider_template_id='template-fixture' where template_version_id=$1",[v]);
 await db.query("update communication_template_versions set status='ACTIVE' where id=$1",[v]);
 const c=await customer(),o=await order(c);await payment(o);await db.query("update orders set pricing_snapshot='{\"communication_e2e_fixture\":true}' where id=$1",[o]);const sid=`gate-${++sequence}`;
 const s=await one('insert into shipments(order_id,provider_shipment_id) values($1,$2) returning id',[o,sid]);
 await db.query('select comm_ingest_shipment_event($1)',[JSON.stringify({shipment_id:sid,event_id:sid,current_status:'shipped',e2e_test:true})]);await capture();await db.query('select comm_dispatch_whatsapp_workflows(50,true)');
 const i=await intent('ORDER_SHIPPED',s.id);await db.query('select comm_snapshot_batch($1)',[i.run_id]);await db.query('select comm_prepare_recipients($1)',[i.run_id]);
 const d=await one("select id from message_deliveries where customer_message_id=$1 and channel='WHATSAPP'",[i.message_id]);
 const approval=await one('select gen_random_uuid() id');const actor=await one('insert into auth.users(id) values(gen_random_uuid()) returning id');
 await db.query("insert into admin_memberships(user_id,role) values($1,'ADMIN')",[actor.id]);
 await db.query("insert into communication_preferences(customer_id,channel,purpose,allowed,source) values($1,'WHATSAPP','TRANSACTIONAL',true,'EXPLICIT_E2E_TEST')",[c]);
 const consent=await one("insert into communication_preference_history(customer_id,channel,purpose,allowed,source,evidence) values($1,'WHATSAPP','TRANSACTIONAL',true,'EXPLICIT_E2E_TEST',jsonb_build_object('approval_ref',$2::text,'recipient',(select normalized_phone from customers where id=$1))) returning id",[c,approval.id]);
 return {c,o,s:s.id,i:i.id,d:d.id,v,rule:rule.id,approval:approval.id,actor:actor.id,consent:consent.id};
}
type Fixture=Awaited<ReturnType<typeof fixture>>;
async function authorize(f:Fixture,ctx:unknown=context,expiry='15 minutes'){
 return (await one("select comm_authorize_whatsapp_e2e($1,$2,$3,$4,$5,clock_timestamp()+$6::interval) id",[f.d,JSON.stringify(ctx),f.approval,f.actor,f.consent,expiry])).id as string;
}
const reserve=async(id:string,ctx:unknown=context)=>(await one('select comm_reserve_whatsapp_e2e($1,$2) reserved',[id,JSON.stringify(ctx)])).reserved;

describe('dormant durable WhatsApp E2E authorization',()=>{
 it('reserves exactly once across concurrent workers and replay',async()=>{
  const f=await fixture(),id=await authorize(f);await db.query('select * from comm_claim_delivery($1)',[f.d]);
  expect(await Promise.all([reserve(id),reserve(id),reserve(id)])).toEqual([true,false,false]);expect(await reserve(id)).toBe(false);
  expect(await one('select attempt_count,consumed_at is not null consumed from communication_whatsapp_e2e_authorizations where id=$1',[id])).toEqual({attempt_count:1,consumed:true});expect(fetch).not.toHaveBeenCalled();
 });
 it.each(['16 minutes','0 minutes','-1 minute'])('rejects invalid authorization window %s',async window=>{await expect(authorize(await fixture(),context,window)).rejects.toThrow('E2E_EXPIRY_INVALID');});
 it.each(['project_ref','base_url','environment','branch','dry_run','build_sha','reviewed_build_sha','app_id','waba_id','sender_id'])('denies missing or invalid %s',async key=>{
  const f=await fixture();await expect(authorize(f,{...context,[key]:null})).rejects.toThrow('E2E_CONTEXT_INVALID');
 });
 it('does not consume on mismatched runtime, but never accepts a different build or sender',async()=>{
  const f=await fixture(),id=await authorize(f);await db.query('select * from comm_claim_delivery($1)',[f.d]);
  for(const key of ['build_sha','waba_id','sender_id','app_id'])expect(await reserve(id,{...context,[key]:'9'.repeat(40)})).toBe(false);
  expect(await reserve(id)).toBe(true);
 });
 it.each(['PENDING','DRY_RUN','FAILED_RETRYABLE','RECONCILIATION_PENDING','ACCEPTED'])('cannot reserve a delivery in %s',async status=>{
  const f=await fixture(),id=await authorize(f);await db.query('update message_deliveries set status=$1 where id=$2',[status,f.d]);expect(await reserve(id)).toBe(false);
 });
 it.each(['CANCELLED','Returned','RTO Delivered'])('denies terminal shipment %s after authorization',async terminal=>{
  const f=await fixture(),id=await authorize(f);await db.query('select * from comm_claim_delivery($1)',[f.d]);await db.query('update shipments set status=$1 where id=$2',[terminal,f.s]);expect(await reserve(id)).toBe(false);
 });
 it.each(['consent','STOP','rule','template','recipient','order','intent','payment-status','payment-evidence'])('rechecks %s before reservation',async change=>{
  const f=await fixture(),id=await authorize(f);await db.query('select * from comm_claim_delivery($1)',[f.d]);
  if(change==='consent')await db.query("update communication_preferences set allowed=false where customer_id=$1 and purpose='TRANSACTIONAL'",[f.c]);
  if(change==='STOP')await db.query("select comm_phone_opt_out((select phone from customers where id=$1),'WHATSAPP')",[f.c]);
  if(change==='rule')await db.query("update communication_rules set status='PAUSED' where id=$1",[f.rule]);
  if(change==='template')await db.query("update communication_template_provider_artifacts set provider_status='PAUSED' where template_version_id=$1",[f.v]);
  if(change==='recipient')await db.query("update customers set phone='+919111111111' where id=$1",[f.c]);
  if(change==='order')await db.query("update orders set status='CANCELLED' where id=$1",[f.o]);
  if(change==='intent')await db.query("update communication_whatsapp_workflow_intents set status='BLOCKED_DRAFT' where id=$1",[f.i]);
  if(change==='payment-status')await db.query("update payment_attempts set status='FAILED' where order_id=$1",[f.o]);
  if(change==='payment-evidence')await db.query("update payment_attempts set raw_metadata=jsonb_set(raw_metadata,'{amount}','999') where order_id=$1",[f.o]);
  expect(await reserve(id)).toBe(false);
 });
 it('requires affirmative test-specific consent and ADMIN approval',async()=>{
  const f=await fixture();await db.query('delete from communication_preferences where customer_id=$1',[f.c]);await expect(authorize(f)).rejects.toThrow('E2E_BINDING_INVALID');
  const other=await fixture();await db.query("update admin_memberships set active=false where user_id=$1",[other.actor]);await expect(authorize(other)).rejects.toThrow('E2E_BINDING_INVALID');
 });
 it('deduplicates exact issuance but rejects reusing an approval for another delivery',async()=>{
  const f=await fixture(),id=await authorize(f);expect(await authorize(f)).toBe(id);const other=await fixture();other.approval=f.approval;await expect(authorize(other)).rejects.toThrow('E2E_APPROVAL_CONFLICT');
 });
 it('revokes without making the budget reusable',async()=>{
  const f=await fixture(),id=await authorize(f);await db.query('select comm_revoke_whatsapp_e2e($1)',[id]);await db.query('select * from comm_claim_delivery($1)',[f.d]);expect(await reserve(id)).toBe(false);expect(await authorize(f)).toBe(id);
 });
 it('denies an authorization after its absolute expiry',async()=>{
  const f=await fixture(),id=await authorize(f,context,'0.2 seconds');await db.query('select * from comm_claim_delivery($1)',[f.d]);
  await new Promise(resolve=>setTimeout(resolve,250));expect(await reserve(id)).toBe(false);
 });
 it.each(['name','language','parameters','rule-version','tracking-event','message-identity','message-metadata','message-order','message-shipment','run-context'])('denies changed binding %s',async change=>{
  const f=await fixture(),id=await authorize(f);await db.query('select * from comm_claim_delivery($1)',[f.d]);
  if(change==='name')await db.query("update communication_template_provider_artifacts set provider_template_name='another' where template_version_id=$1",[f.v]);
  if(change==='language')await db.query("update communication_template_provider_artifacts set provider_language='en_US' where template_version_id=$1",[f.v]);
  if(change==='parameters')await db.query("update customers set name='Changed' where id=$1",[f.c]);
  if(change==='rule-version')await db.query('update communication_rules set version=version+1 where id=$1',[f.rule]);
  if(change==='tracking-event')await db.query("update tracking_events set provider_event_id=provider_event_id||'-changed' where shipment_id=$1",[f.s]);
  if(change==='message-identity'){const other=await customer();await db.query("update customer_messages set customer_id=$1,metadata='{}' where id=(select customer_message_id from message_deliveries where id=$2)",[other,f.d]);}
  if(change==='message-metadata')await db.query("update customer_messages set metadata='{}' where id=(select customer_message_id from message_deliveries where id=$1)",[f.d]);
  if(change==='message-order')await db.query("update customer_messages set order_id=null,metadata='{}' where id=(select customer_message_id from message_deliveries where id=$1)",[f.d]);
  if(change==='message-shipment')await db.query("update customer_messages set shipment_id=null,metadata='{}' where id=(select customer_message_id from message_deliveries where id=$1)",[f.d]);
  if(change==='run-context')await db.query("update communication_runs set event_context='{}' where id=(select run_id from communication_run_recipients where id=(select run_recipient_id from message_deliveries where id=$1))",[f.d]);
  expect(await reserve(id)).toBe(false);
 });
 it('cannot mint another authorization for the same delivery or rewrite/delete the record',async()=>{
  const f=await fixture(),id=await authorize(f);f.approval=(await one('select gen_random_uuid() id')).id;
  f.consent=(await one("insert into communication_preference_history(customer_id,channel,purpose,allowed,source,evidence) select customer_id,channel,purpose,allowed,source,jsonb_set(evidence,'{approval_ref}',to_jsonb($1::text)) from communication_preference_history where id=$2 returning id",[f.approval,f.consent])).id;
  await expect(authorize(f)).rejects.toThrow('E2E_APPROVAL_CONFLICT');
  await expect(db.query("update communication_whatsapp_e2e_authorizations set expires_at=expires_at+interval '1 minute' where id=$1",[id])).rejects.toThrow('E2E_AUTHORIZATION_IMMUTABLE');
  await expect(db.query('delete from communication_whatsapp_e2e_authorizations where id=$1',[id])).rejects.toThrow('E2E_AUTHORIZATION_IMMUTABLE');
  await expect(db.query('truncate communication_whatsapp_e2e_authorizations')).rejects.toThrow('E2E_AUTHORIZATION_IMMUTABLE');
 });
 it('retains canonical immutable template and consent audit guards',async()=>{
  const f=await fixture();await expect(db.query("update communication_template_versions set text_content='changed' where id=$1",[f.v])).rejects.toThrow('IMMUTABLE_TEMPLATE_VERSION');
  await expect(db.query("update communication_preference_history set evidence='{}' where id=$1",[f.consent])).rejects.toThrow('IMMUTABLE_AUDIT_HISTORY');
 });
 it('supports service-role RPCs and denies anonymous execution',async()=>{
  const f=await fixture();let id:string;
  await db.exec('set role service_role');try{id=await authorize(f);expect(await reserve(id)).toBe(false);}finally{await db.exec('reset role');}
  await db.query('select * from comm_claim_delivery($1)',[f.d]);
  await db.exec('set role service_role');try{expect(await reserve(id!)).toBe(true);}finally{await db.exec('reset role');}
  for(const role of ['anon','authenticated']){await db.exec(`set role ${role}`);try{await expect(reserve(id!)).rejects.toThrow('permission denied');}finally{await db.exec('reset role');}}
 });
 it.each([' Fixture','Fixture\t','\u00a0Fixture','\ufeffFixture',''])('rejects noncanonical name %j rather than binding different rendered parameters',async name=>{
  const f=await fixture();await db.query('update customers set name=$1 where id=$2',[name,f.c]);await expect(authorize(f)).rejects.toThrow('E2E_BINDING_INVALID');
 });
 it.each(['timeout','500','rejection','unknown','crash'])('keeps consumption irreversible after simulated %s outcome',async()=>{
  const f=await fixture(),id=await authorize(f);await db.query('select * from comm_claim_delivery($1)',[f.d]);expect(await reserve(id)).toBe(true);
  await db.query("update message_deliveries set status='FAILED_RETRYABLE',retry_count=1,next_attempt_at=now() where id=$1",[f.d]);await db.query('select * from comm_claim_delivery($1)',[f.d]);expect(await reserve(id)).toBe(false);
  await expect(db.query('update communication_whatsapp_e2e_authorizations set consumed_at=null,attempt_count=0 where id=$1',[id])).rejects.toThrow('E2E_AUTHORIZATION_IMMUTABLE');
 });
 it('enforces RLS and excludes public, anon and authenticated roles',async()=>{
  expect((await one("select relrowsecurity enabled from pg_class where oid='communication_whatsapp_e2e_authorizations'::regclass")).enabled).toBe(true);
  for(const role of ['anon','authenticated']){
   expect((await one("select has_table_privilege($1,'communication_whatsapp_e2e_authorizations','SELECT') allowed",[role])).allowed).toBe(false);
   expect((await one("select has_function_privilege($1,'comm_reserve_whatsapp_e2e(uuid,jsonb)','EXECUTE') allowed",[role])).allowed).toBe(false);
  }
  for(const privilege of ['DELETE','TRUNCATE','TRIGGER','REFERENCES'])expect((await one("select has_table_privilege('service_role','communication_whatsapp_e2e_authorizations',$1) allowed",[privilege])).allowed).toBe(false);
 });
});
