import { z } from 'zod';
import { offerSchema } from './offersSchema';
import { db,rpc,assertDb } from '../communications/store';
import { AdminError } from './policy';
import { calculateCartQuote } from '../commerce/pricing/calculateCartQuote';
import { loadCatalogVariants } from '../commerce/catalog';
import type { PromotionDefinition } from '../commerce/types';
export async function saveOffer(input:unknown,actor:string){
 const v=z.object({id:z.uuid().nullable().default(null),expected_version:z.number().int().optional(),offer:offerSchema,change_reason:z.string().min(1).max(500)}).strict().parse(input);
 try{return await rpc('comm_save_promotion',{p_id:v.id,p_expected_version:v.expected_version||null,p_input:v.offer,p_actor:actor,p_reason:v.change_reason});}
 catch(error){if(error instanceof Error&&error.message.includes('PROMOTION_VERSION_CONFLICT'))throw new AdminError('PROMOTION_VERSION_CONFLICT',409);throw error;}
}
export const simulationSchema=z.object({
 items:z.array(z.object({line_id:z.string().min(1).max(64),sku:z.string().min(1).max(64),qty:z.number().int().min(1).max(100),purchase_mode:z.enum(['BUY_ONCE','SUBSCRIPTION']),interval_days:z.union([z.literal(15),z.literal(30),z.literal(60)]).optional()}).strict()).min(1).max(20),
 stage:z.enum(['INITIAL','RENEWAL']).default('INITIAL'),cycle_number:z.number().int().min(1).max(1000).default(1),
 customer_type:z.enum(['NEW','RETURNING','SUBSCRIBER']).default('NEW'),country:z.literal('IN').default('IN'),
 offer:offerSchema.optional(),
}).strict();
export async function simulateOffer(input:unknown){
 const v=simulationSchema.parse(input);const catalog=await loadCatalogVariants(v.items.map(i=>i.sku));
 const result=await db.from('promotions').select('*').limit(500);assertDb(result);
 const promotions=result.data as PromotionDefinition[];
 if(v.offer)promotions.push({...v.offer,id:'preview',status:'ACTIVE',version:1});
 return calculateCartQuote({items:v.stage==='RENEWAL'?v.items.filter(i=>i.purchase_mode==='SUBSCRIPTION'):v.items,catalog,promotions,context:{stage:v.stage,cycle_number:v.cycle_number,now:new Date().toISOString(),is_first_order:v.customer_type==='NEW',is_new_subscriber:v.customer_type==='NEW',is_returning_customer:v.customer_type!=='NEW',shipping_country:v.country}});
}
