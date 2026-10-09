import { describe,expect,it } from 'vitest';
import { resolveMessageVariables } from '../../lib/communications/variables';
describe('transactional variable resolution',()=>{
 it('uses authoritative subject facts ahead of campaign constants without exposing contact data',()=>{
  const variables=resolveMessageVariables({name:'Customer',email:'private@example.test'}, {title:'Order confirmed',body:'Payment received'}, {event_type:'commerce.payment.changed',order_id:'order',order_number:'UM-123',total_paise:42000,status:'CAPTURED',at:'2026-10-07T00:00:00Z'}, {order_number:'forged',campaign_name:'Launch'});
  expect(variables).toMatchObject({name:'Customer',order_number:'UM-123',total_paise:42000,payment_status:'CAPTURED',campaign_name:'Launch',message_body:'Payment received'});expect(variables).not.toHaveProperty('email');expect(variables).not.toHaveProperty('status');
 });
 it('does not invent order values for a scheduled campaign',()=>{expect(resolveMessageVariables({name:'Customer'}, {title:'Editorial',body:'Weekly'}, {}, {campaign_name:'Editorial'})).not.toHaveProperty('order_number');});
});
