import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const rpc = vi.fn();

vi.mock("../../lib/supabaseAdmin", () => ({
  supabaseAdmin: { rpc },
}));

beforeAll(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
});

beforeEach(() => {
  rpc.mockReset();
});

const cycleId = "a9dbc526-5b92-4890-a74e-4f9bf3fabee0";
const subscriptionId = "b83fffed-3840-4bd9-9da7-921bbf36f411";
const customerId = "ca25201e-83e3-43ae-a2a4-d00e725d5c3b";
const orderId = "01f8e678-80a5-4c48-9d25-7a8021a515fb";
const lockedAt = "2026-10-05T00:00:00.000Z";
const address = { country: "IN", city: "Gurugram" };
const quote = {
  currency: "INR",
  stage: "RENEWAL",
  items: [{
    line_id: "renewal-gir",
    product_id: "00000000-0000-4000-8000-000000000001",
    product_variant_id: "00000000-0000-4000-8000-000000000002",
    product_code: "GIR",
    product_name: "Gir Cow Ghee",
    sku: "GIR-1000",
    variant_name: "1 litre",
    size_label: "1 litre",
    qty: 1,
    purchase_mode: "SUBSCRIPTION",
    interval_days: 30,
    unit_price_paise: 925000,
    line_subtotal_paise: 925000,
    line_total_paise: 825000,
    weight_grams: 1000,
    dimensions_cm: { length: 10, breadth: 10, height: 15 },
  }],
  promotions_evaluated: [],
  promotions_applied: [],
  promotions_rejected: [],
  adjustments: [
    { promotion_id: "00000000-0000-4000-8000-000000000003", code: "THE_PAIR", label: "The Pair", type: "AMOUNT_OFF", scope: "CART", amount_paise: 50000, applies_to_line_ids: ["renewal-gir"] },
    { promotion_id: "00000000-0000-4000-8000-000000000004", code: "SUBSCRIBER_CYCLE_2", label: "Subscriber", type: "AMOUNT_OFF", scope: "CART", amount_paise: 50000, applies_to_line_ids: ["renewal-gir"] },
  ],
  benefits: [],
  subtotal_paise: 925000,
  discount_paise: 100000,
  shipping_paise: 0,
  tax_paise: 0,
  total_paise: 825000,
};
const snapshot = {
  quote,
  exact_cycle_items: quote.items,
  promotion_version: "test-version",
  stage: "RENEWAL",
  price_locked_at: lockedAt,
};
const existingOrder = {
  id: orderId,
  order_number: "UPM-20261005-000064",
  customer_id: customerId,
  subscription_id: subscriptionId,
  subscription_cycle_id: cycleId,
  order_kind: "RENEWAL",
  currency: "INR",
  subtotal_paise: 925000,
  discount_paise: 100000,
  shipping_paise: 0,
  tax_paise: 0,
  total_paise: 825000,
  address_snapshot: { city: "Gurugram", country: "IN" },
  pricing_snapshot: snapshot,
};
const identity = {
  cycleId,
  subscriptionId,
  customerId,
  addressSnapshot: address,
};

