import {PGlite} from '@electric-sql/pglite';
import {readFileSync,readdirSync} from 'node:fs';
import {beforeAll,afterAll,describe,it,expect} from 'vitest';
let db:PGlite;let sequence=0;
async function lead(extra:Record<string,unknown>={}){
 const n=++sequence;const row={email:`wa${n}@example.test`,phone:`90000${String(n).padStart(5,'0')}`,first_name:'Customer',consent_whatsapp:true,metadata:{lead_stage:'completed'},...extra};
 const values=[row.email,row.phone,row.first_name,row.consent_whatsapp,JSON.stringify(row.metadata)];
 return (await db.query<{id:string}>('insert into um_leads(email,phone,first_name,consent_whatsapp,consent_recorded_at,metadata) values($1,$2,$3,$4,now(),$5) returning id',values)).rows[0].id;
}
const connect=async(id:string)=>(await db.query<{result:any}>('select comm_connect_whatsapp_welcome($1) result',[id])).rows[0].result;
beforeAll(async()=>{
 db=new PGlite();
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql as $$select null::uuid$$;
 create table analytics_visitors(visitor_id text primary key,current_session_id text,last_seen_at timestamptz default now(),is_online boolean default true,device_type text,browser text,os text,time_zone text,country text,city text,region text,ip_timezone text,referrer text,utm_source text,utm_medium text,utm_campaign text);
 create table analytics_sessions(session_id text primary key,visitor_id text,last_seen_at timestamptz default now(),is_online boolean default true,is_active boolean default true,device_type text,browser text,os text,time_zone text,country text,city text,region text,ip_timezone text,referrer text,utm_source text,utm_medium text,utm_campaign text,source text,medium text,campaign text);
 create table analytics_events(id bigint generated always as identity primary key,visitor_id text,session_id text,event_name text,metadata jsonb,created_at timestamptz,page_url text,page_path text,page_title text,device_type text,time_zone text,country text,city text,region text,ip_timezone text);
 create table um_leads(id uuid primary key default gen_random_uuid(),email text not null,phone text,first_name text,last_name text,status text default 'new',consent_email boolean default false,consent_whatsapp boolean default false,consent_recorded_at timestamptz,metadata jsonb default '{}');
 create table whatsapp_messages(id uuid primary key default gen_random_uuid(),lead_id uuid,email text,phone text,template_name text,template_language text,status text,meta_message_id text,created_at timestamptz default now(),sent_at timestamptz,delivered_at timestamptz,read_at timestamptz,failed_at timestamptz);
 grant select,update on um_leads to service_role;`);
 for(const file of readdirSync('supabase/migrations').filter(f=>f.endsWith('.sql')).sort())await db.exec(readFileSync('supabase/migrations/'+file,'utf8').replace(/create extension if not exists pgcrypto;/gi,''));
},60000);
afterAll(async()=>db?.close());
describe('durable WhatsApp welcome and consent',()=>{
 it('deduplicates concurrent signups by phone and creates independent WhatsApp consent',async()=>{
  const id=await lead();const results=await Promise.all([connect(id),connect(id),connect(id)]);expect(results.map(r=>r.status)).toEqual(['pending','already_connected','already_connected']);
  expect((await db.query('select * from communication_whatsapp_welcome_intents where lead_id=$1',[id])).rows).toHaveLength(1);
  expect((await db.query("select channel,purpose,allowed from communication_preferences where customer_id=$1",[results[0].customer_id])).rows).toEqual([{channel:'WHATSAPP',purpose:'MARKETING',allowed:true}]);
  expect((await db.query("select count(*)::int n from integration_outbox where event_type='lead.whatsapp.completed'")).rows[0]).toEqual({n:0});
 });
 it.each([{consent_whatsapp:false},{metadata:{lead_stage:'email_completed'}},{phone:null}])('rejects ineligible signup %j',async extra=>{expect((await connect(await lead(extra))).status).toBe('ineligible');});
 it('honors STOP received before a customer exists and never restores permission on resubmission',async()=>{
  const id=await lead({phone:'919000012345'});await db.query("select comm_phone_opt_out('919000012345','WHATSAPP')");expect((await connect(id)).status).toBe('opted_out');
 });
 it('preserves a customer WhatsApp opt-out and does not depend on email consent',async()=>{
  const id=await lead();const r=await connect(id);await db.query("update communication_preferences set allowed=false,source='PROVIDER_OPTOUT' where customer_id=$1",[r.customer_id]);
  expect((await connect(id)).status).toBe('opted_out');
 });
 it('accepts explicitly consented launch signups but not implicitly consented ones',async()=>{
  expect((await connect(await lead({metadata:{lead_stage:'launch_waitlist'}}))).status).toBe('pending');
  expect((await connect(await lead({consent_whatsapp:false,metadata:{lead_stage:'launch_waitlist'}}))).status).toBe('ineligible');
 });
 it('withdraws WhatsApp permission after queuing and does not regrant it on a later signup',async()=>{
  const id=await lead();const result=await connect(id);
  await db.query("update communication_whatsapp_welcome_intents set status='QUEUED' where lead_id=$1",[id]);
  await db.query('update um_leads set consent_whatsapp=false where id=$1',[id]);
  expect((await db.query<{allowed:boolean}>('select comm_whatsapp_marketing_allowed($1) allowed',[result.customer_id])).rows[0].allowed).toBe(false);
  expect((await connect(id)).status).toBe('opted_out');
  expect((await db.query('select allowed from communication_preferences where customer_id=$1',[result.customer_id])).rows[0]).toEqual({allowed:false});
  await db.query('update um_leads set consent_whatsapp=true where id=$1',[id]);expect((await connect(id)).status).toBe('opted_out');
 });
 it('retains draft-time welcome intent as suppressed audit history without catch-up',async()=>{
  const id=await lead();await connect(id);expect((await db.query<{n:number}>('select comm_dispatch_whatsapp_welcomes(50,true) n')).rows[0].n).toBe(0);
  expect((await db.query('select status from communication_whatsapp_welcome_intents where lead_id=$1',[id])).rows[0]).toEqual({status:'SUPPRESSED'});
 });
 it('keeps the new tables and RPC service-only',async()=>{
  expect((await db.query("select has_function_privilege('anon','comm_connect_whatsapp_welcome(uuid)','execute') a,has_function_privilege('authenticated','comm_connect_whatsapp_welcome(uuid)','execute') b")).rows[0]).toEqual({a:false,b:false});
 });
 it('executes connection through the actual service-role boundary and preserves commercial identity',async()=>{
  const id=await lead();await db.exec('set role service_role');let result:any;
  try{result=await connect(id);}finally{await db.exec('reset role');}
  expect(result.status).toBe('pending');
  await db.query("update customers set name='Existing commerce name',razorpay_customer_id='cust_preserved' where id=$1",[result.customer_id]);await connect(id);
  expect((await db.query('select name,razorpay_customer_id from customers where id=$1',[result.customer_id])).rows[0]).toEqual({name:'Existing commerce name',razorpay_customer_id:'cust_preserved'});
 });
 it('rejects split email and phone identities atomically',async()=>{
  const id=await lead({email:'split-wa@example.test',phone:'919111111111'});
  await db.query("insert into customers(name,normalized_email) values('Email owner','split-wa@example.test')");await db.query("insert into customers(name,normalized_phone) values('Phone owner','+919111111111')");
  await expect(connect(id)).rejects.toThrow('CUSTOMER_IDENTITY_CONFLICT');expect((await db.query('select * from communication_whatsapp_welcome_intents where lead_id=$1',[id])).rows).toHaveLength(0);
 });
 it('uses one canonical message/delivery through the existing engine and replays early callbacks',async()=>{
  const id=await lead();
  const version=(await db.query<{id:string}>("select comm_create_template_version($1,null) id",[JSON.stringify({logical_key:'WA_UNIT_TEST',name:'WhatsApp welcome',channel:'WHATSAPP',category:'MARKETING',text_content:'Hello {{1}}',structured_content:{components:[{type:'BODY',text:'Hello {{1}}'}]},parameter_schema:{required:['name'],body_parameters:['name']},change_reason:'Unit test'})])).rows[0].id;
  await db.query("update communication_template_provider_artifacts set provider_status='APPROVED',provider_template_name='test_welcome',provider_language='en' where template_version_id=$1",[version]);await db.query('select comm_activate_template($1)',[version]);
  const rule=(await db.query<{id:string}>("insert into communication_rules(name,status,trigger_type,trigger_event_type,condition_config,action_config,quiet_hours) values('UPPERMOST_WHATSAPP_WELCOME_V1','ACTIVE','EVENT','lead.whatsapp.completed',$1,$2,'{\"start\":0,\"end\":0}') returning id",[JSON.stringify({all:[{field:'whatsapp_marketing_allowed',op:'eq',value:true}]}),JSON.stringify({templates:{WHATSAPP:version}})])).rows[0].id;
  await db.query("update communication_rules set approved_at=now()-interval '1 minute' where id=$1",[rule]);
  const connected=await connect(id);
  expect((await db.query<{n:number}>('select comm_dispatch_whatsapp_welcomes(50,true) n')).rows[0].n).toBeGreaterThan(0);
  const intent=(await db.query<{run_id:string}>('select run_id from communication_whatsapp_welcome_intents where lead_id=$1',[id])).rows[0];
  await db.query('select comm_snapshot_batch($1)',[intent.run_id]);await db.query('select comm_prepare_recipients($1)',[intent.run_id]);await db.query('select comm_prepare_recipients($1)',[intent.run_id]);
  const deliveries=(await db.query<{id:string;lead_id:string}>('select id,lead_id from message_deliveries where lead_id=$1',[id])).rows;expect(deliveries).toHaveLength(1);expect(deliveries[0].lead_id).toBe(id);
  await db.query('select * from comm_claim_delivery($1)',[deliveries[0].id]);await db.query("select comm_provider_event('META_WHATSAPP','early-wa','wamid.early','READ',now())");await db.query("select comm_accept_delivery($1,'wamid.early',10)",[deliveries[0].id]);await db.query("select comm_provider_event('META_WHATSAPP','late-wa','wamid.early','SENT',now())");
  expect((await db.query('select status from message_deliveries where id=$1',[deliveries[0].id])).rows[0]).toEqual({status:'READ'});
  await db.query("select comm_phone_opt_out((select phone from um_leads where id=$1),'WHATSAPP')",[id]);expect((await db.query<{allowed:boolean}>('select comm_whatsapp_marketing_allowed($1) allowed',[connected.customer_id])).rows[0].allowed).toBe(false);
  expect((await connect(id)).status).toBe('opted_out');await db.query("update communication_rules set status='DRAFT' where id=$1",[rule]);
 });
 it('updates legacy delivery history monotonically and retains unknown early callbacks',async()=>{
  const legacy=(await db.query<{id:string}>("insert into whatsapp_messages(meta_message_id,status) values('legacy-id','sent') returning id")).rows[0].id;
  await db.query("select comm_whatsapp_legacy_event('legacy-id','READ','2026-10-29T10:00:00Z')");await db.query("select comm_whatsapp_legacy_event('legacy-id','SENT','2026-10-29T09:00:00Z')");
  expect((await db.query('select status,read_at is not null as read from whatsapp_messages where id=$1',[legacy])).rows[0]).toEqual({status:'read',read:true});
 });
 it('prepares all nine independent drafts idempotently without provider approval or scheduling',async()=>{
  await db.query('select comm_create_template_version($1,null)',[JSON.stringify({logical_key:'UPPERMOST_WELCOME_V1',name:'Welcome',channel:'WHATSAPP',category:'MARKETING',text_content:'Hello {{1}}',structured_content:{components:[{type:'BODY',text:'Hello {{1}}'}]},parameter_schema:{required:['name'],body_parameters:['name']},change_reason:'Fixture'})]);
  const sql=readFileSync('supabase/manual/prepare_staging_whatsapp_drafts.sql','utf8');await db.exec(sql);await db.exec(sql);
  const rules=(await db.query<{status:string;next_run_at:string|null}>("select status,next_run_at from communication_rules where name like 'UPPERMOST_WHATSAPP_%'")).rows;
  expect(rules).toHaveLength(9);expect(rules.every(r=>r.status==='DRAFT'&&r.next_run_at===null)).toBe(true);
  expect((await db.query("select count(*)::int n from communication_template_versions v join communication_templates t on t.id=v.template_id where t.logical_key like 'UPPERMOST_WHATSAPP_%'")).rows[0]).toEqual({n:8});
 });
});
