import { db,rpc,assertDb } from './store';
export function quietHour(hour:number,start:number,end:number){return start===end?false:start<end?hour>=start&&hour<end:hour>=start||hour<end;}
export function isAllowedTestDestination(channel:string,destination:string){
 const source=channel==='EMAIL'||channel==='LEMLIST'?process.env.COMMUNICATION_ALLOWED_TEST_EMAILS:process.env.COMMUNICATION_ALLOWED_TEST_PHONES;
 const normalize=(v:string)=>channel==='EMAIL'||channel==='LEMLIST'?v.trim().toLowerCase():v.replace(/\D/g,'');
 return (source||'').split(',').filter(Boolean).map(normalize).includes(normalize(destination));
}
export async function deliveryPermission(args:{deliveryId:string;customerId:string;channel:string;category:string;rule:Record<string,unknown>;abandoned:boolean}){
 const channel=args.channel==='LEMLIST'?'EMAIL':args.channel;
 const purpose=args.category==='MARKETING'?'MARKETING':'TRANSACTIONAL';
 const preferences=await db.from('communication_preferences').select('allowed').eq('customer_id',args.customerId).eq('channel',channel).eq('purpose',purpose).maybeSingle();assertDb(preferences);
 if(preferences.data?.allowed===false||(purpose==='MARKETING'&&!preferences.data?.allowed))return 'CONSENT_REQUIRED';
 if(purpose!=='MARKETING')return null;
 const feature=await db.from('communication_customer_features').select('cart_converted,last_cart_activity_at,last_order_at').eq('customer_id',args.customerId).maybeSingle();assertDb(feature);
 if(args.abandoned&&(!feature.data||feature.data.cart_converted||!feature.data.last_cart_activity_at||Date.parse(feature.data.last_cart_activity_at)<=Date.parse(feature.data.last_order_at||'1970-01-01')))return 'CART_CONVERTED_OR_EMPTY';
 if(args.abandoned){const pending=await db.from('integration_outbox').select('id').eq('customer_id',args.customerId).eq('event_type','commerce.order.confirmed').neq('status','completed').limit(1);assertDb(pending);if(pending.data?.length)return 'PURCHASE_PROJECTION_PENDING';}
 const q=args.rule.quiet_hours as {start?:number;end?:number}|undefined;
 const hour=Number(new Intl.DateTimeFormat('en',{timeZone:String(args.rule.timezone||'Asia/Kolkata'),hour:'numeric',hourCycle:'h23'}).format(new Date()));
 if(quietHour(hour,q?.start??21,q?.end??9))return 'QUIET_HOURS';
 const caps=args.rule.frequency_cap as {weekly?:number;cooldown_hours?:number}|undefined;
 const allowed=await rpc<boolean>('comm_reserve_marketing',{p_delivery_id:args.deliveryId,p_customer_id:args.customerId,p_channel:channel,p_max_week:caps?.weekly??3,p_cooldown_hours:caps?.cooldown_hours??24});
 return allowed?null:'FREQUENCY_CAP';
}
