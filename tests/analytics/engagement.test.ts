import {describe,it,expect} from 'vitest';
import {visitorEngagement,buttonInterest} from '../../lib/analytics/engagement';
import type {AnalyticsEvent} from '../../lib/analytics/summary';
const e=(id:number,name:string,sec:number,text='',visitor='browser-a',path='/ghee',session='s-a'):AnalyticsEvent=>({id,event_name:name,created_at:new Date(Date.UTC(2026,9,21,0,0,sec)).toISOString(),visitor_id:visitor,session_id:session,page_path:path,metadata:{text}});
describe('observed visitor engagement',()=>{
 it('separates page intervals and excludes idle gaps, other sessions and unknown duration',()=>{
  const r=visitorEngagement([e(1,'page_view',0),e(2,'scroll_depth_50',20),e(3,'page_view',30,'','browser-a','/about'),e(4,'button_click',45,'Know more','browser-a','/about'),e(5,'heartbeat',600,'','browser-a','/about'),e(6,'page_view',900,'','browser-a','/ghee','s-b')]);
  expect(r.observed_seconds).toBe(45);expect(r.scroll_depth).toBe(50);expect(r.pages.find(p=>p.path==='/ghee')?.observed_seconds).toBe(30);expect(r.clicks).toBe(1);expect(r.score).toBe(100);
  expect(visitorEngagement([e(1,'page_view',0)]).observed_seconds).toBeNull();expect(visitorEngagement([e(1,'page_view',0)]).scroll_depth).toBeNull();
 });
 it('counts paired click trackers once, preserves genuine repeats and never exposes raw metadata',()=>{
  const a=e(1,'button_click',0,'Pre-order'),b=e(2,'buy_now_click',0,'Pre-order');
  const r=visitorEngagement([a,b,e(3,'button_click',2,'Pre-order')]);expect(r.clicks).toBe(2);expect(JSON.stringify(r)).not.toContain('Pre-order');
 });
});
describe('product and checkout button interest',()=>{
 it('counts distinct known browsers separately from clicks and excludes similarly named image buttons',()=>{
  const r=buttonInterest([e(1,'button_click',0,'Gir cow'),e(2,'button_click',2,'Gir cow'),e(3,'button_click',3,'Gir cow','browser-b'),e(4,'button_click',4,'The Pair, styled'),e(5,'button_click',5,'Pay ₹7,000 securely'),e(6,'buy_now_click',5,'Pay ₹7,000 securely')]);
  expect(r.find(x=>x.key==='gir')).toMatchObject({users:2,clicks:3});expect(r.find(x=>x.key==='pair')?.clicks).toBe(0);expect(r.find(x=>x.key==='pay')?.clicks).toBe(1);
 });
});
