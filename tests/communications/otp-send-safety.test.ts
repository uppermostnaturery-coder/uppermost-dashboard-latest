import {afterEach,beforeEach,describe,it,expect,vi} from 'vitest';
const state=vi.hoisted(()=>({rpc:vi.fn(),from:vi.fn(),send:vi.fn()}));
vi.mock('../../lib/communications/store',()=>({rpc:state.rpc,db:{from:state.from},assertDb:vi.fn()}));
vi.mock('../../lib/communications/providers/send',()=>({sendProvider:state.send}));
import {deliverOtp} from '../../lib/communications/otp';
beforeEach(()=>{vi.stubEnv('COMMUNICATION_DRY_RUN','true');vi.stubEnv('COMMUNICATION_ALLOWED_TEST_PHONES','919000000000');vi.stubEnv('COMMUNICATION_ALLOWED_TEST_EMAILS','test@example.test');state.rpc.mockReset();state.from.mockReset();state.send.mockReset();});
afterEach(()=>vi.unstubAllEnvs());
describe('OTP dry-run is unconditional',()=>{
 it.each([0,1,2])('never decrypts, reserves a provider attempt or sends channel index %s',async index=>{
  state.rpc.mockImplementation(async(name:string)=>name==='comm_claim_otp'?[{send_channel_index:index,phone:'919000000000',email:'test@example.test',encrypted_otp:'not-decryptable'}]:null);
  await deliverOtp('unit-challenge');expect(state.rpc).toHaveBeenCalledWith('comm_finish_otp',{p_id:'unit-challenge',p_success:true,p_state:'DRY_RUN'});expect(state.from).not.toHaveBeenCalled();expect(state.send).not.toHaveBeenCalled();
 });
});
