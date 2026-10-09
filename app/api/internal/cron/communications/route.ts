import { safeEqual } from '@/lib/commerce/crypto';
import { dispatchCommunications } from '@/lib/communications/rules';
import { verifyTransport,consumerUrl } from '@/lib/communications/transport';
export const runtime='nodejs';
export async function GET(request:Request){
 const secret=process.env.CRON_SECRET;const supplied=request.headers.get('authorization');
 if(!secret||!supplied||!safeEqual(supplied,`Bearer ${secret}`))return Response.json({error:'UNAUTHORIZED'},{status:401});
 try{return Response.json(await dispatchCommunications());}catch{return Response.json({error:'DISPATCH_UNAVAILABLE'},{status:503});}
}
// A single manually configured QStash schedule gives sub-day cadence on Vercel Hobby.
// It shares the same bounded dispatcher; neither cron path sends provider messages.
export async function POST(request:Request){
 const body=await request.text();if(body.length>512)return Response.json({error:'INVALID_BODY'},{status:400});
 try{
  const url=new URL('/api/internal/cron/communications',consumerUrl()).href;
  if(!await verifyTransport(request,body,url))return Response.json({error:'UNAUTHORIZED'},{status:401});
  return Response.json(await dispatchCommunications());
 }catch{return Response.json({error:'DISPATCH_UNAVAILABLE'},{status:503});}
}
