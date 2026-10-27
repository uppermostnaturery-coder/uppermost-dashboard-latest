import { PGlite } from '@electric-sql/pglite';
import { readFileSync,readdirSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll,afterAll,describe,it,expect } from 'vitest';
let db:PGlite;
let sequence=0;
async function lead(overrides:Record<string,unknown>={}){
 const n=++sequence;
 const value={first_name:'Welcome',last_name:'Test',email:`welcome${n}@example.test`,phone:`90000${String(n).padStart(5,'0')}`,consent_email:true,consent_recorded_at:'2026-10-27T07:00:00Z',metadata:{lead_stage:'completed'},...overrides};
 const result=await db.query<{id:string}>('insert into um_leads(first_name,last_name,email,phone,consent_email,consent_recorded_at,metadata) values($1,$2,$3,$4,$5,$6,$7) returning id',Object.values(value));
 return {id:result.rows[0].id,...value};
}
async function connect(id:string){return (await db.query<{result:any}>('select comm_connect_lead_welcome($1) result',[id])).rows[0].result;}
beforeAll(async()=>{
 db=new PGlite();
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create table um_leads(id uuid primary key default gen_random_uuid(),first_name text,last_name text,email text not null,phone text,status text default 'new',consent_email boolean not null default false,consent_recorded_at timestamptz,metadata jsonb not null default '{}');
 create table customers(id uuid primary key default gen_random_uuid(),name text not null,first_name text,email text,normalized_email text unique,phone text,normalized_phone text unique,razorpay_customer_id text,metadata jsonb not null default '{}');
 create table communication_preferences(customer_id uuid references customers(id),channel text,purpose text,allowed boolean not null default false,source text not null,evidence jsonb not null default '{}',updated_at timestamptz not null default now(),primary key(customer_id,channel,purpose));
 create table communication_preference_history(id uuid primary key default gen_random_uuid(),customer_id uuid not null,channel text not null,purpose text not null,allowed boolean not null,source text not null,evidence jsonb not null default '{}',created_at timestamptz default now());
 create table integration_outbox(id uuid primary key default gen_random_uuid(),provider text not null,operation text not null,aggregate_id text not null,idempotency_key text unique not null,event_type text,customer_id uuid references customers(id),lead_id uuid,payload jsonb not null default '{}',event_id uuid not null default gen_random_uuid(),status text default 'pending',lane text default 'REALTIME');
 grant select,update on um_leads to service_role;grant select,insert,update on customers,communication_preferences,communication_preference_history,integration_outbox to service_role;`);
 const engine=readFileSync('supabase/migrations/20261007092407_communications_engine.sql','utf8');
 const audit=engine.slice(engine.indexOf('create function private.communication_preference_audit()'),engine.indexOf('create function public.comm_phone_opt_out'));
 await db.exec("create schema private;create table communication_customer_features(customer_id uuid primary key,email_marketing_allowed boolean default false,whatsapp_marketing_allowed boolean default false,sms_marketing_allowed boolean default false,updated_at timestamptz default now());"+audit);
 await db.exec('grant select,insert,update on communication_customer_features to service_role;');
 const file=readdirSync('supabase/migrations').find(f=>f.endsWith('_staging_welcome_signup_bridge.sql'));
 if(file)await db.exec(readFileSync(join('supabase/migrations',file),'utf8'));
},60000);
afterAll(async()=>{await db?.close();});
describe('persisted signup to Welcome intent',()=>{
 it('creates one customer, consent evidence and one Welcome event atomically',async()=>{
  const l=await lead();const result=await connect(l.id);
  expect(result.status).toBe('connected');
  const event=(await db.query<any>('select * from integration_outbox where id=$1',[result.outbox_id])).rows[0];
  expect(event).toMatchObject({provider:'COMMUNICATIONS',operation:'EVENT',event_type:'lead.completed',lead_id:l.id,customer_id:result.customer_id,status:'pending'});
  expect(event.payload).toMatchObject({logical_purpose:'WELCOME_V1',template_key:'UPPERMOST_WELCOME_V1'});
  const pref=(await db.query<any>("select * from communication_preferences where customer_id=$1",[result.customer_id])).rows;
  expect((await db.query('select * from communication_preference_history where customer_id=$1',[result.customer_id])).rows).toHaveLength(1);
  expect(pref).toHaveLength(1);expect(pref[0]).toMatchObject({channel:'EMAIL',purpose:'MARKETING',allowed:true,evidence:{lead_id:l.id}});
  expect((await db.query('select * from communication_lead_customers where lead_id=$1',[l.id])).rows).toHaveLength(1);
 });
 it.each([{metadata:{lead_stage:'email_completed'}},{consent_email:false},{consent_recorded_at:null},{phone:null}])('does not connect incomplete or unconsented data %j',async changes=>{
  const l=await lead(changes);expect((await connect(l.id)).status).toBe('ineligible');
  expect((await db.query('select * from integration_outbox where lead_id=$1',[l.id])).rows).toHaveLength(0);
 });
 it('deduplicates retries, concurrent calls and another lead with the same normalized identity',async()=>{
  const l=await lead();const results=await Promise.all([connect(l.id),connect(l.id),connect(l.id)]);
  const other=await lead({email:' '+l.email.toUpperCase()+' ',phone:'+91'+l.phone});results.push(await connect(other.id));
  expect(new Set(results.map(r=>r.outbox_id)).size).toBe(1);
  expect((await db.query('select * from communication_welcome_intents where customer_id=$1',[results[0].customer_id])).rows).toHaveLength(1);
  expect((await db.query('select * from integration_outbox where customer_id=$1',[results[0].customer_id])).rows).toHaveLength(1);
 });
 it('preserves existing customer attributes and existing email opt-out',async()=>{
  const l=await lead();const c=(await db.query<{id:string}>("insert into customers(name,email,normalized_email,phone,normalized_phone,razorpay_customer_id) values('Commerce Name',$1,$1,$2,$2,'cust_preserved') returning id",[l.email,'+91'+l.phone])).rows[0].id;
  await db.query("insert into communication_preferences(customer_id,channel,purpose,allowed,source,evidence) values($1,'EMAIL','MARKETING',false,'UNSUBSCRIBE','{\"reference\":\"keep\"}')",[c]);
  expect((await connect(l.id)).status).toBe('opted_out');
  expect((await db.query<any>('select name,razorpay_customer_id from customers where id=$1',[c])).rows[0]).toEqual({name:'Commerce Name',razorpay_customer_id:'cust_preserved'});
  expect((await db.query<any>('select allowed,source,evidence from communication_preferences where customer_id=$1',[c])).rows[0]).toEqual({allowed:false,source:'UNSUBSCRIBE',evidence:{reference:'keep'}});
  expect((await db.query('select * from integration_outbox where lead_id=$1',[l.id])).rows).toHaveLength(0);
 });
 it('honors a legacy unsubscribed lead even before a canonical preference exists',async()=>{
  const l=await lead();await db.query("update um_leads set status='unsubscribed' where id=$1",[l.id]);
  expect((await connect(l.id)).status).toBe('opted_out');
  expect((await db.query('select * from customers where normalized_email=$1',[l.email])).rows).toHaveLength(0);
 });
 it('rejects split email/phone identities without changing either customer',async()=>{
  const l=await lead();await db.query("insert into customers(name,normalized_email) values('Email owner',$1)",[l.email]);await db.query("insert into customers(name,normalized_phone) values('Phone owner',$1)",['+91'+l.phone]);
  await expect(connect(l.id)).rejects.toThrow('CUSTOMER_IDENTITY_CONFLICT');
  expect((await db.query('select * from communication_lead_customers where lead_id=$1',[l.id])).rows).toHaveLength(0);
 });
 it('rolls back customer, consent, mapping and intent if outbox insertion fails',async()=>{
  const l=await lead();await db.exec("create function fail_welcome_outbox() returns trigger language plpgsql as $$begin raise exception 'TEST_OUTBOX_FAILURE';end$$;create trigger fail_welcome before insert on integration_outbox for each row execute function fail_welcome_outbox();");
  try{await expect(connect(l.id)).rejects.toThrow('TEST_OUTBOX_FAILURE');}finally{await db.exec('drop trigger fail_welcome on integration_outbox;drop function fail_welcome_outbox();');}
  expect((await db.query('select * from customers where normalized_email=$1',[l.email])).rows).toHaveLength(0);
  expect((await db.query('select * from communication_lead_customers where lead_id=$1',[l.id])).rows).toHaveLength(0);
 });
 it('executes successfully using the actual service-role privilege boundary',async()=>{
  const l=await lead();await db.exec('set role service_role');
  try{expect((await connect(l.id)).status).toBe('connected');}finally{await db.exec('reset role');}
 });
 it('keeps all new tables behind RLS and denies browser RPC execution',async()=>{
  expect((await db.query<{relrowsecurity:boolean}>("select relrowsecurity from pg_class where relname in ('communication_lead_customers','communication_welcome_intents')")).rows).toEqual([{relrowsecurity:true},{relrowsecurity:true}]);
  expect((await db.query<any>("select has_function_privilege('anon','comm_connect_lead_welcome(uuid)','execute') anon,has_function_privilege('authenticated','comm_connect_lead_welcome(uuid)','execute') authenticated,has_function_privilege('service_role','comm_connect_lead_welcome(uuid)','execute') service")).rows[0]).toEqual({anon:false,authenticated:false,service:true});
 });
});
