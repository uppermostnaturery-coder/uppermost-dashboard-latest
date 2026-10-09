import { beforeEach,describe,expect,it,vi } from 'vitest';
const mocks=vi.hoisted(()=>({prepare:vi.fn(),begin:vi.fn(),complete:vi.fn()}));
vi.mock('@/lib/commerce/checkout',()=>({prepareCheckout:mocks.prepare}));
vi.mock('@/lib/commerce/idempotency',()=>({beginIdempotentRequest:mocks.begin,completeIdempotentRequest:mocks.complete}));
beforeEach(()=>{vi.clearAllMocks();mocks.begin.mockResolvedValue({kind:'START',recordId:'idem'});mocks.prepare.mockResolvedValue({ok:true,checkout_session_id:'checkout'});mocks.complete.mockResolvedValue(undefined);});
const body={guest_session_id:'guest-session-12345',quote_id:'quo_valid12345',quote_token:'qt_valid123456789012345678901234567890',customer:{name:'Test Person',email:'test@example.test',phone:'+919876543210'},shipping_address:{name:'Test Person',phone:'+919876543210',line1:'Test Street',city:'Gurugram',state:'Haryana',postal_code:'122001',country:'IN'},billing_same_as_shipping:true};
describe('unchanged checkout contract',()=>{
 it('keeps the same parsed body/hash with optional, missing and malformed analytics headers',async()=>{
  const {POST,OPTIONS}=await import('../../app/api/checkout/prepare/route');
  for(const analytics of [{},{'x-uppermost-visitor-id':'v_123e4567-e89b-42d3-a456-426614174000','x-uppermost-session-id':'s_123e4567-e89b-42d3-a456-426614174001'},{'x-uppermost-visitor-id':'malformed'}]){
   const response=await POST(new Request('https://example.test/api/checkout/prepare',{method:'POST',headers:{'content-type':'application/json','idempotency-key':'checkout-context-test',...analytics} as Record<string,string>,body:JSON.stringify(body)}));expect(response.status).toBe(201);
  }
  const hashes=mocks.begin.mock.calls.map(c=>c[0].requestHash);expect(new Set(hashes).size).toBe(1);
  expect(mocks.prepare.mock.calls[0][0]).toEqual(mocks.prepare.mock.calls[1][0]);expect(mocks.prepare.mock.calls[0][2]).toEqual({visitorId:null,sessionId:null});expect(mocks.prepare.mock.calls[2][2].visitorId).toBeNull();
  const cors=await OPTIONS(new Request('https://example.test/api/checkout/prepare',{headers:{origin:'https://www.uppermost.store'}}));expect(cors.headers.get('Access-Control-Allow-Headers')).toContain('X-Uppermost-Visitor-Id');expect(cors.headers.get('Access-Control-Allow-Headers')).toContain('Idempotency-Key');
 });
});
