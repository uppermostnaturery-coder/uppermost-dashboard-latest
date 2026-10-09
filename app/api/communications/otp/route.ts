import { z } from 'zod';
import { createOtp,verifyOtp } from '@/lib/communications/otp';
import { assertCommerceOrigin,commerceCorsHeaders,commerceJson,errorResponse,readJsonBody,enforceRateLimit } from '@/lib/commerce/http';
const input=z.union([
 z.object({operation:z.literal('CREATE'),phone:z.string().regex(/^\+?[1-9]\d{9,14}$/).optional(),email:z.email().max(254).optional()}).strict().refine(v=>v.phone||v.email),
 z.object({operation:z.literal('VERIFY'),challenge_id:z.uuid(),code:z.string().regex(/^\d{6}$/)}).strict(),
]);
export async function OPTIONS(request:Request){return new Response(null,{status:204,headers:commerceCorsHeaders(request.headers.get('origin'))});}
export async function POST(request:Request){let origin:string|null=null;try{
 origin=assertCommerceOrigin(request);enforceRateLimit(request,'otp',10);const value=input.parse(await readJsonBody(request));
 if(value.operation==='VERIFY')return commerceJson({verified:await verifyOtp(value.challenge_id,value.code)},200,origin);
 return commerceJson(await createOtp(value.phone?.replace(/\D/g,'')||null,value.email?.toLowerCase()||null,request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()||'unknown'),202,origin);
}catch(error){return errorResponse(error,origin);}}
