import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {stagingShippingSimulation,simulatedServiceability} from '../../lib/commerce/shiprocket/simulationConfig';
import {createShiprocketOrder,fetchShiprocketTracking,getShiprocketServiceability} from '../../lib/commerce/shiprocket/client';
const mock=vi.hoisted(()=>({rpc:vi.fn(),from:vi.fn(),admin:vi.fn()}));
vi.mock('../../lib/supabaseAdmin',()=>({supabaseAdmin:{rpc:mock.rpc,from:mock.from}}));
vi.mock('../../lib/admin/auth',()=>({requireAdmin:mock.admin,assertSameOrigin:(request:Request)=>{if(request.headers.get('origin')!==new URL(request.url).origin)throw new Error('BAD_ORIGIN');},adminErrorResponse:()=>Response.json({error:'DENIED'},{status:403})}));
import {ensureShipmentForOrder} from '../../lib/commerce/fulfillment';
import {POST as carrierEvent} from '../../app/api/webhooks/shiprocket/route';
import {POST as transition} from '../../app/api/admin/shipping/simulation/route';
const id='00000000-0000-4000-8000-000000000001';
beforeEach(()=>{
 vi.stubEnv('VERCEL_ENV','preview');vi.stubEnv('VERCEL_GIT_COMMIT_REF','staging');vi.stubEnv('VERCEL_GIT_COMMIT_SHA','a'.repeat(40));vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL','https://jwsivyxapfnyaafdcdos.supabase.co');vi.stubEnv('COMMUNICATION_BASE_URL','https://staging.uppermost.store');vi.stubEnv('COMMUNICATION_DRY_RUN','true');vi.stubEnv('SHIPROCKET_API_ENABLED','false');vi.stubEnv('SHIPROCKET_STAGING_SIMULATION_ENABLED','true');vi.stubEnv('SHIPROCKET_STAGING_TEST_PINCODES','110001,122001');vi.stubEnv('RAZORPAY_KEY_ID','rzp_test_fixture');vi.stubEnv('SHIPROCKET_WEBHOOK_SECRET','fixture-secret');vi.stubEnv('SHIPROCKET_PICKUP_POSTCODE','110001');
 vi.stubGlobal('fetch',vi.fn(()=>{throw new Error('REAL_NETWORK_FORBIDDEN');}));mock.rpc.mockReset().mockResolvedValue({data:{shipment_id:id,status:'ORDER_CREATED',simulated:true},error:null});mock.from.mockReset();mock.admin.mockReset().mockResolvedValue({userId:id,role:'ADMIN'});
});
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();});
describe('staging shipping simulation default-deny boundary',()=>{
 it('is opt-in and defaults off',()=>{vi.stubEnv('SHIPROCKET_STAGING_SIMULATION_ENABLED','');expect(stagingShippingSimulation()).toBeNull();});
 it.each(['VERCEL_ENV','VERCEL_GIT_COMMIT_REF','VERCEL_GIT_COMMIT_SHA','NEXT_PUBLIC_SUPABASE_URL','COMMUNICATION_BASE_URL','COMMUNICATION_DRY_RUN','RAZORPAY_KEY_ID','SHIPROCKET_API_ENABLED','SHIPROCKET_STAGING_TEST_PINCODES'])('denies missing/mismatched %s',async key=>{
  vi.stubEnv(key,'wrong');expect(()=>stagingShippingSimulation()).toThrow();await expect(ensureShipmentForOrder(id)).rejects.toThrow();expect(mock.rpc).not.toHaveBeenCalled();expect(mock.from).not.toHaveBeenCalled();expect(fetch).not.toHaveBeenCalled();
 });
 it('does not downgrade an enabled simulation into real traffic if the API flag becomes true',async()=>{vi.stubEnv('SHIPROCKET_API_ENABLED','true');await expect(fetchShiprocketTracking('real-awb')).rejects.toThrow();expect(fetch).not.toHaveBeenCalled();});
 it('returns labelled contract-compatible estimates only for configured pincodes',async()=>{
  const result=await getShiprocketServiceability({postalCode:'110001',items:[],declaredValuePaise:12345});expect(result).toMatchObject({serviceable:true,shipping_amount_paise:0,message:expect.stringContaining('SIMULATED')});expect(result).not.toHaveProperty('best_courier_internal_reference');expect(result).not.toHaveProperty('courier_display_name');
  expect(Date.parse(result.estimated_delivery_from!)).toBeGreaterThan(Date.now());expect(Date.parse(result.estimated_delivery_to!)).toBeGreaterThan(Date.parse(result.estimated_delivery_from!));expect(simulatedServiceability('999999')).toMatchObject({serviceable:false,estimated_delivery_from:null,estimated_delivery_to:null});expect(fetch).not.toHaveBeenCalled();
 });
 it('routes verified-payment fulfillment to the idempotent local RPC with server context',async()=>{
  await ensureShipmentForOrder(id);expect(mock.rpc).toHaveBeenCalledWith('comm_create_simulated_shipment',{p_order_id:id,p_context:expect.objectContaining({simulation_enabled:true,api_enabled:false,razorpay_test_key:true,project_ref:'jwsivyxapfnyaafdcdos'})});expect(mock.from).not.toHaveBeenCalled();expect(fetch).not.toHaveBeenCalled();
 });
 it('does not fall back to real fulfillment on simulated persistence failure',async()=>{mock.rpc.mockResolvedValue({error:{message:'private'},data:null});await expect(ensureShipmentForOrder(id)).rejects.toThrow('SIMULATED_SHIPMENT_UNAVAILABLE');expect(fetch).not.toHaveBeenCalled();expect(mock.from).not.toHaveBeenCalled();});
 it('retains kill switch with simulation off',async()=>{vi.stubEnv('SHIPROCKET_STAGING_SIMULATION_ENABLED','false');await expect(getShiprocketServiceability({postalCode:'110001',items:[],declaredValuePaise:1})).rejects.toThrow();expect(fetch).not.toHaveBeenCalled();});
 it('never converts an old simulation quote into real fulfillment after flags change',async()=>{
  vi.stubEnv('SHIPROCKET_STAGING_SIMULATION_ENABLED','false');vi.stubEnv('SHIPROCKET_API_ENABLED','true');
  mock.from.mockImplementation((table:string)=>{const query={select(){return query;},eq(){return query;},maybeSingle:async()=>({data:null,error:null}),single:async()=>({data:table==='orders'?{id,pricing_snapshot:{shipping:{simulated:true}}}:null,error:null})};return query;});
  await expect(ensureShipmentForOrder(id)).rejects.toThrow('SIMULATED_ORDER_REAL_FULFILLMENT_BLOCKED');expect(fetch).not.toHaveBeenCalled();expect(mock.rpc).not.toHaveBeenCalled();
 });
 it('never sends simulated tracking identifiers to a live carrier even after flags change',async()=>{vi.stubEnv('SHIPROCKET_STAGING_SIMULATION_ENABLED','false');vi.stubEnv('SHIPROCKET_API_ENABLED','true');await expect(fetchShiprocketTracking('sim_'+id)).rejects.toThrow();expect(fetch).not.toHaveBeenCalled();});
 it('blocks tracking/auth/order/pickup-capable transport while simulation is selected',async()=>{
  await expect(fetchShiprocketTracking('sim_'+id)).rejects.toThrow();await expect(createShiprocketOrder({orderNumber:'SIM',placedAt:'2026-10-30',customer:{name:'Fixture',email:'fixture@example.test',phone:'919000000000'},address:{},items:[],orderTotalRupees:1,dimensions:{weightKg:1,lengthCm:1,breadthCm:1,heightCm:1}})).rejects.toThrow();expect(fetch).not.toHaveBeenCalled();
 });
 it('blocks authenticated real inbound events before body or database mutation',async()=>{
  const request=new Request('https://staging.uppermost.store/api/webhooks/carrier-events',{method:'POST',headers:{'x-api-key':'fixture-secret'},body:'not even valid JSON'});expect((await carrierEvent(request)).status).toBe(409);expect(mock.rpc).not.toHaveBeenCalled();expect(mock.from).not.toHaveBeenCalled();
 });
 it('preserves webhook authentication before simulation rejection',async()=>{expect((await carrierEvent(new Request('https://staging.uppermost.store/api/webhooks/carrier-events',{method:'POST',body:'{}'}))).status).toBe(401);expect(mock.rpc).not.toHaveBeenCalled();});
 it('rejects real inbound events on simulation configuration mismatch',async()=>{vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL','https://wrong.example');expect((await carrierEvent(new Request('https://staging.uppermost.store/api/webhooks/carrier-events',{method:'POST',headers:{'x-api-key':'fixture-secret'},body:'{}'}))).status).toBe(503);expect(mock.rpc).not.toHaveBeenCalled();expect(mock.from).not.toHaveBeenCalled();});
 it.each(['SHIPPED','OUT_FOR_DELIVERY','DELIVERED'])('passes authenticated %s to canonical transition RPC only',async status=>{
  const response=await transition(new Request('https://staging.uppermost.store/api/admin/shipping/simulation',{method:'POST',headers:{origin:'https://staging.uppermost.store','Content-Type':'application/json'},body:JSON.stringify({order_id:id,shipment_id:id,event_id:id,status})}));expect(response.status).toBe(200);expect(mock.admin).toHaveBeenCalled();expect(mock.rpc).toHaveBeenCalledWith('comm_transition_simulated_shipment',expect.objectContaining({p_order_id:id,p_shipment_id:id,p_event_id:id,p_status:status,p_actor_id:id}));expect(fetch).not.toHaveBeenCalled();
 });
 it('denies unauthenticated or malformed transitions without mutations',async()=>{
  mock.admin.mockRejectedValue(new Error('UNAUTHENTICATED'));const req=()=>new Request('https://staging.uppermost.store/api/admin/shipping/simulation',{method:'POST',headers:{origin:'https://staging.uppermost.store','Content-Type':'application/json'},body:'{}'});expect((await transition(req())).status).toBe(403);expect(mock.rpc).not.toHaveBeenCalled();
 });
 it('keeps the test-only transition endpoint absent when disabled',async()=>{vi.stubEnv('SHIPROCKET_STAGING_SIMULATION_ENABLED','false');expect((await transition(new Request('https://staging.uppermost.store/api/admin/shipping/simulation',{method:'POST'}))).status).toBe(404);expect(mock.admin).not.toHaveBeenCalled();expect(mock.rpc).not.toHaveBeenCalled();});
 it('rejects cross-origin, skipped/malformed status and extra body fields before mutation',async()=>{
  const req=(body:unknown,origin='https://staging.uppermost.store')=>new Request('https://staging.uppermost.store/api/admin/shipping/simulation',{method:'POST',headers:{origin,'Content-Type':'application/json'},body:JSON.stringify(body)});
  expect((await transition(req({},'https://wrong.example'))).status).toBe(403);
  for(const body of [{order_id:id,shipment_id:id,event_id:id,status:'PICKUP'},{order_id:id,shipment_id:id,event_id:id,status:'SHIPPED',customer_id:id}])expect((await transition(req(body))).status).toBe(400);
  expect(mock.rpc).not.toHaveBeenCalled();expect(fetch).not.toHaveBeenCalled();
 });
});
