import { describe, expect, it, vi } from "vitest";
vi.mock("../../lib/communications/store", () => ({ db: {}, rpc: vi.fn(), assertDb: vi.fn() }));
import { ruleSchema } from "../../lib/communications/rules";
import { parseCondition, evaluateCondition, compileCondition } from "../../lib/communications/dsl";
describe("staging automation trigger compatibility", () => {
  it("accepts the existing completed-signup event without accepting arbitrary events", () => {
    const rule = { name: "Welcome", status: "DRAFT", trigger_type: "EVENT", trigger_event_type: "lead.completed", condition_config: {all: []}, action_config: {templates: {EMAIL: "1906f81c-7b75-42d9-be88-63e95d450cf0"}} };
    const result=ruleSchema.safeParse(rule); expect(result.success, JSON.stringify(result)).toBe(true);
    expect(ruleSchema.safeParse({...rule, trigger_event_type: "arbitrary.event"}).success).toBe(false);
  });
  it("uses the exact one-hour checkout boundary and rejects missing timestamps", () => {
    const c = parseCondition({field: "last_checkout_started_at", op: "hours_since_gte", value: 1});
    const now = new Date("2026-10-28T12:00:00Z");
    expect(evaluateCondition(c, {last_checkout_started_at: "2026-10-28T11:00:00Z"}, now)).toBe(true);
    expect(evaluateCondition(c, {last_checkout_started_at: "2026-10-28T11:00:01Z"}, now)).toBe(false);
    expect(evaluateCondition(c, {}, now)).toBe(false);
    expect(compileCondition(c, now)).toEqual({sql: '"last_checkout_started_at" <= $1', params: ["2026-10-28T11:00:00.000Z"]});
    expect(() => parseCondition({field:"order_count",op:"hours_since_gte",value:1})).toThrow();
    expect(() => parseCondition({field:"last_checkout_started_at",op:"hours_since_gte",value:-1})).toThrow();
  });
  it("measures product care from shipment time rather than purchase time", () => {
    const c = parseCondition({field: "last_shipment_at", op: "days_since_gte", value: 1});
    expect(evaluateCondition(c, {last_shipment_at: "2026-10-27T12:00:00Z"}, new Date("2026-10-28T12:00:00Z"))).toBe(true);
    expect(evaluateCondition(c, {last_order_at: "2026-10-01T00:00:00Z"}, new Date("2026-10-28T12:00:00Z"))).toBe(false);
  });
});
