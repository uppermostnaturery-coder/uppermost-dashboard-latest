import { requireAdmin,adminErrorResponse } from '@/lib/admin/auth';
import { db,assertDb } from '@/lib/communications/store';
import { z,ZodError } from 'zod';
import { validateAnalyticsId } from '@/lib/analytics/identity';
export const dynamic='force-dynamic';
interface JourneyOrdering extends PromiseLike<{data:unknown[]|null;error:{message:string}|null}>{order(column:string,options:{ascending:boolean}):JourneyOrdering;limit(count:number):JourneyOrdering;}
interface JourneyFilter extends JourneyOrdering {lt(column:string,value:string):JourneyFilter;or(filters:string):JourneyFilter;}
export async function GET(request:Request){try{
 await requireAdmin(request);const params=new URL(request.url).searchParams;
 const customer=z.uuid().parse(params.get('customer_id'));const before=z.iso.datetime().parse(params.get('before')||new Date().toISOString());
 const source=z.enum(['identity','analytics','orders','payments','subscriptions','shipments','communications','leads']).parse(params.get('source')||'identity');
 const linkCursor=params.get('link_cursor');if(linkCursor)z.uuid().parse(linkCursor);
 let linkQuery=db.from('analytics_identity_links').select('*').eq('customer_id',customer).order('id').limit(50);if(linkCursor)linkQuery=linkQuery.gt('id',linkCursor);
 const links=await linkQuery;assertDb(links);
 if(source==='identity')return Response.json({data:links.data,next_link_cursor:links.data?.[49]?.id||null});
 const cursor=params.get('before_id');if(cursor){if(source==='analytics')z.string().regex(/^[0-9]{1,20}$/).parse(cursor);else z.uuid().parse(cursor);}
 const page=(query:JourneyFilter)=>{
  // Timestamp + immutable ID prevents losing events with equal timestamps.
  const bounded=cursor?query.or(`created_at.lt.${before},and(created_at.eq.${before},id.lt.${cursor})`):query.lt('created_at',before);
  return bounded.order('created_at',{ascending:false}).order('id',{ascending:false}).limit(50);
 };
 const pagination=(rows:{id:string|number;created_at:string}[]|null)=>rows?.length===50?{before:rows[49].created_at,before_id:String(rows[49].id)}:null;
 if(source==='analytics'){
  const visitor=z.string().refine(value=>validateAnalyticsId(value,'v_')!==null).parse(params.get('visitor_id'));
  const linkId=params.get('link_id');if(linkId)z.uuid().parse(linkId);
  const linked=linkId?await db.from('analytics_identity_links').select('*').eq('id',linkId).eq('customer_id',customer).eq('visitor_id',visitor).maybeSingle():null;if(linked)assertDb(linked);
  const link=linked?.data||(linkId?null:(links.data||[]).filter(v=>v.visitor_id===visitor).sort((a,b)=>b.valid_from.localeCompare(a.valid_from))[0]);if(!link)return Response.json({error:'UNLINKED_VISITOR'},{status:404});
  const result=await page(db.from('analytics_events').select('id,visitor_id,session_id,event_name,metadata,created_at,page_path').eq('visitor_id',visitor).gte('created_at',link.valid_from).lt('created_at',link.valid_until||new Date().toISOString()));assertDb(result);
  const events=result.data as unknown as {id:number;created_at:string;session_id:string}[]|null;
  return Response.json({data:(events||[]).map(e=>({...e,identity_confidence:e.session_id===link.identified_session_id&&link.confidence==='VERIFIED'?'VERIFIED_SESSION':'IDENTIFIED_BROWSER'})),next_cursor:pagination(events)});
 }
 const definition={orders:['orders','id,status,total_paise,created_at'],payments:['payment_attempts','id,order_id,status,created_at'],subscriptions:['subscriptions','id,status,interval_days,next_charge_at,created_at'],shipments:['shipments','id,order_id,status,created_at'],communications:['customer_messages','id,message_key,title,status,created_at'],leads:['um_leads','id,email,created_at']}[source];
 if(source==='payments'||source==='shipments'){
  const orderId=z.uuid().parse(params.get('order_id'));const order=await db.from('orders').select('customer_id').eq('id',orderId).eq('customer_id',customer).maybeSingle();assertDb(order);if(!order.data)return Response.json({error:'ORDER_NOT_FOUND'},{status:404});
  const result=await page(db.from(definition[0]).select(definition[1]).eq('order_id',orderId));assertDb(result);return Response.json({data:result.data,next_cursor:pagination(result.data as unknown as {id:string;created_at:string}[]|null)});
 }
 if(source==='leads')return Response.json({data:[],reason:'UNVERIFIED_LEAD_MATCHING_DISABLED'});
 const result=await page(db.from(definition[0]).select(definition[1]).eq('customer_id',customer));assertDb(result);return Response.json({data:result.data,next_cursor:pagination(result.data as unknown as {id:string;created_at:string}[]|null)});
}catch(error){if(error instanceof ZodError)return Response.json({error:'INVALID_JOURNEY_QUERY'},{status:400});return adminErrorResponse(error);}}
