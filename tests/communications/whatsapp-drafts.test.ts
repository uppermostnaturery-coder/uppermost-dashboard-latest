import {readFileSync} from 'node:fs';
import {describe,it,expect,vi} from 'vitest';
vi.mock('../../lib/communications/store',()=>({db:{},rpc:vi.fn()}));
import {ruleSchema} from '../../lib/communications/rules';
import {templateVersionSchema} from '../../lib/communications/templates';
describe('independent WhatsApp draft configurations',()=>{
 it('validates nine drafts without activating, scheduling or inventing approvals',()=>{
  const config=JSON.parse(readFileSync('docs/whatsapp-staging-drafts.json','utf8'));expect(config.project_ref).toBe('jwsivyxapfnyaafdcdos');expect(config.drafts).toHaveLength(9);
  for(const draft of config.drafts){
   expect(draft.rule.status).toBe('DRAFT');expect(JSON.stringify(draft.rule.condition_config)).not.toContain('email_marketing_allowed');
   expect(ruleSchema.parse({...draft.rule,action_config:{...draft.rule.action_config,templates:{WHATSAPP:'10000000-0000-4000-8000-000000000001'}}}).status).toBe('DRAFT');
   if(draft.template){expect(templateVersionSchema.parse(draft.template).channel).toBe('WHATSAPP');expect(draft.template).not.toHaveProperty('provider_status');}
  }
 });
});
