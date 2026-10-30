import {createHmac} from 'node:crypto';
import {afterEach,beforeEach,describe,it,expect,vi} from 'vitest';
const state=vi.hoisted(()=>({rpc:vi.fn()}));vi.mock('../../lib/communications/store',()=>({rpc:state.rpc}));
import {POST} from '../../app/api/whatsapp/webhook/route';
beforeEach(()=>{vi.stubEnv('WHATSAPP_APP_SECRET','unit-test-secret');state.rpc.mockReset().mockResolvedValue(null);});
afterEach(()=>vi.unstubAllEnvs());
function request(payload:unknown,signature?:string){const body=JSON.stringify(payload);return new Request('https://staging.example.test/api/whatsapp/webhook',{method:'POST',headers:{'x-hub-signature-256':signature??'sha256='+createHmac('sha256','unit-test-secret').update(body).digest('hex')},body});}
describe('signed Meta lifecycle',()=>{
 it.each(['wrong-waba','wrong-phone','missing-config'])('isolates staging callbacks: %s',async(kind)=>{
  vi.stubEnv('VERCEL_GIT_COMMIT_REF','staging');vi.stubEnv('WHATSAPP_BUSINESS_ACCOUNT_ID',kind==='missing-config'?'':'fixture-waba');vi.stubEnv('WHATSAPP_PHONE_NUMBER_ID','fixture-phone');
  const payload={entry:[{id:kind==='wrong-waba'?'other-waba':'fixture-waba',changes:[{field:'messages',value:{metadata:{phone_number_id:kind==='wrong-phone'?'other-phone':'fixture-phone'},messages:[{from:'919000000000',text:{body:'STOP'}}]}}]}]};
  const r=await POST(request(payload));expect(r.status).toBe(kind==='missing-config'?503:200);expect(state.rpc).not.toHaveBeenCalled();
 });
 it('accepts the exact configured staging WABA and sender',async()=>{
  vi.stubEnv('VERCEL_GIT_COMMIT_REF','staging');vi.stubEnv('WHATSAPP_BUSINESS_ACCOUNT_ID','fixture-waba');vi.stubEnv('WHATSAPP_PHONE_NUMBER_ID','fixture-phone');
  expect((await POST(request({entry:[{id:'fixture-waba',changes:[{field:'messages',value:{metadata:{phone_number_id:'fixture-phone'},statuses:[{id:'wamid.staging',status:'delivered',timestamp:'1793270000'}]}}]}]}))).status).toBe(200);
  expect(state.rpc).toHaveBeenCalledWith('comm_provider_event',expect.objectContaining({p_message_id:'wamid.staging'}));
 });
 it('rejects malformed multibyte signatures with 401 and no persistence',async()=>{
  expect((await POST(request({},'sha256='+'é'.repeat(64)))).status).toBe(401);expect(state.rpc).not.toHaveBeenCalled();
 });
 it('updates both canonical and legacy correlation through authenticated callbacks',async()=>{
  const response=await POST(request({entry:[{changes:[{field:'messages',value:{statuses:[{id:'wamid.unit',status:'read',timestamp:'1793270000'}]}}]}]}));expect(response.status).toBe(200);
  expect(state.rpc.mock.calls.map(c=>c[0])).toEqual(['comm_provider_event','comm_whatsapp_legacy_event']);
 });
 it('persists an incoming STOP button as a phone opt-out',async()=>{
  expect((await POST(request({entry:[{changes:[{field:'messages',value:{messages:[{from:'919000000000',type:'button',button:{text:'STOP',payload:'STOP'}}]}}]}]}))).status).toBe(200);
  expect(state.rpc).toHaveBeenCalledWith('comm_phone_opt_out',{p_phone:'919000000000',p_channel:'WHATSAPP'});
 });
 it('returns retryable 503 rather than acknowledging failed persistence',async()=>{
  state.rpc.mockRejectedValue(new Error('private failure'));const r=await POST(request({entry:[{changes:[{field:'messages',value:{statuses:[{id:'wamid.unit',status:'delivered',timestamp:'1793270000'}]}}]}]}));expect(r.status).toBe(503);expect(await r.text()).not.toContain('private failure');
 });
});
