import { z } from 'zod';
import { verifyTransport } from '@/lib/communications/transport';
import { consumeOutbox } from '@/lib/communications/consumer';
export const runtime='nodejs';
export async function POST(request:Request){
 const body=await request.text();if(body.length>512||!await verifyTransport(request,body))return Response.json({error:'INVALID_SIGNATURE'},{status:401});
 try{const {outbox_id}=z.object({outbox_id:z.uuid()}).strict().parse(JSON.parse(body));await consumeOutbox(outbox_id);return Response.json({ok:true});}
 catch{return Response.json({error:'CONSUMER_UNAVAILABLE'},{status:503});}
}
