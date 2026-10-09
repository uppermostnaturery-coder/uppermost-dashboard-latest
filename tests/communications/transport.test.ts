import { beforeAll,describe,expect,it,vi } from 'vitest';
vi.mock('../../lib/supabaseAdmin',()=>({supabaseAdmin:{rpc:vi.fn(),from:vi.fn()}}));
beforeAll(()=>{process.env.NEXT_PUBLIC_SUPABASE_URL='https://example.supabase.co';process.env.SUPABASE_SERVICE_ROLE_KEY='test';});
describe('signed transport and provider boundaries',()=>{
 it('applies recovery projections without evaluating customer event rules',async()=>{
  const {supabaseAdmin}=await import('../../lib/supabaseAdmin');const from=vi.mocked(supabaseAdmin.from);const rpc=vi.mocked(supabaseAdmin.rpc);delete process.env.QSTASH_TOKEN;
  const read={select:vi.fn(),eq:vi.fn(),single:vi.fn().mockResolvedValue({data:{id:'recovery',operation:'EVENT',status:'pending',customer_id:'customer',payload:{projection_only:true}},error:null})};read.select.mockReturnValue(read);read.eq.mockReturnValue(read);
  const update={eq:vi.fn().mockResolvedValue({error:null})};from.mockImplementation(()=>({select:read.select,update:()=>update}) as never);rpc.mockResolvedValue({data:null,error:null} as never);
  const {consumeOutbox}=await import('../../lib/communications/consumer');await consumeOutbox('recovery');
  expect(rpc).toHaveBeenCalledWith('comm_apply_projection',{p_outbox_id:'recovery'});expect(from.mock.calls.map(c=>c[0])).not.toContain('communication_rules');
 });
 it('rejects unsigned QStash requests',async()=>{const {verifyTransport}=await import('../../lib/communications/transport');expect(await verifyTransport(new Request('https://example.test'),'{}')).toBe(false);});
 it('sends canonical HTML directly to Brevo through a controlled HTTP seam',async()=>{
  process.env.BREVO_API_KEY='test';process.env.COMMUNICATION_EMAIL_FROM='sender@example.test';
  const fetcher=vi.fn().mockResolvedValue(Response.json({messageId:'brevo-id'}));
  const {sendProvider}=await import('../../lib/communications/providers/send');
  await expect(sendProvider({channel:'EMAIL',category:'TRANSACTIONAL',subject:'Order',html_content:'<p>Hello {{name}}</p>'},null,'recipient@example.test',{name:'Test'},fetcher)).resolves.toBe('brevo-id');
  const payload=JSON.parse(fetcher.mock.calls[0][1].body);expect(payload.htmlContent).toBe('<p>Hello Test</p>');expect(payload.templateId).toBeUndefined();
 });
 it('never calls MSG91 for incomplete DLT mappings',async()=>{const fetcher=vi.fn();const {sendProvider}=await import('../../lib/communications/providers/send');await expect(sendProvider({channel:'SMS',category:'MARKETING'},null,'919876543210',{},fetcher)).rejects.toThrow('DLT_MAPPING_REQUIRED');expect(fetcher).not.toHaveBeenCalled();});
 it('leaves ambiguous HTTP outcomes for reconciliation',async()=>{const {providerRequest}=await import('../../lib/communications/providers/http');await expect(providerRequest('https://provider.test',{method:'POST'},vi.fn().mockRejectedValue(new Error('network')))).rejects.toMatchObject({state:'RECONCILIATION_PENDING'});});
});
