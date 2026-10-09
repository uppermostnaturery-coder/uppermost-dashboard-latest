import { describe, expect, it } from "vitest";
import { parseCondition, evaluateCondition, compileCondition } from "../../lib/communications/dsl";
import { nextRuns } from "../../lib/communications/schedule";
describe("read-model rule DSL", () => {
  it("evaluates bounded all/any/none against one feature subject", () => {
    const rule = parseCondition({ all: [{ field: "order_count", op: "gte", value: 2 }, { none: [{ field: "cart_converted", op: "eq", value: true }] }] });
    expect(evaluateCondition(rule, { order_count: 2, cart_converted: false })).toBe(true);
    expect(evaluateCondition(rule, { order_count: 1, cart_converted: false })).toBe(false);
    expect(evaluateCondition(rule, { order_count: 3, cart_converted: true })).toBe(false);
  });
  it("rejects executable/unknown fields, unsafe types and runaway trees", () => {
    expect(() => parseCondition({ field: "orders.total", op: "eq", value: 0 })).toThrow();
    expect(() => parseCondition({ field: "order_count", op: "gte", value: "0);drop table orders" })).toThrow();
    expect(() => parseCondition({ all: Array(51).fill({ field: "order_count", op: "gte", value: 1 }) })).toThrow();
  });
  it("compiles only parameterized feature predicates with a bounded customer cursor", () => {
    const result = compileCondition(parseCondition({ field: "last_order_at", op: "days_since_gte", value: 30 }), new Date("2026-10-07T00:00:00Z"));
    expect(result.sql).toBe('"last_order_at" <= $1');
    expect(result.params).toEqual(["2026-09-07T00:00:00.000Z"]);
    expect(result.sql).not.toMatch(/orders|analytics_events|join/i);
  });
  it("calculates schedules in the configured timezone", () => {
    expect(nextRuns("0 10 * * 0", "Asia/Kolkata", new Date("2026-10-07T00:00:00Z"), 1)).toEqual(["2026-10-11T04:30:00.000Z"]);
    expect(() => nextRuns("invalid", "Asia/Kolkata", new Date(), 3)).toThrow();
  });
});
