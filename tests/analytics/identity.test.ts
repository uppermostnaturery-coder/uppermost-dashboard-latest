import { describe, expect, it, vi } from "vitest";
import { validateAnalyticsId, bestEffortIdentityLink } from "../../lib/analytics/identity";
import { parseAnalyticsBatch } from "../../lib/analytics/schema";

const visitor = "v_123e4567-e89b-42d3-a456-426614174000";
const session = "s_123e4567-e89b-42d3-a456-426614174001";
describe("analytics context is optional and untrusted", () => {
  it("ignores malformed IDs without rejecting commerce", () => {
    expect(validateAnalyticsId(visitor, "v_")).toBe(visitor);
    expect(validateAnalyticsId('v_id-1791366000000-abc123','v_')).toBe('v_id-1791366000000-abc123');
    for (const value of [null, "", "customer-id", "v_" + "a".repeat(200), visitor + "\n", session]) expect(validateAnalyticsId(value, "v_")).toBeNull();
  });
  it("isolates identity failures after customer resolution", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    const link = vi.fn().mockRejectedValue(new Error("db unavailable"));
    await expect(bestEffortIdentityLink({ customerId: "customer", visitorId: visitor, sessionId: session }, link)).resolves.toBeUndefined();
    expect(link).toHaveBeenCalledOnce();
    expect(warning).toHaveBeenCalledWith("analytics_identity_link_failed", { customerId: "customer", reason: "Error" });
    warning.mockRestore();
  });
});
describe("bounded telemetry", () => {
  const batch = { visitorId: visitor, sessionId: session, events: [{ event_name: "product_view", created_at: new Date().toISOString(), metadata: { product_code: "GIR" } }] };
  it("accepts compact events and rejects customer identity supplied by browsers", () => {
    expect(parseAnalyticsBatch(batch).events[0].metadata).toEqual({ product_code: "GIR" });
    expect(parseAnalyticsBatch({...batch,events:[{...batch.events[0],metadata:{class_name:'checkout',tag_name:'BUTTON'}}]}).events).toHaveLength(1);
    expect(() => parseAnalyticsBatch({ ...batch, customer_id: "forged" })).toThrow();
  });
  it("rejects unbounded batches, PII, unsafe URLs and deep metadata", () => {
    expect(() => parseAnalyticsBatch({ ...batch, events: Array(51).fill(batch.events[0]) })).toThrow();
    expect(() => parseAnalyticsBatch({ ...batch, events: [{ ...batch.events[0], metadata: { email: "secret" } }] })).toThrow();
    expect(() => parseAnalyticsBatch({ ...batch, events: [{ ...batch.events[0], page_url: "javascript:alert(1)" }] })).toThrow();
    expect(() => parseAnalyticsBatch({ ...batch, events: [{ ...batch.events[0], metadata: { a: { b: { c: { d: { e: 1 } } } } } }] })).toThrow();
  });
});
