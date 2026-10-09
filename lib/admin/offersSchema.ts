import { z } from "zod";
const strings = z.array(z.string().min(1).max(100)).max(30);
const money = z.number().int().min(0).max(100000000);
export const promotionConditionsSchema = z.object({
 skus:strings.optional(),product_codes:strings.optional(),required_product_codes:strings.optional(),minimum_cart_value_paise:money.optional(),minimum_quantity:z.number().int().min(1).max(1000).optional(),
 purchase_modes:z.union([z.array(z.enum(["BUY_ONCE","SUBSCRIPTION"])).max(2),z.tuple([z.literal("MIXED")])]).optional(),lifecycle:z.array(z.enum(["INITIAL","RENEWAL"])).max(2).optional(),
 minimum_subscription_cycle:z.number().int().min(1).optional(),maximum_subscription_cycle:z.number().int().min(1).optional(),
 audience:z.enum(["ALL","NEW_SUBSCRIBERS","EXISTING_SUBSCRIBERS","NEW_SUBSCRIBERS_AND_BUYERS"]).optional(),customer_cohorts:strings.optional(),requires_entitlement:z.boolean().optional(),first_order_only:z.boolean().optional(),returning_customer_only:z.boolean().optional(),countries:strings.optional(),
}).strict();
export const promotionActionSchema = z.object({
 type:z.enum(["AMOUNT_OFF","PERCENT_OFF","FIXED_BUNDLE_PRICE","FREE_SHIPPING","SHIPPING_DISCOUNT","FREE_GIFT","FREE_GIFT_WRAP","BUY_X_GET_Y","INFORMATIONAL"]),
 amount_paise:money.optional(),percent:z.number().min(0).max(100).optional(),fixed_price_paise:money.optional(),scope:z.enum(["CART","MATCHING_LINES","SHIPPING"]).optional(),label:z.string().max(200).optional(),metadata:z.record(z.string(),z.unknown()).optional(),
}).strict().superRefine((v,c) => {
 if ((v.type==='PERCENT_OFF' && v.percent===undefined) || (['AMOUNT_OFF','SHIPPING_DISCOUNT'].includes(v.type) && v.amount_paise===undefined) || (v.type==='FIXED_BUNDLE_PRICE' && v.fixed_price_paise===undefined)) c.addIssue({code:'custom',message:'Action amount required'});
 if (JSON.stringify(v.metadata || {}).length>4096) c.addIssue({code:'custom',message:'Metadata too large'});
});
export const offerSchema = z.object({
 code:z.string().regex(/^[A-Z0-9_-]{1,64}$/),label:z.string().min(1).max(200),status:z.enum(["DRAFT","ACTIVE","PAUSED","ARCHIVED"]).default('DRAFT'),
 valid_from:z.iso.datetime().nullable().optional(),valid_until:z.iso.datetime().nullable().optional(),conditions:promotionConditionsSchema,actions:z.array(promotionActionSchema).min(1).max(20),
 priority:z.number().int().min(-1000).max(1000).default(0),stackable:z.boolean().default(false),stacking_group:z.string().max(100).nullable().optional(),usage_limit:z.number().int().min(1).nullable().optional(),
}).strict().refine((v) => !v.valid_from || !v.valid_until || v.valid_until>v.valid_from,'Invalid validity range');
export function offerEditableFields(row:Record<string,unknown>){
 return offerSchema.parse(Object.fromEntries(Object.keys(offerSchema.shape).filter(key=>row[key]!==undefined).map(key=>[key,row[key]])));
}
