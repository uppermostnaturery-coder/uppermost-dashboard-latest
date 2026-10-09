import { describe, expect, it } from "vitest";
import { offerSchema,offerEditableFields } from "../../lib/admin/offersSchema";
describe("existing promotion vocabulary", () => {
 it("accepts actual engine conditions and actions and rejects invented discounts", () => {
  const offer = { code:'REPEAT',label:'Repeat offer',status:'DRAFT',conditions:{lifecycle:['RENEWAL'],minimum_subscription_cycle:2},actions:[{type:'PERCENT_OFF',percent:10,scope:'CART'}] };
  expect(offerSchema.parse(offer).actions[0].type).toBe('PERCENT_OFF');
  expect(offerEditableFields({...offer,id:'row',version:1,usage_count:3,created_at:'timestamp'})).not.toHaveProperty('created_at');
  expect(() => offerSchema.parse({...offer,actions:[{type:'CLIENT_PRICE',amount_paise:1}]})).toThrow();
  expect(() => offerSchema.parse({...offer,actions:[{type:'PERCENT_OFF',percent:110}]})).toThrow();
  expect(() => offerSchema.parse({...offer,usage_count:0})).toThrow();
 });
});
