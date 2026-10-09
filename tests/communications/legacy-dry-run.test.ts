import { describe,it,expect,vi } from 'vitest';
const mocks=vi.hoisted(()=>({insert:vi.fn().mockResolvedValue({error:null}),send:vi.fn(),env:vi.fn()}));
vi.mock('../../lib/supabaseAdmin',()=>({supabaseAdmin:{from:()=>({insert:mocks.insert})}}));
vi.mock('../../lib/whatsapp/client',()=>({sendWhatsAppTemplate:mocks.send,WhatsAppApiError:class extends Error{}}));
vi.mock('../../lib/whatsapp/env',()=>({getWhatsAppEnv:mocks.env}));
describe('legacy welcome dry run',()=>{
 it('persists a dry run before provider configuration or sending to a non-allowlisted recipient',async()=>{
  vi.stubEnv('COMMUNICATION_DRY_RUN','true');vi.stubEnv('COMMUNICATION_ALLOWED_TEST_PHONES','');
  try{const {legacyWhatsAppWelcome}=await import('../../lib/whatsapp/legacy');const response=await legacyWhatsAppWelcome(new Request('https://dashboard.test/api/whatsapp/send',{method:'POST',body:JSON.stringify({phone:'919876543210'})}));
   expect(response.status).toBe(200);expect((await response.json()).result.status).toBe('DRY_RUN');expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({status:'DRY_RUN'}));expect(mocks.send).not.toHaveBeenCalled();expect(mocks.env).not.toHaveBeenCalled();
  }finally{vi.unstubAllEnvs();}
 });
});
