import { beforeEach,describe,expect,it,vi } from 'vitest';
const mocks=vi.hoisted(()=>({user:vi.fn(),membership:vi.fn()}));
vi.mock('@supabase/ssr',()=>({createServerClient:()=>({auth:{getUser:mocks.user}})}));
vi.mock('next/headers',()=>({cookies:()=>({getAll:()=>[],set:vi.fn()})}));
vi.mock('@/lib/supabaseAdmin',()=>({supabaseAdmin:{auth:{getUser:mocks.user},from:()=>({select:()=>({eq:()=>({maybeSingle:mocks.membership})})})}}));
beforeEach(()=>{vi.clearAllMocks();mocks.user.mockResolvedValue({data:{user:null},error:null});mocks.membership.mockResolvedValue({data:null,error:null});});
describe('server authorization on operator endpoints',()=>{
 it('rejects anonymous offer and communication mutations without touching memberships',async()=>{
  const {POST}=await import('../../app/api/admin/communications/route');
  const response=await POST(new Request('https://dashboard.test/api/admin/communications',{method:'POST',headers:{origin:'https://dashboard.test','content-type':'application/json','x-customer-token':'guest-commerce-token'},body:JSON.stringify({operation:'SAVE_RULE',input:{}})}));
  expect(response.status).toBe(401);expect(mocks.membership).not.toHaveBeenCalled();
 });
 it('verifies the user before reading server-owned membership and denies viewers writes',async()=>{
  mocks.user.mockResolvedValue({data:{user:{id:'operator',user_metadata:{role:'ADMIN'}}},error:null});mocks.membership.mockResolvedValue({data:{role:'VIEWER',active:true},error:null});
  const {requireAdmin}=await import('../../lib/admin/auth');
  expect((await requireAdmin()).role).toBe('VIEWER');await expect(requireAdmin(undefined,true)).rejects.toMatchObject({status:403});
 });
 it('does not accept a mismatched Origin even with an operator bearer token',async()=>{
  const {POST}=await import('../../app/api/admin/communications/route');const r=await POST(new Request('https://dashboard.test/api/admin/communications',{method:'POST',headers:{origin:'https://evil.test','content-type':'application/json',authorization:'Bearer operator'},body:'{}'}));expect(r.status).toBe(403);expect(mocks.user).not.toHaveBeenCalled();
 });
});
