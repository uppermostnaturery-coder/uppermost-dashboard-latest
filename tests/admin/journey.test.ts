import { beforeEach,describe,expect,it,vi } from 'vitest';
const mocks=vi.hoisted(()=>({auth:vi.fn(),from:vi.fn(),queries:[] as {table:string;filters:unknown[][]}[],linked:true}));
vi.mock('@/lib/admin/auth',()=>({requireAdmin:mocks.auth,adminErrorResponse:()=>Response.json({error:'UNAUTHENTICATED'},{status:401})}));
vi.mock('@/lib/communications/store',()=>({db:{from:mocks.from},assertDb:(result:{error:unknown})=>{if(result.error)throw result.error;}}));
const customer='86000000-0000-4000-8000-000000000001',linkId='86000000-0000-4000-8000-000000000002',visitor='v_123e4567-e89b-42d3-a456-426614174000';
const linked={id:linkId,visitor_id:visitor,valid_from:'2026-10-07T00:00:00Z',valid_until:'2026-10-07T01:00:00Z',confidence:'IDENTIFIED'};
beforeEach(()=>{vi.clearAllMocks();mocks.queries.length=0;mocks.linked=true;mocks.auth.mockResolvedValue({role:'VIEWER'});
 mocks.from.mockImplementation((table:string)=>{const query={table,filters:[] as unknown[][]};mocks.queries.push(query);const rows=table==='analytics_identity_links'?[linked]:Array.from({length:50},(_,i)=>({id:100-i,created_at:'2026-10-07T00:30:00Z'}));
  const chain:Record<string,unknown>={then:(resolve:(value:unknown)=>unknown)=>Promise.resolve({data:rows,error:null}).then(resolve),maybeSingle:()=>Promise.resolve({data:mocks.linked?linked:null,error:null})};
  for(const key of ['select','eq','gt','gte','lt','or','order','limit'])chain[key]=(...args:unknown[])=>{query.filters.push([key,...args]);return chain;};return chain;
 });
});
describe('bounded customer journey',()=>{
 it('returns an ID tie-breaker and constrains events to the selected identity validity interval',async()=>{
  const {GET}=await import('../../app/api/admin/analytics/route');const result=await GET(new Request(`https://dashboard.test/api/admin/analytics?customer_id=${customer}&source=analytics&visitor_id=${visitor}&link_id=${linkId}&before=2026-10-07T00:30:00Z&before_id=100`));expect(result.status).toBe(200);
  expect((await result.json()).next_cursor).toEqual({before:'2026-10-07T00:30:00Z',before_id:'51'});
  const query=mocks.queries.find(q=>q.table==='analytics_events')!;expect(query.filters).toContainEqual(['gte','created_at',linked.valid_from]);expect(query.filters).toContainEqual(['lt','created_at',linked.valid_until]);expect(query.filters).toContainEqual(['or','created_at.lt.2026-10-07T00:30:00Z,and(created_at.eq.2026-10-07T00:30:00Z,id.lt.100)']);expect(query.filters).toContainEqual(['limit',50]);
 });
 it('does not load analytics for an identity link outside the customer scope',async()=>{mocks.linked=false;const {GET}=await import('../../app/api/admin/analytics/route');const response=await GET(new Request(`https://dashboard.test/api/admin/analytics?customer_id=${customer}&source=analytics&visitor_id=${visitor}&link_id=${linkId}`));expect(response.status).toBe(404);expect(mocks.queries.map(q=>q.table)).not.toContain('analytics_events');});
 it('rejects invalid customer identifiers as validation errors',async()=>{const {GET}=await import('../../app/api/admin/analytics/route');expect((await GET(new Request('https://dashboard.test/api/admin/analytics?customer_id=bad'))).status).toBe(400);});
});
