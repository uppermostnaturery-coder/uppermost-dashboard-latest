import { beforeEach,afterEach,describe,it,expect,vi } from 'vitest';
const state=vi.hoisted(()=>({rpc:vi.fn()}));
vi.mock('../../lib/communications/store',()=>({rpc:state.rpc}));
import { connectSignupWelcome } from '../../lib/communications/welcomeBridge';
beforeEach(()=>{
 for(const [k,v] of Object.entries({VERCEL_ENV:'preview',VERCEL_GIT_COMMIT_REF:'staging',NEXT_PUBLIC_SUPABASE_URL:'https://jwsivyxapfnyaafdcdos.supabase.co',COMMUNICATION_BASE_URL:'https://staging.uppermost.store',COMMUNICATION_DRY_RUN:'true'}))vi.stubEnv(k,v);
 state.rpc.mockReset().mockResolvedValue({status:'connected',customer_id:'customer-internal',outbox_id:'event-internal'});
});
afterEach(()=>vi.unstubAllEnvs());
describe('staging Welcome bridge ownership',()=>{
 it('passes only the persisted lead ID, returns no customer identity and never claims an email was sent',async()=>{
  expect(await connectSignupWelcome('lead-id','completed')).toEqual({status:'dry_run',bridgeStatus:'connected',message:'Welcome signup connection recorded. Email sending remains disabled.'});
  expect(state.rpc).toHaveBeenCalledWith('comm_connect_lead_welcome',{p_lead_id:'lead-id'});
 });
 it('does not call the bridge for an incomplete signup',async()=>{
  expect((await connectSignupWelcome('lead-id','email_completed'))?.bridgeStatus).toBe('ineligible');expect(state.rpc).not.toHaveBeenCalled();
 });
 it('fails closed on inconsistent staging configuration',async()=>{
  vi.stubEnv('COMMUNICATION_DRY_RUN','false');expect((await connectSignupWelcome('lead-id','completed'))?.bridgeStatus).toBe('configuration_invalid');expect(state.rpc).not.toHaveBeenCalled();
 });
 it('leaves the non-staging path alone',async()=>{
  vi.stubEnv('VERCEL_ENV','production');vi.stubEnv('VERCEL_GIT_COMMIT_REF','main');vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL','https://production.example.test');vi.stubEnv('COMMUNICATION_BASE_URL','https://production.example.test');
  expect(await connectSignupWelcome('lead-id','completed')).toBeNull();expect(state.rpc).not.toHaveBeenCalled();
 });
 it('reports a bridge failure without leaking database details or falling back to a send',async()=>{
  state.rpc.mockRejectedValue(new Error('private database detail'));
  expect(await connectSignupWelcome('lead-id','completed')).toEqual({status:'dry_run',bridgeStatus:'failed',message:'Signup saved, but the Welcome connection needs attention. No email was sent.'});
 });
 it.each(['already_connected','opted_out','ineligible'])('preserves truthful bridge result %s',async status=>{
  state.rpc.mockResolvedValue({status});expect((await connectSignupWelcome('lead-id','completed'))?.bridgeStatus).toBe(status);
 });
});
