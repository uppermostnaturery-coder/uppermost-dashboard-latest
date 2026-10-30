import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
const state=vi.hoisted(()=>({rpc:vi.fn()}));
vi.mock('../../lib/communications/store',()=>({rpc:state.rpc}));
import {authorizeWhatsAppE2E,reserveWhatsAppE2E,revokeWhatsAppE2E} from '../../lib/communications/whatsappE2EGate';
import {sendProvider} from '../../lib/communications/providers/send';
const id='00000000-0000-4000-8000-000000000001';
const input={deliveryId:id,approvalRef:id,approvedBy:id,consentId:id,expiresAt:new Date(Date.now()+600000).toISOString()};
beforeEach(()=>{
 vi.stubEnv('VERCEL_ENV','preview');vi.stubEnv('VERCEL_GIT_COMMIT_REF','staging');vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL','https://jwsivyxapfnyaafdcdos.supabase.co');vi.stubEnv('COMMUNICATION_BASE_URL','https://staging.uppermost.store');
 vi.stubEnv('COMMUNICATION_DRY_RUN','true');vi.stubEnv('VERCEL_GIT_COMMIT_SHA','a'.repeat(40));vi.stubEnv('COMMUNICATION_E2E_REVIEWED_BUILD_SHA','a'.repeat(40));vi.stubEnv('WHATSAPP_APP_ID','111');vi.stubEnv('WHATSAPP_BUSINESS_ACCOUNT_ID','222');vi.stubEnv('WHATSAPP_PHONE_NUMBER_ID','333');
 state.rpc.mockReset();vi.stubGlobal('fetch',vi.fn(()=>{throw new Error('REAL_NETWORK_FORBIDDEN');}));
});
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();});
describe('dormant WhatsApp gate server adapter',()=>{
 it('derives binding context from server configuration and sends no network request',async()=>{
  state.rpc.mockResolvedValue(id);expect(await authorizeWhatsAppE2E(input)).toBe(id);
  expect(state.rpc).toHaveBeenCalledWith('comm_authorize_whatsapp_e2e',expect.objectContaining({p_delivery_id:id,p_context:{project_ref:'jwsivyxapfnyaafdcdos',base_url:'https://staging.uppermost.store',environment:'preview',branch:'staging',dry_run:true,build_sha:'a'.repeat(40),reviewed_build_sha:'a'.repeat(40),app_id:'111',waba_id:'222',sender_id:'333'}}));expect(fetch).not.toHaveBeenCalled();
 });
 it.each(['VERCEL_ENV','VERCEL_GIT_COMMIT_REF','NEXT_PUBLIC_SUPABASE_URL','COMMUNICATION_BASE_URL','COMMUNICATION_DRY_RUN','VERCEL_GIT_COMMIT_SHA','COMMUNICATION_E2E_REVIEWED_BUILD_SHA','WHATSAPP_APP_ID','WHATSAPP_BUSINESS_ACCOUNT_ID','WHATSAPP_PHONE_NUMBER_ID'])('denies missing %s before RPC',async key=>{
  vi.stubEnv(key,'');await expect(authorizeWhatsAppE2E(input)).rejects.toThrow('E2E_CONTEXT_INVALID');await expect(reserveWhatsAppE2E(id)).rejects.toThrow('E2E_CONTEXT_INVALID');expect(state.rpc).not.toHaveBeenCalled();
 });
 it.each(['false','TRUE',' true '])('rejects changed dry-run configuration %s',async value=>{vi.stubEnv('COMMUNICATION_DRY_RUN',value);await expect(reserveWhatsAppE2E(id)).rejects.toThrow('E2E_CONTEXT_INVALID');expect(state.rpc).not.toHaveBeenCalled();});
 it('rejects mismatched reviewed build',async()=>{vi.stubEnv('COMMUNICATION_E2E_REVIEWED_BUILD_SHA','b'.repeat(40));await expect(reserveWhatsAppE2E(id)).rejects.toThrow('E2E_CONTEXT_INVALID');expect(state.rpc).not.toHaveBeenCalled();});
 it.each(['invalid',new Date(0).toISOString(),new Date(Date.now()+16*60000).toISOString()])('rejects expiry %s',async expiresAt=>{await expect(authorizeWhatsAppE2E({...input,expiresAt})).rejects.toThrow('E2E_EXPIRY_INVALID');expect(state.rpc).not.toHaveBeenCalled();});
 it('returns true only for exact database boolean and sanitizes errors without retry',async()=>{
  for(const value of [null,[],{},'true',false]){state.rpc.mockResolvedValueOnce(value);expect(await reserveWhatsAppE2E(id)).toBe(false);}
  state.rpc.mockRejectedValueOnce(new Error('private credentials'));await expect(reserveWhatsAppE2E(id)).rejects.toThrow('E2E_RESERVATION_UNAVAILABLE');expect(state.rpc).toHaveBeenCalledTimes(6);expect(fetch).not.toHaveBeenCalled();
 });
 it('does not convert even a successful reservation into a dry-run bypass',async()=>{
  state.rpc.mockResolvedValue(true);expect(await reserveWhatsAppE2E(id)).toBe(true);
  await expect(sendProvider({channel:'WHATSAPP',category:'TRANSACTIONAL'},{provider_status:'APPROVED'},'+919000000000',{})).rejects.toThrow('COMMUNICATION_DRY_RUN');expect(fetch).not.toHaveBeenCalled();
 });
 it('allows revocation when staging identity is safe even if reviewed build configuration is unavailable',async()=>{
  vi.stubEnv('COMMUNICATION_E2E_REVIEWED_BUILD_SHA','');state.rpc.mockResolvedValue(null);await revokeWhatsAppE2E(id);expect(state.rpc).toHaveBeenCalledWith('comm_revoke_whatsapp_e2e',{p_id:id});expect(fetch).not.toHaveBeenCalled();
 });
});
