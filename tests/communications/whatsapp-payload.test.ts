import {afterEach,describe,expect,it,vi} from 'vitest';
import {sendProvider} from '../../lib/communications/providers/send';
import {resolveMessageVariables} from '../../lib/communications/variables';
afterEach(()=>vi.unstubAllEnvs());
describe('WhatsApp template boundary',()=>{
 it('sends authoritative name in the declared body position and exact language',async()=>{
  vi.stubEnv('WHATSAPP_ACCESS_TOKEN','unit-test');vi.stubEnv('WHATSAPP_PHONE_NUMBER_ID','test-phone');
  let payload:any;const fetcher=async(_url:unknown,init?:RequestInit)=>{payload=JSON.parse(String(init?.body));return Response.json({messages:[{id:'wamid.test'}]});};
  const variables=resolveMessageVariables({name:'Customer'}, {title:'Welcome',body:'Welcome'}, {},{name:'forged'});
  expect(await sendProvider({channel:'WHATSAPP',category:'MARKETING',parameter_schema:{body_parameters:['name']}},{provider_status:'APPROVED',provider_template_name:'uppermost_welcome_v1',provider_language:'en'},'+919000000000',variables,fetcher as typeof fetch)).toBe('wamid.test');
  expect(payload.template).toEqual({name:'uppermost_welcome_v1',language:{code:'en'},components:[{type:'body',parameters:[{type:'text',text:'Customer'}]}]});
 });
 it('uses a deliberate name fallback rather than an empty template parameter',()=>{
  expect(resolveMessageVariables({name:'  '},{title:'Welcome',body:'Welcome'},{},{}).name).toBe('Uppermost Customer');
 });
 it('never sends when a required variable is missing',async()=>{
  const fetcher=vi.fn();await expect(sendProvider({channel:'WHATSAPP',category:'MARKETING',parameter_schema:{body_parameters:['name']}},{provider_status:'APPROVED'},'919000000000',{},fetcher)).rejects.toMatchObject({code:'MISSING_VARIABLE'});expect(fetcher).not.toHaveBeenCalled();
 });
});
