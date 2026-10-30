import { afterEach,beforeEach,describe,expect,it,vi } from "vitest";
const state=vi.hoisted(()=>({entries:[] as any[],updates:[] as any[]}));
vi.mock("../../lib/communications/store",()=>({
 db:{from:()=>({update:(v:any)=>{state.updates.push(v);const q:any={eq:()=>q,neq:()=>q,then:(resolve:any)=>Promise.resolve({error:null}).then(resolve)};return q;}})},
 rpc:async()=>state.entries,assertDb:(r:any)=>{if(r.error)throw Error(r.error.message);}
}));
import { publishOutbox } from "../../lib/communications/transport";
const entry=(lane:"REALTIME"|"BULK",provider:string,id:string)=>({id,event_id:id,event_type:"diagnostic",operation:"EVENT",aggregate_id:"diagnostic",customer_id:null,payload:{provider},lane,attempt_count:1});
beforeEach(()=>{
 vi.stubEnv("QSTASH_TOKEN","test-only-token");vi.stubEnv("COMMUNICATION_BASE_URL","https://staging.uppermost.store");
 state.entries=[];state.updates=[];
});
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();});
describe("QStash publication regression",()=>{
 it("publishes both lanes using keys accepted by QStash without changing their limits or deduplication",async()=>{
  state.entries=[entry("BULK","brevo","10000000-0000-4000-8000-000000000001"),entry("REALTIME","orchestration","10000000-0000-4000-8000-000000000002")];
  const requests:any[]=[];
  vi.stubGlobal("fetch",vi.fn(async(input:any,init:any)=>{requests.push({url:String(input),headers:new Headers(init.headers),body:JSON.parse(init.body)});return Response.json({messageId:"diagnostic-"+requests.length});}));
  await expect(publishOutbox()).resolves.toMatchObject({published:2,status:"READY"});
  expect(requests).toHaveLength(2);
  for(const r of requests){
   expect(r.headers.get("Upstash-Flow-Control-Key")).toMatch(/^[a-zA-Z0-9._-]+$/);
   expect(r.url).toContain("/api/internal/communications/consume");
   expect(r.body).toEqual({outbox_id:r.headers.get("Upstash-Deduplication-Id")});
   expect(r.headers.get("Upstash-Retries")).toBe("3");
  }
  expect(requests[0].headers.get("Upstash-Flow-Control-Value")).toBe("parallelism=4, rate=10, period=1s");
  expect(requests[1].headers.get("Upstash-Flow-Control-Value")).toBe("parallelism=1, rate=2, period=1s");
  expect(state.updates.every(u=>u.transport_status==="PUBLISHED")).toBe(true);
 });
 it("reports publication failure and preserves the HTTP status without persisting arbitrary provider text",async()=>{
  state.entries=[entry("REALTIME","brevo","10000000-0000-4000-8000-000000000003")];
  vi.stubGlobal("fetch",vi.fn(async()=>Response.json({error:"flowControlKey invalid; token=DO_NOT_PERSIST"}, {status:400})));
  await expect(publishOutbox()).resolves.toMatchObject({published:0,failed:1,status:"DEGRADED"});
  expect(state.updates[0]).toMatchObject({status:"pending",transport_status:"FAILED_RETRYABLE",last_error_code:"QSTASH_HTTP_400"});
  expect(JSON.stringify(state.updates)).not.toContain("DO_NOT_PERSIST");
 });
 it("does not treat an empty queue as a failure",async()=>{
  const fetcher=vi.fn();vi.stubGlobal("fetch",fetcher);
  await expect(publishOutbox()).resolves.toMatchObject({published:0,status:"READY"});
  expect(fetcher).not.toHaveBeenCalled();
 });
});
