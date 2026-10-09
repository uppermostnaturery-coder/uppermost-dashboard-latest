import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
let db: PGlite;
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create role anon;create role authenticated;create role service_role;
    create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql as $$select null::uuid$$;
    create table public.analytics_visitors(visitor_id text primary key,current_session_id text,last_seen_at timestamptz default now(),is_online boolean default true,device_type text,browser text,os text,time_zone text);
    create table public.analytics_sessions(session_id text primary key,visitor_id text,last_seen_at timestamptz default now(),is_online boolean default true,is_active boolean default true,device_type text,browser text,os text,time_zone text);
    create table public.analytics_events(id bigint generated always as identity primary key,visitor_id text,session_id text,event_name text,metadata jsonb,created_at timestamptz,page_url text,page_path text,page_title text);`);
  await db.exec(`alter table analytics_visitors add country text,add city text,add region text,add ip_timezone text,add referrer text,add utm_source text,add utm_medium text,add utm_campaign text;
    alter table analytics_sessions add country text,add city text,add region text,add ip_timezone text,add referrer text,add utm_source text,add utm_medium text,add utm_campaign text,add source text,add medium text,add campaign text;
    alter table analytics_events add device_type text,add time_zone text,add country text,add city text,add region text,add ip_timezone text;`);
  await db.exec("create table whatsapp_messages(id uuid primary key default gen_random_uuid(),status text check(status in ('queued','sent','delivered','read','failed')));");
  for (const file of readdirSync("supabase/migrations").filter((v) => v.endsWith(".sql")).sort()) {
    const sql = readFileSync(join("supabase/migrations", file), "utf8").replace(/create extension if not exists pgcrypto;/gi, "");
    try { await db.exec(sql); } catch (e) { throw new Error(`Migration ${file}: ${e instanceof Error ? e.message : e}`); }
  }
}, 60000);
afterAll(async () => { await db?.close(); });
describe("durable SQL boundaries", () => {
  it('normalizes WhatsApp STOP phone identity using the commerce E164 convention',async()=>{
    const c='89000000-0000-4000-8000-000000000001';await db.query("insert into customers(id,name,normalized_email,normalized_phone) values($1,'Stop','stop@example.test','+919876543219')",[c]);
    await db.query("select comm_phone_opt_out('919876543219','WHATSAPP')");
    expect((await db.query('select allowed from communication_preferences where customer_id=$1 and channel=\'WHATSAPP\'',[c])).rows).toEqual([{allowed:false}]);
  });
  it('quarantines exhausted transport work without claiming or losing it',async()=>{
    const e=await db.query<{id:string}>("insert into integration_outbox(provider,operation,aggregate_id,idempotency_key,event_type,attempt_count) values('COMMUNICATIONS','EVENT','exhausted','test-exhausted','test.event',20) returning id");
    await db.query('select * from comm_claim_outbox(50)');
    expect((await db.query('select status,transport_status,last_error_code from integration_outbox where id=$1',[e.rows[0].id])).rows[0]).toMatchObject({status:'failed',transport_status:'FAILED_PERMANENT',last_error_code:'TRANSPORT_ATTEMPTS_EXHAUSTED'});
  });
  it('bounds historical state recovery and never queues historical campaigns',async()=>{
    await expect(db.query("select comm_recover_state('orders;drop table orders',false)")).rejects.toThrow('INVALID_RECOVERY_SOURCE');
    for(const source of ['subscriptions','payments','shipments'])expect((await db.query<{n:number}>('select comm_recover_state($1,false) n',[source])).rows[0].n).toBe(0);
    const c='84000000-0000-4000-8000-000000000001';await db.query("insert into customers(id,name,normalized_email) values($1,'Recovery','recovery@example.test')",[c]);
    await db.query("insert into orders(customer_id,status,subtotal_paise,total_paise,address_snapshot,pricing_snapshot) select $1,'CONFIRMED',10000,10000,'{}','{}' from generate_series(1,101)",[c]);
    expect((await db.query<{n:number}>("select comm_recover_state('orders',true) n")).rows[0].n).toBe(100);
    expect((await db.query<{n:number}>("select comm_recover_state('orders',false) n")).rows[0].n).toBe(1);
    const events=await db.query<{id:string;payload:{projection_only:boolean}}>('select id,payload from integration_outbox where customer_id=$1',[c]);expect(events.rows).toHaveLength(101);expect(events.rows.every(e=>e.payload.projection_only)).toBe(true);
    for(const e of events.rows)await db.query('select comm_apply_projection($1)',[e.id]);
    expect(Number((await db.query<{order_count:number}>('select order_count from communication_customer_features where customer_id=$1',[c])).rows[0].order_count)).toBe(101);
    await db.query("select comm_recover_state('orders',true)");expect((await db.query('select id from integration_outbox where customer_id=$1',[c])).rows).toHaveLength(101);
  });
  it('persists a commerce message even when downstream outbox insertion fails',async()=>{
    const c='83000000-0000-4000-8000-000000000001';await db.query("insert into customers(id,name,normalized_email) values($1,'Isolation','isolation@example.test')",[c]);
    await db.exec("create function private.test_outbox_down() returns trigger language plpgsql as $$begin raise exception 'outbox down';end$$;create trigger test_outbox_down before insert on integration_outbox for each row execute function private.test_outbox_down();");
    try{expect((await db.query("insert into customer_messages(customer_id,message_key,title,body,severity) values($1,'ISOLATION','Order','Order','INFO') returning id",[c])).rows).toHaveLength(1);}finally{await db.exec('drop trigger test_outbox_down on integration_outbox;drop function private.test_outbox_down();');}
  });
  it('isolates shared-device behavior and keeps technical session dimensions',async()=>{
    const a='80000000-0000-4000-8000-000000000001',b='80000000-0000-4000-8000-000000000002',v='v_123e4567-e89b-42d3-a456-426614174099',s='s_123e4567-e89b-42d3-a456-426614174099';
    await db.query("insert into customers(id,name,normalized_email) values($1,'Device A','device-a@example.test'),($2,'Device B','device-b@example.test')",[a,b]);
    await db.query('select link_analytics_identity($1,$2,$3)',[v,s,a]);
    const at=new Date().toISOString();
    await db.query('select ingest_analytics_batch($1)',[JSON.stringify({visitorId:v,sessionId:s,device_type:'mobile',browser:'Safari',os:'iOS',timezone:'Asia/Kolkata',events:[{event_name:'product_view',created_at:at,metadata:{product_code:'PRIVATE_A'}},{event_name:'add_to_cart',created_at:at,metadata:{cart_value_paise:42000}}]})]);
    await db.query('select link_analytics_identity($1,$2,$3)',[v,s,b]);
    await db.query('select ingest_analytics_batch($1)',[JSON.stringify({visitorId:v,sessionId:s,events:[{event_name:'product_view',created_at:at,metadata:{product_code:'DELAYED_A'}}]})]);
    const feature=(await db.query<{last_product_view:string|null;cart_value_paise:number}>('select last_product_view,cart_value_paise from communication_customer_features where customer_id=$1',[b])).rows[0];
    expect(feature.last_product_view).toBeNull();expect(Number(feature.cart_value_paise)).toBe(0);
    const session=(await db.query<{device_type:string;browser:string;os:string;time_zone:string;is_active:boolean}>('select * from analytics_sessions where session_id=$1',[s])).rows[0];
    expect(session).toMatchObject({device_type:'mobile',browser:'Safari',os:'iOS',time_zone:'Asia/Kolkata',is_active:true});
    await db.query('select ingest_analytics_batch($1)',[JSON.stringify({visitorId:v,sessionId:s,is_online:false,country:'India',utm_source:'campaign',events:[]})]);
    expect((await db.query('select is_online,is_active,country,source from analytics_sessions where session_id=$1',[s])).rows[0]).toMatchObject({is_online:false,is_active:false,country:'India',source:'campaign'});
  });
  it('replays an early provider callback once the provider ID is persisted',async()=>{
    const c='81000000-0000-4000-8000-000000000001';
    await db.query("insert into customers(id,name,normalized_email) values($1,'Callback','callback@example.test')",[c]);
    const m=(await db.query<{id:string}>("insert into customer_messages(customer_id,message_key,title,body,severity) values($1,'CALLBACK','Callback','Callback','INFO') returning id",[c])).rows[0].id;
    const d=(await db.query<{id:string}>("insert into message_deliveries(customer_message_id,channel,provider,status,attempt_number) values($1,'EMAIL','BREVO','SENDING',1) returning id",[m])).rows[0].id;
    await db.query("select comm_provider_event('BREVO','early','provider-early','DELIVERED',now())");
    await db.query("select comm_accept_delivery($1,'provider-early',10)",[d]);
    expect((await db.query<{status:string}>('select status from message_deliveries where id=$1',[d])).rows[0].status).toBe('DELIVERED');
    await db.query("select comm_provider_event('BREVO','early','provider-early','DELIVERED',now())");
    expect((await db.query<{status:string}>('select status from message_deliveries where id=$1',[d])).rows[0].status).toBe('DELIVERED');
  });
  it('recovers OTP work before a provider attempt and quarantines ambiguous attempts',async()=>{
    const id='82000000-0000-4000-8000-000000000001';await db.query("select comm_create_otp($1,'919876543299',null,'hash','encrypted','ip2','identity2',300)",[id]);
    await db.query('select * from comm_claim_otp($1)',[id]);
    await db.query("update communication_otp_challenges set send_lease_until=now()-interval '1 second' where id=$1",[id]);
    expect((await db.query('select * from comm_claim_otp($1)',[id])).rows).toHaveLength(1);
    await db.query("update communication_otp_challenges set provider_attempted_at=now(),send_lease_until=now()-interval '1 second' where id=$1",[id]);
    expect((await db.query('select * from comm_claim_otp($1)',[id])).rows).toHaveLength(0);
    expect((await db.query<{send_state:string}>('select send_state from communication_otp_challenges where id=$1',[id])).rows[0].send_state).toBe('RECONCILIATION_PENDING');
  });
  it("keeps shared-browser history while retaining one current mapping", async () => {
    const a = "10000000-0000-4000-8000-000000000001", b = "10000000-0000-4000-8000-000000000002";
    await db.query("insert into customers(id,name,normalized_email) values($1,'A','a@example.test'),($2,'B','b@example.test')", [a,b]);
    const v = "v_123e4567-e89b-42d3-a456-426614174000";
    await db.query("select link_analytics_identity($1,null,$2)",[v,a]);
    await db.query("select link_analytics_identity($1,null,$2)",[v,a]);
    await db.query("select link_analytics_identity($1,null,$2)",[v,b]);
    const { rows } = await db.query<{ customer_id: string; is_current: boolean; valid_until: string | null }>("select customer_id,is_current,valid_until from analytics_identity_links where visitor_id=$1 order by linked_at",[v]);
    expect(rows).toHaveLength(2);expect(rows[0].is_current).toBe(false);expect(rows[0].valid_until).not.toBeNull();expect(rows[1].customer_id).toBe(b);
  });
  it("projects confirmation exactly once and preserves newer feature facts", async () => {
    const customer = "10000000-0000-4000-8000-000000000001";
    const e = await db.query<{id:string}>(`insert into integration_outbox(provider,operation,aggregate_id,idempotency_key,event_type,customer_id,payload) values('COMMUNICATIONS','EVENT','order','test-order','commerce.order.confirmed',$1,$2) returning id`,[customer,JSON.stringify({order_id:"20000000-0000-4000-8000-000000000001",at:"2026-10-07T00:00:00Z",total_paise:10000,discount_paise:0,product_codes:["GIR"],skus:["GIR500"]})]);
    await db.query("select comm_apply_projection($1)",[e.rows[0].id]);await db.query("select comm_apply_projection($1)",[e.rows[0].id]);
    const result = await db.query<{order_count:number;realized_spend_paise:number}>("select order_count,realized_spend_paise from communication_customer_features where customer_id=$1",[customer]);
    expect(result.rows[0].order_count).toBe(1);expect(Number(result.rows[0].realized_spend_paise)).toBe(10000);
  });
  it('deduplicates cron runs, recipient snapshots and durable delivery intents',async()=>{
    const template=await db.query<{id:string}>(`select comm_create_template_version($1,null) id`,[JSON.stringify({logical_key:'TEST_ORDER',name:'Order',category:'TRANSACTIONAL',channel:'EMAIL',subject:'Order',html_content:'<p>Order</p>',text_content:'Order',structured_content:{},parameter_schema:{},change_reason:'Test'})]);
    await db.query('select comm_activate_template($1)',[template.rows[0].id]);
    const r=await db.query<{id:string}>(`insert into communication_rules(name,status,trigger_type,condition_config,action_config,next_run_at) values('Test','ACTIVE','SCHEDULE',$1,$2,now()-interval '1 minute') returning id`,[JSON.stringify({field:'order_count',op:'eq',value:1}),JSON.stringify({templates:{EMAIL:template.rows[0].id}})]);
    const slot=(await db.query<{next_run_at:string}>('select next_run_at from communication_rules where id=$1',[r.rows[0].id])).rows[0].next_run_at;
    const args=[r.rows[0].id,slot,'2027-01-01T00:00:00Z','same-slot'];
    const first=await db.query<{id:string}>('select comm_start_run($1,$2,$3,$4,true,null) id',args);const duplicate=await db.query<{id:string|null}>('select comm_start_run($1,$2,$3,$4,true,null) id',args);
    expect(duplicate.rows[0].id).toBeNull();
    await db.query('select comm_snapshot_batch($1)',[first.rows[0].id]);await db.query('select comm_prepare_recipients($1)',[first.rows[0].id]);await db.query('select comm_prepare_recipients($1)',[first.rows[0].id]);
    const deliveries=await db.query<{id:string}>('select id from message_deliveries where dedupe_key is not null');expect(deliveries.rows).toHaveLength(1);
    expect((await db.query('select * from comm_claim_delivery($1)',[deliveries.rows[0].id])).rows).toHaveLength(1);
    expect((await db.query('select * from comm_claim_delivery($1)',[deliveries.rows[0].id])).rows).toHaveLength(0);
  });
  it('keeps approved WhatsApp content live while its next version is pending',async()=>{
    const input={logical_key:'TEST_WHATSAPP',name:'WhatsApp',category:'TRANSACTIONAL',channel:'WHATSAPP',structured_content:{},parameter_schema:{},change_reason:'Test'};
    const create=async()=> (await db.query<{id:string}>('select comm_create_template_version($1,null) id',[JSON.stringify(input)])).rows[0].id;
    const first=await create();await db.query("update communication_template_provider_artifacts set provider_status='APPROVED' where template_version_id=$1",[first]);await db.query('select comm_activate_template($1)',[first]);
    const pending=await create();await expect(db.query('select comm_activate_template($1)',[pending])).rejects.toThrow('PROVIDER_APPROVAL_REQUIRED');
    expect((await db.query<{status:string}>('select status from communication_template_versions where id=$1',[first])).rows[0].status).toBe('ACTIVE');
    await expect(db.query("update communication_template_versions set text_content='changed' where id=$1",[first])).rejects.toThrow('IMMUTABLE_TEMPLATE_VERSION');
  });
  it('rejects reuse of a Lemlist campaign by another immutable version',async()=>{
    const input={logical_key:'TEST_LEMLIST',name:'Lemlist',category:'MARKETING',channel:'LEMLIST',structured_content:{},parameter_schema:{},change_reason:'Test'};
    const create=async()=> (await db.query<{id:string}>('select comm_create_template_version($1,null) id',[JSON.stringify(input)])).rows[0].id;
    const first=await create(),next=await create();
    await db.query("update communication_template_provider_artifacts set lemlist_campaign_id='immutable-campaign' where template_version_id=$1",[first]);
    await expect(db.query("update communication_template_provider_artifacts set lemlist_campaign_id='immutable-campaign' where template_version_id=$1",[next])).rejects.toThrow();
  });
  it('correlates native Lemlist activity to the mapped campaign and stable step, including early callbacks',async()=>{
    const c='88000000-0000-4000-8000-000000000001';await db.query("insert into customers(id,name,normalized_email) values($1,'Native','native@example.test')",[c]);
    const v=(await db.query<{id:string}>('select comm_create_template_version($1,null) id',[JSON.stringify({logical_key:'NATIVE_LEMLIST',name:'Native',category:'MARKETING',channel:'LEMLIST',structured_content:{},parameter_schema:{},change_reason:'Native'})])).rows[0].id;
    await db.query("update communication_template_provider_artifacts set lemlist_campaign_id='native-campaign',lemlist_step_id='native-step' where template_version_id=$1",[v]);
    const m=(await db.query<{id:string}>("insert into customer_messages(customer_id,message_key,title,body,severity) values($1,'NATIVE','Native','Native','INFO') returning id",[c])).rows[0].id;
    const d=(await db.query<{id:string}>("insert into message_deliveries(customer_message_id,channel,provider,status,template_version_id,dedupe_key) values($1,'LEMLIST','LEMLIST','SENDING',$2,'native-correlation') returning id",[m,v])).rows[0].id;
    await db.query("select comm_provider_event('LEMLIST','native-wrong','native-lead','OPENED',now(),null,'native-campaign','other-step')");
    await db.query("select comm_accept_delivery($1,'native-lead',1)",[d]);expect((await db.query<{status:string}>('select status from message_deliveries where id=$1',[d])).rows[0].status).toBe('ACCEPTED');
    await db.query("select comm_provider_event('LEMLIST','native-correct','native-lead','OPENED',now(),null,'native-campaign','native-step')");
    expect((await db.query<{status:string}>('select status from message_deliveries where id=$1',[d])).rows[0].status).toBe('OPENED');
  });
  it('enforces one-use OTP verification, attempt limits and one challenge across fallback',async()=>{
    const challenge='30000000-0000-4000-8000-000000000001';await db.query("select comm_create_otp($1,'919876543210','otp@example.test','hash','encrypted','ip','identity',300)",[challenge]);
    await db.query('select * from comm_claim_otp($1)',[challenge]);await db.query("select comm_finish_otp($1,false,'FALLBACK')",[challenge]);
    expect((await db.query<{send_channel_index:number}>('select send_channel_index from communication_otp_challenges where id=$1',[challenge])).rows[0].send_channel_index).toBe(1);
    expect((await db.query<{ok:boolean}>("select comm_verify_otp($1,'hash') ok",[challenge])).rows[0].ok).toBe(true);
    expect((await db.query<{ok:boolean}>("select comm_verify_otp($1,'hash') ok",[challenge])).rows[0].ok).toBe(false);
    await expect(db.query("select comm_create_otp(gen_random_uuid(),'919876543210',null,'hash','encrypted','ip','identity',300)")).rejects.toThrow('OTP_RESEND_COOLDOWN');
  });
  it('rejects stale promotion edits and preserves immutable version snapshots',async()=>{
    const v={code:'TEST_OFFER',label:'Offer',status:'DRAFT',conditions:{},actions:[{type:'PERCENT_OFF',percent:10}],priority:1,stackable:false};
    const created=await db.query<{id:string;version:number}>('select * from comm_save_promotion(null,null,$1,null,\'Created\')',[JSON.stringify(v)]);const offer=created.rows[0];
    await db.query('select comm_save_promotion($1,1,$2,null,\'Changed\')',[offer.id,JSON.stringify({...v,label:'Changed'})]);
    await expect(db.query('select comm_save_promotion($1,1,$2,null,\'Stale\')',[offer.id,JSON.stringify(v)])).rejects.toThrow('PROMOTION_VERSION_CONFLICT');
    expect((await db.query('select * from promotion_versions where promotion_id=$1',[offer.id])).rows).toHaveLength(2);
  });
  it('keeps OR audiences inside the event subject and keyset bounds',async()=>{
    const a='90000000-0000-4000-8000-000000000001',b='90000000-0000-4000-8000-000000000002';
    await db.query("insert into customers(id,name,normalized_email) values($1,'OR A','or-a@example.test'),($2,'OR B','or-b@example.test')",[a,b]);
    await db.query('insert into communication_customer_features(customer_id,order_count) values($1,8),($2,0)',[a,b]);
    const condition={any:[{field:'order_count',op:'gte',value:7},{field:'order_count',op:'gte',value:0}]};
    const subject=await db.query<{customer_id:string}>('select customer_id from comm_audience($1,null,500,$2)',[JSON.stringify(condition),b]);expect(subject.rows.map(r=>r.customer_id)).toEqual([b]);
    const cursor=await db.query<{customer_id:string}>('select customer_id from comm_audience($1,$2,500,$2)',[JSON.stringify(condition),b]);expect(cursor.rows).toHaveLength(0);
  });
  it("queries bounded features using keysets even for a large synthetic audience", async () => {
    await db.exec(`insert into customers(id,name,normalized_email) select md5(i::text)::uuid,'Synthetic',i||'@example.test' from generate_series(1,500000) i;
      insert into communication_customer_features(customer_id,last_order_at,order_count) select id,now()-interval '60 days',2 from customers on conflict do nothing;analyze communication_customer_features;`);
    const batch = await db.query<{customer_id:string}>("select customer_id from comm_audience($1,null,1000000,null)",[JSON.stringify({field:"last_order_at",op:"days_since_gte",value:30})]);
    expect(batch.rows).toHaveLength(500);
    const next = await db.query<{customer_id:string}>("select customer_id from comm_audience($1,$2,500,null)",[JSON.stringify({all:[]}),batch.rows[499].customer_id]);
    expect(next.rows).toHaveLength(500);expect(next.rows[0].customer_id>batch.rows[499].customer_id).toBe(true);
    const plan = await db.query(`explain (analyze,buffers,format json) select customer_id from communication_customer_features where customer_id>'f0000000-0000-0000-0000-000000000000' and last_order_at<now()-interval '30 days' order by customer_id limit 500`);
    const tree = JSON.stringify(plan.rows);expect(tree).toMatch(/Index/);expect(tree).not.toMatch(/orders|analytics_events/);
    await import("node:fs/promises").then((fs) => fs.writeFile("docs/communication-query-plan.json",JSON.stringify(plan.rows,null,2)));
  },60000);
  it('locks down browser analytics only in the separately gated rollout step',async()=>{
    await db.exec(`alter table analytics_visitors enable row level security;alter table analytics_sessions enable row level security;alter table analytics_events enable row level security;
      grant select,insert,update on analytics_events,analytics_visitors,analytics_sessions to anon;
      create policy old_public_read on analytics_events for select using(true);`);
    await db.exec(readFileSync('supabase/manual/analytics_lockdown_after_gtm_rollout.sql','utf8'));
    await db.exec('set role anon');
    try{await expect(db.query('select * from analytics_events limit 1')).rejects.toThrow('permission denied');await expect(db.query("update analytics_visitors set is_online=false")).rejects.toThrow('permission denied');await expect(db.query('select * from analytics_identity_links')).rejects.toThrow('permission denied');}finally{await db.exec('reset role');}
    await db.exec('set role authenticated');
    try{expect((await db.query('select * from analytics_events limit 1')).rows).toHaveLength(0);}finally{await db.exec('reset role');}
  });
});