describe("renewal order recovery", () => {
  it("reuses the exact locked order snapshot and never reprices the orphaned cycle", async () => {
    const priceNewOrder = vi.fn();
    const { resolveRenewalPricing } = await import("../../lib/commerce/renewal-order");

    const pricing = await resolveRenewalPricing(existingOrder, identity, priceNewOrder);

    expect(priceNewOrder).not.toHaveBeenCalled();
    expect(pricing.quote).toMatchObject({
      subtotal_paise: 925000,
      discount_paise: 100000,
      total_paise: 825000,
    });
    expect(pricing.now).toBe(lockedAt);
  });

  it("recovers and links the same order on repeated/concurrent establishment", async () => {
    rpc
      .mockResolvedValueOnce({ data: [{ order_id: orderId, order_number: "UPM-20261005-000064", created: false }], error: null })
      .mockResolvedValueOnce({ data: [{ order_id: orderId, order_number: "UPM-20261005-000064", created: false }], error: null });
    const { establishRenewalOrder, lockedPricingFromRenewalOrder } = await import("../../lib/commerce/renewal-order");
    const pricing = lockedPricingFromRenewalOrder(existingOrder, identity);

    const results = await Promise.all([
      establishRenewalOrder({ identity, pricing }),
      establishRenewalOrder({ identity, pricing }),
    ]);

    expect(results.map((result) => result.id)).toEqual([orderId, orderId]);
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc.mock.calls[0][0]).toBe("establish_renewal_order");
    expect(rpc.mock.calls[0][1]).toMatchObject({
      p_cycle_id: cycleId,
      p_subscription_id: subscriptionId,
      p_customer_id: customerId,
      p_total_paise: 825000,
      p_pricing_snapshot: snapshot,
    });
  });

  it("fails closed when the recovered order conflicts materially", async () => {
    const { lockedPricingFromRenewalOrder } = await import("../../lib/commerce/renewal-order");
    expect(() => lockedPricingFromRenewalOrder({
      ...existingOrder,
      total_paise: 825001,
    }, identity)).toThrow(/amount conflicts/);
    expect(() => lockedPricingFromRenewalOrder({
      ...existingOrder,
      subscription_id: "00000000-0000-4000-8000-000000000099",
    }, identity)).toThrow(/identity/);
  });

  it("reuses one payment attempt for the cycle/provider order", async () => {
    rpc
      .mockResolvedValueOnce({ data: [{ payment_attempt_id: "attempt-1", created: true }], error: null })
      .mockResolvedValueOnce({ data: [{ payment_attempt_id: "attempt-1", created: false }], error: null });
    const { establishRenewalPaymentAttempt } = await import("../../lib/commerce/renewal-order");
    const input = {
      cycleId,
      orderId,
      providerOrderId: "order_Tk3dtVL4COB84H",
      amountPaise: 825000,
      notifiedAt: "2026-10-05T01:00:00.000Z",
      scheduledChargeAt: "2026-10-08T01:00:00.000Z",
    };

    const first = await establishRenewalPaymentAttempt(input);
    const duplicate = await establishRenewalPaymentAttempt(input);

    expect(first).toEqual({ id: "attempt-1", created: true });
    expect(duplicate).toEqual({ id: "attempt-1", created: false });
    expect(rpc.mock.calls.map((call) => call[0])).toEqual([
      "establish_renewal_payment_attempt",
      "establish_renewal_payment_attempt",
    ]);
  });

  it("retries a recovered local order only after a definite Razorpay rejection", async () => {
    const { canCreateRenewalProviderOrder } = await import("../../lib/commerce/renewal-order");
    expect(canCreateRenewalProviderOrder(true, null)).toBe(true);
    expect(canCreateRenewalProviderOrder(false, {
      stage: "PROVIDER_ORDER",
      provider: "RAZORPAY",
      http_status: 400,
      code: "BAD_REQUEST_ERROR",
    })).toBe(true);
    expect(canCreateRenewalProviderOrder(false, {
      stage: "PROVIDER_ORDER",
      provider: "RAZORPAY",
      http_status: 500,
    })).toBe(false);
    expect(canCreateRenewalProviderOrder(false, { message: "connection reset" })).toBe(false);
  });

  it("keeps the database concurrency guards on order and attempt establishment", () => {
    const migration = readFileSync(resolve(
      process.cwd(),
      "supabase/migrations/20261005113000_recover_renewal_orders_by_cycle.sql"
    ), "utf8");

    expect(migration).toMatch(/where o\.subscription_cycle_id = p_cycle_id\s+for update;/);
    expect(migration).toMatch(/insert into public\.orders[\s\S]*?on conflict do nothing/);
    expect(migration).toMatch(/set order_id = renewal_order\.id,[\s\S]*?pricing_snapshot = p_pricing_snapshot/);
    expect(migration).toMatch(/where pa\.subscription_cycle_id = p_cycle_id\s+for update;/);
    expect(migration).toMatch(/insert into public\.payment_attempts[\s\S]*?on conflict do nothing/);
    expect(migration).toContain("grant execute on function public.establish_renewal_order");
    expect(migration).toContain("to service_role;");
  });
});
