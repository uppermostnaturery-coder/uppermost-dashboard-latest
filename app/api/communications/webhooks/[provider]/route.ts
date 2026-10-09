import { safeEqual } from '@/lib/commerce/crypto';
import { recordProviderEvent } from '@/lib/communications/webhooks';
import { normalizeCallback } from '@/lib/communications/callbacks';
// MSG91 uses its configured header; Lemlist also supports its documented echoed body secret.
export async function POST(request:Request,{params}:{params:Promise<{provider:string}>}){
 const resolved=await params;
 const provider=resolved.provider==='msg91'?'MSG91':resolved.provider==='lemlist'?'LEMLIST':null;
 const token=provider&&process.env[`${provider}_COMMUNICATION_WEBHOOK_TOKEN`];const supplied=request.headers.get('authorization');
 if(!provider||!token)return Response.json({error:'UNAUTHORIZED'},{status:401});
 const headerVerified=!!supplied&&safeEqual(supplied,`Bearer ${token}`);
 if(provider==='MSG91'&&!headerVerified)return Response.json({error:'UNAUTHORIZED'},{status:401});
 let payload:unknown;try{const body=await request.text();if(Buffer.byteLength(body,'utf8')>32768)throw new Error('BOUND');payload=JSON.parse(body);}catch{return Response.json({error:'INVALID_EVENT'},{status:400});}
 const secret=payload&&typeof payload==='object'&&'secret' in payload?(payload as {secret:unknown}).secret:null;
 if(!headerVerified&&!(provider==='LEMLIST'&&typeof secret==='string'&&safeEqual(secret,token)))return Response.json({error:'UNAUTHORIZED'},{status:401});
 let events;try{const batch=Array.isArray(payload)?payload:[payload];if(batch.length>50)throw new Error('BOUND');events=batch.map(p=>normalizeCallback(provider,p)).filter(p=>p!==null);}catch{return Response.json({error:'INVALID_EVENT'},{status:400});}
 try{for(const event of events)await recordProviderEvent(provider,event.message_id,event.status,event.timestamp,event.email,event.correlation);return Response.json({ok:true});}catch{return Response.json({error:'PERSISTENCE_UNAVAILABLE'},{status:503});}
}
