import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
const state=vi.hoisted(()=>({rpc:vi.fn(),from:vi.fn(),updates:[] as Record<string,unknown>[]}));
vi.mock('../../lib/supabaseAdmin',()=>({supabaseAdmin:{rpc:state.rpc,from:state.from}}));
vi.mock('../../lib/commerce/env',()=>({getShiprocketEnv:()=>({webhookSecret:'fixture-secret'})}));
vi.mock('../../lib/commerce/messages',()=>({createCustomerMessage:vi.fn()}));
vi.mock('../../lib/communications/store',()=>({rpc:async(n:string,args:unknown)=>{const r=await state.rpc(n,args);if(r.error)throw new Error('DATABASE_UNAVAILABLE');return r.data;},assertDb:(r:any)=>{if(r.error)throw new Error('DATABASE_UNAVAILABLE');},db:{from:state.from}}));
import {POST} from '../../app/api/webhooks/shiprocket/route';
import {captureWhatsAppWorkflows,dispatchWhatsAppWorkflows,isManagedWhatsAppRule} from '../../lib/communications/whatsappWorkflows';
import {sendDelivery} from '../../lib/communications/delivery';
beforeEach(()=>{
 vi.stubEnv('VERCEL_ENV','preview');vi.stubEnv('VERCEL_GIT_COMMIT_REF','staging');vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL','https://jwsivyxapfnyaafdcdos.supabase.co');vi.stubEnv('COMMUNICATION_BASE_URL','https://staging.uppermost.store');vi.stubEnv('COMMUNICATION_DRY_RUN','true');vi.stubEnv('COMMUNICATION_PROVIDER_MUTATIONS_ENABLED','false');
 vi.stubGlobal('fetch',vi.fn(()=>{throw new Error('REAL_NETWORK_FORBIDDEN');}));state.rpc.mockReset().mockResolvedValue({data:{ok:true},error:null});state.from.mockReset();state.updates=[];
});
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();});
const req=(secret='fixture-secret')=>new Request('https://staging.uppermost.store/api/webhooks/carrier-events',{method:'POST',headers:{'x-api-key':secret},body:JSON.stringify({awb_code:'fixture-awb',sr_shipment_id:'fixture-shipment',status:'out for delivery',id:'fixture-event'})});
describe('staging workflow application boundaries',()=>{
 it('rejects unauthenticated courier events before database or network access',async()=>{expect((await POST(req('invalid'))).status).toBe(401);expect(state.rpc).not.toHaveBeenCalled();expect(state.from).not.toHaveBeenCalled();expect(fetch).not.toHaveBeenCalled();});
 it('uses atomic ingestion only after authentication and normalizes supported aliases',async()=>{
  expect((await POST(req())).status).toBe(200);expect(state.rpc).toHaveBeenCalledWith('comm_ingest_shipment_event',{p_payload:expect.objectContaining({awb:'fixture-awb',shipment_id:'fixture-shipment',event_id:'fixture-event',current_status:'out for delivery'})});expect(state.from).not.toHaveBeenCalled();expect(fetch).not.toHaveBeenCalled();
 });
 it('does not acknowledge failed atomic ingestion as success',async()=>{state.rpc.mockResolvedValue({error:{message:'private details'}});const response=await POST(req());expect(response.status).toBeGreaterThanOrEqual(500);expect(await response.text()).not.toContain('private details');expect(fetch).not.toHaveBeenCalled();});
 it('keeps capture/dispatch bounded and unconditionally dry',async()=>{
  await dispatchWhatsAppWorkflows();expect(state.rpc.mock.calls).toEqual([['comm_capture_whatsapp_workflows',{p_limit:50}],['comm_dispatch_whatsapp_workflows',{p_limit:50,p_dry:true}]]);expect(fetch).not.toHaveBeenCalled();
 });
 it('does not invoke new RPCs in Production or inconsistent staging',async()=>{
  vi.stubEnv('VERCEL_ENV','production');await captureWhatsAppWorkflows();await dispatchWhatsAppWorkflows();expect(state.rpc).not.toHaveBeenCalled();
  vi.stubEnv('VERCEL_ENV','preview');vi.stubEnv('COMMUNICATION_DRY_RUN','false');await dispatchWhatsAppWorkflows();expect(state.rpc).not.toHaveBeenCalled();
 });
 it('routes the seven managed rules away from generic repeat scheduling',()=>{for(const w of ['WELCOME','CART_RECOVERY','PAYMENT_FAILED','ORDER_CONFIRMATION','ORDER_SHIPPED','OUT_FOR_DELIVERY','DELIVERY_CONFIRMATION'])expect(isManagedWhatsAppRule(`UPPERMOST_WHATSAPP_${w}_V1`)).toBe(true);expect(isManagedWhatsAppRule('UPPERMOST_EMAIL_WELCOME_V1')).toBe(false);});
 it('suppresses a withdrawn/obsolete queued delivery before dry-run or provider access',async()=>{
  state.rpc.mockImplementation(async(n:string)=>({data:n==='comm_claim_delivery'?[{channel:'WHATSAPP',customer_message_id:'fixture'}]:n==='comm_whatsapp_delivery_permission'?'CONSENT_REQUIRED':null,error:null}));
  state.from.mockImplementation(()=>{const q:any={update(v:Record<string,unknown>){state.updates.push(v);return q;},eq(){return q;},then(resolve:any){return Promise.resolve({error:null}).then(resolve);}};return q;});
  await sendDelivery('fixture');expect(state.updates).toContainEqual(expect.objectContaining({status:'SUPPRESSED',suppression_reason:'CONSENT_REQUIRED'}));expect(fetch).not.toHaveBeenCalled();
 });
});
