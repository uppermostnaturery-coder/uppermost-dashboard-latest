import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
vi.mock("../../lib/communications/store", () => ({db:{},rpc:vi.fn(),assertDb:vi.fn()}));
import { ruleSchema } from "../../lib/communications/rules";
import { evaluateCondition, parseCondition } from "../../lib/communications/dsl";
import { nextRuns } from "../../lib/communications/schedule";
const config=JSON.parse(readFileSync("docs/staging-automation-rules.json","utf8"));
const now=new Date("2026-10-28T12:00:00Z");
const base={email_marketing_allowed:true,cart_value_paise:10000,cart_checkout_started:false,cart_converted:false,last_cart_activity_at:"2026-10-28T11:00:00Z"};
const fixtures:Record<string,[Record<string,unknown>,Record<string,unknown>]> = {
  UPPERMOST_WELCOME_V1:[{email_marketing_allowed:true},{email_marketing_allowed:false}],
  UPPERMOST_CART_RECOVERY_V1:[base,{...base,cart_converted:true}],
  UPPERMOST_CHECKOUT_RECOVERY_V1:[{...base,cart_checkout_started:true,last_checkout_started_at:"2026-10-28T11:00:00Z"},{...base,cart_checkout_started:true,last_checkout_started_at:"2026-10-28T11:00:01Z"}],
  UPPERMOST_ORDER_CONFIRMATION_V1:[{order_count:1},{order_count:0}],
  UPPERMOST_PAYMENT_FAILED_V1:[{last_payment_status:"FAILED"},{last_payment_status:"CAPTURED"}],
  UPPERMOST_SHIPPING_UPDATE_V1:[{last_shipment_status:"In Transit"},{last_shipment_status:"Delivered"}],
  UPPERMOST_DELIVERY_CONFIRMATION_V1:[{last_shipment_status:"Delivered"},{last_shipment_status:"RTO Delivered"}],
  UPPERMOST_PRODUCT_CARE_V1:[{email_marketing_allowed:true,last_shipment_status:"Delivered",last_shipment_at:"2026-10-27T12:00:00Z"},{email_marketing_allowed:true,last_shipment_status:"Delivered",last_shipment_at:"2026-10-28T11:00:00Z"}],
  UPPERMOST_REPLENISHMENT_REMINDER_V1:[{email_marketing_allowed:true,last_shipment_status:"Delivered",last_shipment_at:"2026-09-28T12:00:00Z",active_subscription_count:0},{email_marketing_allowed:true,last_shipment_status:"Delivered",last_shipment_at:"2026-09-28T12:00:00Z",active_subscription_count:1}],
};
describe("nine staging-only draft rule configurations",()=>{
  it("keeps every rule unscheduled and DRAFT",()=>{
    expect(config.project_ref).toBe("jwsivyxapfnyaafdcdos");expect(config.activation_ready).toBe(false);
    expect(config.next_run_at).toBeNull();expect(config.rules).toHaveLength(9);
    expect(new Set(config.rules.map((r:{name:string})=>r.name)).size).toBe(9);
  });
  for(const r of config.rules) it(r.name+" validates and admits only its intended fixture",()=>{
    const parsed=ruleSchema.parse(r);expect(parsed.status).toBe("DRAFT");
    const [yes,no]=fixtures[r.name];
    expect(evaluateCondition(parseCondition(parsed.condition_config),yes,now)).toBe(true);
    expect(evaluateCondition(parseCondition(parsed.condition_config),no,now)).toBe(false);
    expect(evaluateCondition(parseCondition(parsed.condition_config),{},now)).toBe(false);
    if(parsed.trigger_type==="SCHEDULE")expect(nextRuns(parsed.cron_expression!,parsed.timezone,now,1)).toEqual(["2026-10-28T12:15:00.000Z"]);
  });
});
