import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';

type TestRow=Record<string,unknown>&{id:string;status:string;payload:Record<string,unknown>;next_attempt_at?:string|null;attempt_count?:number};
type TestResult={data:unknown;error:{message:string}|null};
interface TestQuery {
 select():TestQuery;eq(k:string,v:unknown):TestQuery;neq(k:string,v:unknown):TestQuery;
 lte():TestQuery;lt():TestQuery;in():TestQuery;order():TestQuery;limit():TestQuery;
 update(v:Partial<TestRow>):TestQuery;upsert(v:Partial<TestRow>,options:unknown):TestQuery;
 single():Promise<TestResult>;then(resolve:(r:TestResult)=>unknown):Promise<unknown>;
}
const state=vi.hoisted(()=>({
 rows:new Map<string,TestRow>(),runs:new Set<string>(),rpc:vi.fn(),
 rulesError:false,writeError:false,whatsappWriteError:false,sequence:0,
}));
vi.mock('../../lib/communications/store',()=>({
 db:{from:(table:string)=>{
  let value:TestRow|undefined;let mutation:Partial<TestRow>|undefined;let insert:Partial<TestRow>|undefined;
  const filters:[string,unknown,boolean][]=[];
  const result=()=>{
   if(table==='communication_rules')return {data:[],error:state.rulesError?{message:'routing unavailable'}:null};
   if(insert){
    if(state.writeError||state.whatsappWriteError)return {data:null,error:{message:'write unavailable'}};
    if(![...state.rows.values()].some(r=>r.idempotency_key===insert!.idempotency_key)){
     const id=`child-${++state.sequence}`;state.rows.set(id,{id,event_id:id,status:'pending',attempt_count:1,payload:{},...insert});
    }
   }
   if(mutation){
    if(state.writeError)return {data:null,error:{message:'write unavailable'}};
    for(const row of state.rows.values())if(filters.every(([k,v,neq])=>neq?row[k]!==v:row[k]===v))Object.assign(row,mutation);
   }
   if(table==='integration_outbox'&&!mutation&&!insert)value=[...state.rows.values()].find(r=>filters.every(([k,v,neq])=>neq?r[k]!==v:r[k]===v));
   return {data:value||[],error:null};
  };
  const q:TestQuery={select:()=>q,eq:(k:string,v:unknown)=>{filters.push([k,v,false]);return q;},neq:(k:string,v:unknown)=>{filters.push([k,v,true]);return q;},
   lte:()=>q,lt:()=>q,in:()=>q,order:()=>q,limit:()=>q,
   update:(v:Partial<TestRow>)=>{mutation=v;return q;},upsert:(v:Partial<TestRow>,options:unknown)=>{expect(options).toEqual({onConflict:'idempotency_key',ignoreDuplicates:true});insert=v;return q;},
   single:async()=>result(),then:resolve=>Promise.resolve(result()).then(resolve),
  };
  // The active email rule is returned only for event routing.
  if(table==='communication_rules')q.then=resolve=>Promise.resolve({data:filters.some(([k,v])=>k==='trigger_type'&&v==='SCHEDULE')?[]:[{id:'email-rule',version:3,name:'EMAIL_ORDER'}],error:state.rulesError?{message:'routing unavailable'}:null}).then(resolve);
  return q;
 }},rpc:state.rpc,assertDb:(r:TestResult)=>{if(r.error)throw new Error(r.error.message);},
}));
vi.mock('../../lib/communications/transport',()=>({publishOutbox:vi.fn(async()=>({published:0,status:'READY'}))}));
import {consumeOutbox} from '../../lib/communications/consumer';
import {dispatchCommunications} from '../../lib/communications/rules';
import {publishOutbox} from '../../lib/communications/transport';

beforeEach(()=>{
 vi.stubEnv('VERCEL_ENV','preview');vi.stubEnv('VERCEL_GIT_COMMIT_REF','staging');
 vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL','https://jwsivyxapfnyaafdcdos.supabase.co');
 vi.stubEnv('COMMUNICATION_BASE_URL','https://staging.uppermost.store');vi.stubEnv('COMMUNICATION_DRY_RUN','true');
 vi.stubGlobal('fetch',vi.fn(()=>{throw new Error('REAL_NETWORK_FORBIDDEN');}));
 state.rows.clear();state.runs.clear();state.sequence=0;state.rulesError=false;state.writeError=false;state.whatsappWriteError=false;vi.mocked(publishOutbox).mockClear();
 state.rpc.mockReset().mockImplementation(async(name:string,args:Record<string,unknown>)=>{
  if(name==='comm_start_run'){state.runs.add(String(args.p_key));return 'run';}
  if(name==='comm_claim_delivery')return [{channel:'EMAIL',retry_count:0}];
  if(name.startsWith('comm_capture_whatsapp')||name.startsWith('comm_dispatch_whatsapp'))throw new Error('function missing; private details');
  return null;
 });
 state.rows.set('source',{id:'source',event_id:'verified-event',provider:'COMMUNICATIONS',operation:'EVENT',aggregate_id:'order',event_type:'commerce.order.confirmed',customer_id:'customer',payload:{order_id:'order'},status:'pending',attempt_count:1});
});
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();});
const children=()=>[...state.rows.values()].filter(r=>r.operation==='WHATSAPP_WORKFLOWS');

