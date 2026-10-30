import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
const state=vi.hoisted(()=>({rpc:vi.fn()}));
vi.mock('../../lib/communications/store',()=>({rpc:state.rpc}));
import {connectWhatsAppWelcome} from '../../lib/communications/whatsappWelcome';
beforeEach(()=>{
 for(const [key,value] of Object.entries({VERCEL_ENV:'preview',VERCEL_GIT_COMMIT_REF:'staging',NEXT_PUBLIC_SUPABASE_URL:'https://jwsivyxapfnyaafdcdos.supabase.co',COMMUNICATION_BASE_URL:'https://staging.uppermost.store',COMMUNICATION_DRY_RUN:'true'}))vi.stubEnv(key,value);
 state.rpc.mockReset().mockResolvedValue({status:'pending'});
});
afterEach(()=>vi.unstubAllEnvs());
describe('staging WhatsApp welcome ownership',()=>{
 it('records only a persisted lead ID and reports dry-run without publishing or sending',async()=>{
  expect(await connectWhatsAppWelcome('11111111-1111-4111-8111-111111111111')).toEqual({status:'dry_run',welcomeState:'pending'});
  expect(state.rpc).toHaveBeenCalledWith('comm_connect_whatsapp_welcome',{p_lead_id:'11111111-1111-4111-8111-111111111111'});
 });
 it('does not use staging RPCs outside staging',async()=>{
  vi.stubEnv('VERCEL_ENV','production');vi.stubEnv('VERCEL_GIT_COMMIT_REF','main');vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL','https://other.example.test');vi.stubEnv('COMMUNICATION_BASE_URL','https://other.example.test');
  expect(await connectWhatsAppWelcome('lead')).toBeNull();expect(state.rpc).not.toHaveBeenCalled();
 });
 it('fails closed on inconsistent staging configuration',async()=>{
  vi.stubEnv('COMMUNICATION_DRY_RUN','false');expect(await connectWhatsAppWelcome('lead')).toMatchObject({status:'skipped',welcomeState:'configuration_invalid'});expect(state.rpc).not.toHaveBeenCalled();
 });
 it('does not leak database errors or fall back to an immediate send',async()=>{
  state.rpc.mockRejectedValue(new Error('private details'));expect(await connectWhatsAppWelcome('lead')).toEqual({status:'failed',welcomeState:'connection_failed',message:'Signup saved. WhatsApp welcome needs attention.'});
 });
 it.each(['opted_out','ineligible'])('reports %s without claiming a send',async status=>{
  state.rpc.mockResolvedValue({status});expect(await connectWhatsAppWelcome('lead')).toEqual({status:'skipped',welcomeState:status});
 });
});
