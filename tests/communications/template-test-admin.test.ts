import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
const state=vi.hoisted(()=>({rpc:vi.fn(async()=> 'delivery')}));
vi.mock('../../lib/communications/store',()=>({db:{},rpc:state.rpc,assertDb:vi.fn()}));
import {communicationMutation} from '../../lib/admin/communications';
const id='26000000-0000-4000-8000-000000000001',key='28000000-0000-4000-8000-000000000001',actor='27000000-0000-4000-8000-000000000001';
beforeEach(()=>{state.rpc.mockClear();vi.stubEnv('VERCEL_GIT_COMMIT_REF','staging');vi.stubEnv('COMMUNICATION_STAGING_TEST_ENABLED','false');});
afterEach(()=>vi.unstubAllEnvs());
describe('existing admin template-test operation',()=>{
 it('requires a request key in staging without queueing anything',async()=>{await expect(communicationMutation('TEST_TEMPLATE',{id,destination:'test@example.test'},actor)).rejects.toMatchObject({code:'TEST_REQUEST_KEY_REQUIRED'});expect(state.rpc).not.toHaveBeenCalled();});
 it('uses the atomic audited queue with no sending window while off',async()=>{await communicationMutation('TEST_TEMPLATE',{id,destination:'test@example.test',request_key:key},actor);expect(state.rpc).toHaveBeenCalledWith('comm_queue_template_test_once',{p_version_id:id,p_destination:'test@example.test',p_request_key:key,p_actor:actor,p_staging_window:null});});
 it('rejects a caller-supplied sending window or actor',async()=>{await expect(communicationMutation('TEST_TEMPLATE',{id,destination:'test@example.test',request_key:key,p_staging_window:'forged'},actor)).rejects.toThrow();expect(state.rpc).not.toHaveBeenCalled();});
 it('preserves the legacy production operation',async()=>{vi.stubEnv('VERCEL_GIT_COMMIT_REF','main');vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL','https://example.test');vi.stubEnv('COMMUNICATION_BASE_URL','https://example.test');await communicationMutation('TEST_TEMPLATE',{id,destination:'test@example.test'},actor);expect(state.rpc).toHaveBeenCalledWith('comm_queue_template_test',{p_version_id:id,p_destination:'test@example.test'});});
});
