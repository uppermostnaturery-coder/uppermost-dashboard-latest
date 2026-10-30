import {afterEach,beforeEach,describe,it,expect,vi} from 'vitest';
import {createShiprocketOrder,fetchShiprocketTracking,getShiprocketServiceability} from '../../lib/commerce/shiprocket/client';
const order={orderNumber:'UNIT-1',placedAt:'2026-10-29T00:00:00Z',customer:{name:'Test',email:'test@example.test',phone:'919000000000'},address:{line1:'Test',city:'Test',state:'Test',postal_code:'110001'},items:[{sku:'TEST',name:'Test',units:1,selling_price:1}],orderTotalRupees:1,dimensions:{weightKg:0.5,lengthCm:10,breadthCm:10,heightCm:10}};
let network:ReturnType<typeof vi.fn>;
beforeEach(()=>{network=vi.fn();vi.stubGlobal('fetch',network);vi.stubEnv('SHIPROCKET_PICKUP_POSTCODE','110001');vi.stubEnv('SHIPROCKET_WEBHOOK_SECRET','unit-secret');vi.stubEnv('SHIPROCKET_EMAIL','unit@example.test');vi.stubEnv('SHIPROCKET_PASSWORD','unit-password');vi.stubEnv('SHIPROCKET_TOKEN','');vi.stubEnv('VERCEL_ENV','preview');vi.stubEnv('SHIPROCKET_API_ENABLED','false');});
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();});
describe('Shiprocket zero-network safety boundary',()=>{
 it.each(['order','tracking','serviceability'])('blocks %s including authentication',async operation=>{
  const action=operation==='order'?()=>createShiprocketOrder(order):operation==='tracking'?()=>fetchShiprocketTracking('UNIT-AWB'):()=>getShiprocketServiceability({postalCode:'110001',items:[],declaredValuePaise:100});
  await expect(action()).rejects.toMatchObject({code:'SHIPPING_UNAVAILABLE'});expect(network).not.toHaveBeenCalled();
 });
 it('blocks before reading missing credentials or accepting a cached bearer token',async()=>{
  vi.stubEnv('SHIPROCKET_TOKEN','unit-bearer');vi.stubEnv('SHIPROCKET_PICKUP_POSTCODE','');await expect(createShiprocketOrder(order)).rejects.toMatchObject({code:'SHIPPING_UNAVAILABLE'});expect(network).not.toHaveBeenCalled();
 });
 it.each([undefined,'','invalid'])('fails closed for Preview flag %s',async flag=>{
  vi.stubEnv('SHIPROCKET_API_ENABLED',flag);await expect(fetchShiprocketTracking('UNIT')).rejects.toMatchObject({code:'SHIPPING_UNAVAILABLE'});expect(network).not.toHaveBeenCalled();
 });
 it.each([undefined,'true'])('preserves Production live behavior for flag %s using mocked HTTP',async flag=>{
  vi.stubEnv('VERCEL_ENV','production');vi.stubEnv('SHIPROCKET_API_ENABLED',flag);vi.stubEnv('SHIPROCKET_TOKEN','unit-bearer');network.mockResolvedValue(Response.json({tracking_data:{status:'test'}}));
  await expect(fetchShiprocketTracking('UNIT')).resolves.toHaveProperty('tracking_data');expect(network).toHaveBeenCalledTimes(1);
 });
 it('rechecks the gate after authentication and blocks a disabled final request',async()=>{
  vi.stubEnv('SHIPROCKET_API_ENABLED','true');network.mockImplementation(async()=>{vi.stubEnv('SHIPROCKET_API_ENABLED','false');return Response.json({token:'unit-cached-token'});});
  await expect(fetchShiprocketTracking('UNIT')).rejects.toMatchObject({code:'SHIPPING_UNAVAILABLE'});expect(network).toHaveBeenCalledTimes(1);
  network.mockClear();await expect(fetchShiprocketTracking('UNIT')).rejects.toMatchObject({code:'SHIPPING_UNAVAILABLE'});expect(network).not.toHaveBeenCalled();
 });
});
