import {deduplicateEvents,safePath,type AnalyticsEvent} from './summary';
/** Merge generic/legacy records of the same action without discarding genuine repeats. */
function clicks(events:AnalyticsEvent[]) {
 return deduplicateEvents(events.filter(e=>['button_click','buy_now_click','add_to_cart','remove_from_cart'].includes(e.event_name)).map(e=>({...e,event_name:'click',metadata:{...e.metadata,source:`${e.event_name}:${e.metadata?.source||e.metadata?.action_type||'legacy'}`}})));
}
const actions=[['gir','Gir',/^(?:gir|gir cow|gir cow ghee|choose gir)$/],['murrah','Murrah',/^(?:murrah|murrah buffalo|murrah buffalo ghee|choose murrah)$/],['pair','The Pair',/^the pair$/],['individual','Individual Jar',/^individual jar$/],['litre','1 litre',/^(?:1 litre|1 liter|1l|1 l)$/],['half','500 ml',/^(?:500 ml|500ml)$/],['subscribe','Subscribe',/^subscribe(?: & save)?$/],['preorder','Pre-order',/^pre[- ]?order$/],['pay','Pay securely',/^pay(?: ₹[\d,.]+)? securely$/]] as const;
export function buttonInterest(events:AnalyticsEvent[]) {
 const records=clicks(events);
 return actions.map(([key,label,pattern])=>{const hits=records.filter(e=>pattern.test((e.metadata?.text||'').replace(/\s+/g,' ').trim().toLowerCase()));return {key,label,users:new Set(hits.map(e=>e.visitor_id).filter(Boolean)).size,clicks:hits.length};});
}
export function visitorEngagement(input:AnalyticsEvent[]) {
 const events=deduplicateEvents(input), pageMap=new Map<string,{path:string,scroll_depth:number|null,observed_seconds:number|null}>();
 const previous=new Map<string,AnalyticsEvent>();let total=0,hasTime=false,depth:number|null=null;
 for(const e of events){
  const path=safePath(e.page_path),page=pageMap.get(path)||{path,scroll_depth:null,observed_seconds:null};pageMap.set(path,page);
  const match=/^scroll_depth_(25|50|75|100)$/.exec(e.event_name);
  if(match){page.scroll_depth=Math.max(page.scroll_depth||0,Number(match[1]));depth=Math.max(depth||0,Number(match[1]));}
  // Never join independent sessions or infer a duration for unpaired observations.
  if(!e.session_id)continue;
  const prev=previous.get(e.session_id);
  if(prev){const seconds=(Date.parse(e.created_at)-Date.parse(prev.created_at))/1000;
   if(seconds>0&&seconds<=60){const p=pageMap.get(safePath(prev.page_path))!;p.observed_seconds=(p.observed_seconds||0)+seconds;total+=seconds;hasTime=true;}}
  if(e.event_name==='session_end')previous.delete(e.session_id);else previous.set(e.session_id,e);
 }
 const count=clicks(events).length,viewed=new Set(events.filter(e=>e.event_name==='page_view').map(e=>safePath(e.page_path))).size;
 const score=(count?40:0)+((depth||0)>=50?30:0)+(total>=30?20:0)+(viewed>=2?10:0);
 return {scroll_depth:depth,observed_seconds:hasTime?Math.round(total):null,clicks:count,score,level:score>=70?'High':score>=30?'Some':'Low',pages:[...pageMap.values()].map(p=>({...p,observed_seconds:p.observed_seconds===null?null:Math.round(p.observed_seconds)}))};
}
export type Engagement=ReturnType<typeof visitorEngagement>;
export const ENGAGEMENT_NOTE='Observed score /100: any button click 40; scroll ≥50% 30; observed time ≥30s 20; ≥2 distinct pages viewed 10. A descriptive activity score, not a purchase probability. Time sums adjacent recorded events within the same session, credited to the preceding page; gaps >60s and unpaired final events are excluded. It is an estimate, not verified active reading time. Missing scroll/time means not recorded.';
