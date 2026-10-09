import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe,it,expect,vi } from 'vitest';
import { parseAnalyticsBatch } from '../../lib/analytics/schema';
describe('external GTM transport patch',()=>{
 it('reuses active identity, preserves dimensions/offline state and emits valid privacy-bounded batches',async()=>{
  const requests:Record<string,unknown>[]=[];
  const context:Record<string,any>={visitorId:'v_id-1791366000000-abc',sessionId:'s_123e4567-e89b-42d3-a456-426614174000',window:{location:{href:'https://www.uppermost.store/ghee?email=private#fragment',pathname:'/ghee'}},document:{title:'Ghee',referrer:'https://example.test/?token=private'},getDeviceType:()=> 'mobile',getBrowser:()=> 'Safari',getOS:()=> 'iOS',getTimeZone:()=> 'Asia/Kolkata',getGeoField:()=> null,getUTM:()=> null,URL,fetch:vi.fn(async(_:string,init:RequestInit)=>{const body=JSON.parse(String(init.body));requests.push(body);parseAnalyticsBatch(body);return new Response(null,{status:202});})};
  runInNewContext(readFileSync('docs/integrations/gtm-communications-patch.js','utf8'),context);
  expect(context.window.uppermostAnalytics.getIdentity()).toEqual({visitorId:context.visitorId,sessionId:context.sessionId});
  await context.window.uppermostTrack('button_click',{tag_name:'BUTTON',class_name:'checkout',text:'Private name',href:'mailto:private@example.test'});
  await context.upsertVisitor(false);await context.window.uppermostTrack('session_end',{});
  expect(requests[0]).toMatchObject({device_type:'mobile',timezone:'Asia/Kolkata'});
  expect(JSON.stringify(requests)).not.toMatch(/private|Private/);
  expect(requests[1].is_online).toBe(false);expect(requests[2].is_online).toBe(false);
  context.sessionId='s_123e4567-e89b-42d3-a456-426614174001';expect(context.window.uppermostAnalytics.getIdentity().sessionId).toBe(context.sessionId);
 });
});
