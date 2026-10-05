import { beforeAll, describe, expect, it } from "vitest";

beforeAll(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
});

describe("renewal schedule boundaries", () => {
  it.each([15, 30, 60])("uses exactly %i UTC days", async (intervalDays) => {
    const { addExactUtcDays } = await import("../../lib/commerce/subscriptions/schedule");
    const start = "2026-01-31T12:30:00.000Z";
    expect(new Date(addExactUtcDays(start, intervalDays)).getTime() - new Date(start).getTime())
      .toBe(intervalDays * 86_400_000);
  });

  it("rejects an unsupported calendar-like interval", async () => {
    const { assertSubscriptionIntervalDays } = await import("../../lib/commerce/subscriptions/schedule");
    expect(() => assertSubscriptionIntervalDays(31)).toThrow(/15, 30, or 60/);
  });

  it("separates notification and debit timing", async () => {
    const { renewalScheduleForDueAt } = await import("../../lib/commerce/subscriptions/schedule");
    expect(renewalScheduleForDueAt("2026-10-10T10:00:00.000Z")).toEqual({
      notificationDueAt: "2026-10-08T08:00:00.000Z",
      scheduledChargeAt: "2026-10-10T10:00:00.000Z",
    });
  });

  it("accepts an explicit due-item subset and quantities greater than one", async () => {
    const { selectDueCycleItems } = await import("../../lib/commerce/subscriptions/schedule");
    const all = [
      { id: "oil", sku: "MUSTARD-1000", quantity: 2 },
      { id: "honey", sku: "HONEY-500", quantity: 1 },
    ];
    expect(selectDueCycleItems([all[0]])).toEqual([all[0]]);
    expect(selectDueCycleItems([all[0]])).not.toBe(all);
  });

  it("allows exactly the mandate cap and blocks one paise above", async () => {
    const { isAboveMandateCap } = await import("../../lib/commerce/renewals");
    expect(isAboveMandateCap(500_000, 500_000)).toBe(false);
    expect(isAboveMandateCap(500_001, 500_000)).toBe(true);
  });

  it("uses bounded exponential renewal retry delays", async () => {
    const { retryDelayMs } = await import("../../lib/commerce/renewals");
    expect(retryDelayMs(1)).toBe(24 * 60 * 60 * 1000);
    expect(retryDelayMs(2)).toBe(48 * 60 * 60 * 1000);
  });
});
