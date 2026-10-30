import {afterEach,beforeEach,describe,it,expect,vi} from 'vitest';
import {sendProvider} from '../../lib/communications/providers/send';
import {sendWhatsAppTemplate} from '../../lib/whatsapp/client';
import {brevoFetch} from '../../lib/brevo/client';
import {isAllowedTestDestination} from '../../lib/communications/preferences';
import {submitProvider} from '../../lib/communications/templates';
vi.mock('../../lib/communications/store',()=>({db:{},rpc:vi.fn()}));
let network:ReturnType<typeof vi.fn<typeof fetch>>;
beforeEach(()=>{network=vi.fn<typeof fetch>().mockImplementation(async()=>Response.json({messages:[{id:'unit'}],messageId:'unit'}));vi.stubGlobal('fetch',network);vi.stubEnv('COMMUNICATION_DRY_RUN','true');vi.stubEnv('COMMUNICATION_ALLOWED_TEST_PHONES','919000000000');vi.stubEnv('COMMUNICATION_ALLOWED_TEST_EMAILS','test@example.test');vi.stubEnv('WHATSAPP_ACCESS_TOKEN','unit');vi.stubEnv('WHATSAPP_PHONE_NUMBER_ID','unit');vi.stubEnv('WHATSAPP_BUSINESS_ACCOUNT_ID','unit');vi.stubEnv('BREVO_API_KEY','unit');});
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();});
describe('unconditional dry-run send boundary',()=>{
 it.each(['EMAIL','WHATSAPP','SMS','LEMLIST'])('blocks direct %s sends even when allowlisted',async channel=>{
  await expect(sendProvider({channel,category:'TRANSACTIONAL'},{provider_status:'APPROVED'},'test@example.test',{},network)).rejects.toThrow('COMMUNICATION_DRY_RUN');expect(network).not.toHaveBeenCalled();
 });
 it('blocks legacy WhatsApp before provider credentials and network',async()=>{
  await expect(sendWhatsAppTemplate({to:'919000000000',templateName:'hello_world',language:'en_US'})).rejects.toThrow('COMMUNICATION_DRY_RUN');expect(network).not.toHaveBeenCalled();
 });
 it('makes allowlists unable to authorize real sends while dry-run is true',()=>{
  expect(isAllowedTestDestination('WHATSAPP','919000000000')).toBe(false);expect(isAllowedTestDestination('EMAIL','test@example.test')).toBe(false);
 });
 it.each(['/smtp/email','/contacts'])('blocks Brevo mutation %s that can trigger automation',async path=>{
  await expect(brevoFetch(path,{method:'POST',body:{}})).rejects.toThrow('COMMUNICATION_DRY_RUN');expect(network).not.toHaveBeenCalled();
 });
 it('preserves read-only Brevo access and normal Production live-mode sends',async()=>{
  await brevoFetch('/account');expect(network).toHaveBeenCalledTimes(1);network.mockClear();vi.stubEnv('COMMUNICATION_DRY_RUN','false');vi.stubEnv('VERCEL_ENV','production');
  await sendWhatsAppTemplate({to:'919000000000',templateName:'hello_world',language:'en_US'});expect(network).toHaveBeenCalledTimes(1);
 });
 it('blocks template mutations explicitly before database/provider access',async()=>{
  vi.stubEnv('COMMUNICATION_PROVIDER_MUTATIONS_ENABLED','false');await expect(submitProvider('unit-version')).rejects.toThrow('PROVIDER_MUTATIONS_DISABLED');expect(network).not.toHaveBeenCalled();
 });
});
