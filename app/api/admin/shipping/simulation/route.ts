import {z,ZodError} from 'zod';
import {requireAdmin,assertSameOrigin,adminErrorResponse} from '@/lib/admin/auth';
import {CommerceError,readJsonBody} from '@/lib/commerce/http';
import {stagingShippingSimulation} from '@/lib/commerce/shiprocket/simulationConfig';
import {transitionSimulatedShipment} from '@/lib/commerce/shiprocket/simulation';

export const runtime='nodejs';
const transition=z.object({order_id:z.uuid(),shipment_id:z.uuid(),event_id:z.uuid(),status:z.enum(['SHIPPED','OUT_FOR_DELIVERY','DELIVERED'])}).strict();
export async function POST(request:Request){
 try{
  // Disabled/mismatched mode never authenticates against another environment.
  if(!stagingShippingSimulation())return Response.json({error:'SHIPPING_SIMULATION_DISABLED'},{status:404});
  assertSameOrigin(request);
  const actor=await requireAdmin(request,true);
  const input=transition.parse(await readJsonBody(request));
  return Response.json({ok:true,...await transitionSimulatedShipment(input,actor.userId)},{headers:{'Cache-Control':'no-store'}});
 }catch(error){
  if(error instanceof CommerceError)return Response.json({error:error.code},{status:error.status});
  if(error instanceof ZodError)return Response.json({error:'INVALID_SIMULATION_TRANSITION'},{status:400});
  return adminErrorResponse(error);
 }
}