describe('independent channel orchestration',()=>{
 it('routes EMAIL while missing WhatsApp RPCs remain independently recoverable',async()=>{
  await consumeOutbox('source');
  expect(state.rows.get('source')?.status).toBe('completed');expect(state.runs.size).toBe(1);
  expect(children()).toHaveLength(1);
  const child=children()[0];await expect(consumeOutbox(child.id)).rejects.toThrow();
  expect(child).toMatchObject({status:'pending',transport_status:'FAILED_RETRYABLE',last_error_code:'WHATSAPP_WORKFLOW_PREPARATION_FAILED',attempt_count:1});
  expect(Date.parse(child.next_attempt_at!)).toBeGreaterThan(Date.now());
  expect(JSON.stringify(child)).not.toContain('private details');expect(state.rows.get('source')?.status).toBe('completed');
  // Existing SEND work still reaches its dry-run terminal outcome.
  state.rows.set('send',{id:'send',provider:'COMMUNICATIONS',operation:'SEND',aggregate_id:'email-delivery',status:'pending',payload:{}});
  state.rows.set('email-delivery',{id:'email-delivery',status:'SENDING',payload:{}});
  await consumeOutbox('send');expect(state.rows.get('email-delivery')?.status).toBe('DRY_RUN');expect(fetch).not.toHaveBeenCalled();
 });
 it('keeps EMAIL retry keys stable and creates only one WhatsApp child after partial routing',async()=>{
  state.rulesError=true;await expect(consumeOutbox('source')).rejects.toThrow('routing unavailable');
  expect(state.rows.get('source')?.status).toBe('pending');
  state.rulesError=false;await consumeOutbox('source');
  state.rows.get('source')!.status='processing';await consumeOutbox('source');
  expect(state.runs).toEqual(new Set(['event:verified-event:email-rule:3']));expect(children()).toHaveLength(1);
 });
 it('does not acknowledge shared persistence failure',async()=>{
  state.writeError=true;await expect(consumeOutbox('source')).rejects.toThrow('write unavailable');
  expect(state.rows.get('source')?.status).toBe('pending');expect(state.runs.size).toBe(1);
 });
 it('still publishes EMAIL work if the WhatsApp handoff cannot be persisted',async()=>{
  state.whatsappWriteError=true;await expect(dispatchCommunications()).rejects.toThrow('write unavailable');
  expect(publishOutbox).toHaveBeenCalledTimes(1);
 });
 it('dispatches general work without awaiting WhatsApp preparation and deduplicates the same tick',async()=>{
  vi.useFakeTimers();vi.setSystemTime(new Date('2026-11-03T12:00:00Z'));
  try{await dispatchCommunications();await dispatchCommunications();
   expect(children()).toHaveLength(2); // dispatch and legacy welcome have independent retry records
   expect(state.rpc.mock.calls.some(([n])=>n.startsWith('comm_dispatch_whatsapp')||n==='comm_capture_whatsapp_workflows')).toBe(false);
  }finally{vi.useRealTimers();}
 });
 it('recovers WhatsApp preparation without rerouting completed email work',async()=>{
  await consumeOutbox('source');const child=children()[0];await expect(consumeOutbox(child.id)).rejects.toThrow();
  child.next_attempt_at=new Date(0).toISOString();state.rpc.mockResolvedValue(1);
  await consumeOutbox(child.id);expect(child.status).toBe('completed');expect(child.last_error_code).toBeNull();expect(state.runs.size).toBe(1);
 });
 it('does not bypass database backoff on an immediate QStash redelivery',async()=>{
  await consumeOutbox('source');const child=children()[0];await expect(consumeOutbox(child.id)).rejects.toThrow();
  const next=child.next_attempt_at;state.rpc.mockClear();
  await expect(consumeOutbox(child.id)).rejects.toThrow('WHATSAPP_PREPARATION_RETRY_NOT_DUE');
  expect(state.rpc).not.toHaveBeenCalled();expect(child.next_attempt_at).toBe(next);
 });
 it('keeps dispatch failure separate from legacy welcome preparation',async()=>{
  await dispatchCommunications();const dispatch=children().find(r=>r.payload.phase==='DISPATCH')!;
  const welcome=children().find(r=>r.payload.phase==='WELCOME')!;
  state.rpc.mockImplementation(async(n:string,args:Record<string,unknown>)=>{if(n==='comm_dispatch_whatsapp_workflows')throw new Error('missing dispatch RPC');if(n==='comm_start_run')state.runs.add(String(args.p_key));return 1;});
  await expect(consumeOutbox(dispatch.id)).rejects.toThrow('missing dispatch RPC');
  await consumeOutbox(welcome.id);expect(welcome.status).toBe('completed');expect(dispatch.status).toBe('pending');
  await consumeOutbox('source');expect(state.runs.size).toBe(1);
 });
 it('retains a durable terminal failure after the existing outbox attempt budget',async()=>{
  await consumeOutbox('source');const child=children()[0];child.attempt_count=20;
  await expect(consumeOutbox(child.id)).rejects.toThrow();
  expect(child).toMatchObject({status:'failed',transport_status:'FAILED_PERMANENT',last_error_code:'WHATSAPP_WORKFLOW_PREPARATION_FAILED'});
 });
 it('records disabled queued WhatsApp work without invoking RPCs or replaying on re-enable',async()=>{
  await consumeOutbox('source');const child=children()[0];state.rpc.mockClear();vi.stubEnv('VERCEL_ENV','production');
  await consumeOutbox(child.id);expect(child).toMatchObject({status:'completed',last_error_code:'WHATSAPP_WORKFLOWS_DISABLED'});
  vi.stubEnv('VERCEL_ENV','preview');await consumeOutbox(child.id);expect(state.rpc).not.toHaveBeenCalled();
 });
});
