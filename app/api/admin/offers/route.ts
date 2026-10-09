import { requireAdmin,assertSameOrigin,adminErrorResponse } from '@/lib/admin/auth';
import { saveOffer,simulateOffer } from '@/lib/admin/offers';
import { db,assertDb } from '@/lib/communications/store';
import { readJsonBody } from '@/lib/commerce/http';
import { z,ZodError } from 'zod';
export const dynamic='force-dynamic';
export async function GET(request:Request){try{const operator=await requireAdmin(request);const url=new URL(request.url);const history=url.searchParams.get('history');
 if(history){z.uuid().parse(history);const result=await db.from('promotion_versions').select('*').eq('promotion_id',history).order('version',{ascending:false}).limit(100);assertDb(result);return Response.json({data:result.data,role:operator.role});}
 const result=await db.from('promotions').select('*').order('priority',{ascending:false}).limit(500);assertDb(result);return Response.json({data:result.data,role:operator.role});
}catch(error){return adminErrorResponse(error);}}
export async function POST(request:Request){try{assertSameOrigin(request);const body=await readJsonBody(request) as Record<string,unknown>;const operator=await requireAdmin(request,body.operation!=='SIMULATE');
 const data=body.operation==='SIMULATE'?await simulateOffer(body.input):await saveOffer(body.input,operator.userId);return Response.json({data});
}catch(error){if(error instanceof ZodError)return Response.json({error:'INVALID_OFFER',issues:error.issues},{status:400});return adminErrorResponse(error);}}
