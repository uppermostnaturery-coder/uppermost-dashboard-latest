import { beforeAll, describe, expect, it } from "vitest";

beforeAll(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
  process.env.SHIPROCKET_PICKUP_POSTCODE = "110001";
  process.env.SHIPROCKET_WEBHOOK_SECRET = "test-shiprocket-webhook-secret";
  process.env.SHIPROCKET_PICKUP_LOCATION = "Primary";
});

describe("payment finalization integrity", () => {
  it("does not let a late non-final provider event downgrade a confirmed payment", async () => {
    const { shouldIgnoreNonFinalPaymentUpdate } = await import(
      "../../lib/commerce/payments/service"
    );

    expect(shouldIgnoreNonFinalPaymentUpdate("CONFIRMED", "failed")).toBe(true);
    expect(shouldIgnoreNonFinalPaymentUpdate("CONFIRMED", "authorized")).toBe(true);
    expect(shouldIgnoreNonFinalPaymentUpdate("CONFIRMED", "captured")).toBe(false);
    expect(shouldIgnoreNonFinalPaymentUpdate("FAILED_RETRYABLE", "captured")).toBe(false);
  });

  it("constrains transactional inventory by active release remaining", async () => {
    const { constrainInventoryQuantity } = await import("../../lib/commerce/catalog");

    expect(constrainInventoryQuantity(null, 39)).toBe(39);
    expect(constrainInventoryQuantity(12, 39)).toBe(12);
    expect(constrainInventoryQuantity(50, 39)).toBe(39);
    expect(constrainInventoryQuantity(null, 0)).toBe(0);
  });

  it("copies serviceability dates into the shipment snapshot", async () => {
    const { shipmentDatesFromPricingSnapshot } = await import(
      "../../lib/commerce/fulfillment"
    );

    expect(
      shipmentDatesFromPricingSnapshot({
        shipping: {
          estimated_delivery_from: "2026-09-28T12:00:00.000Z",
          estimated_delivery_to: "2026-09-30T12:00:00.000Z",
        },
      })
    ).toEqual({ expectedFrom: "2026-09-28", expectedTo: "2026-09-30" });
  });

  it("sends Shiprocket the net paid order total", async () => {
    const { buildShiprocketOrderPayload } = await import(
      "../../lib/commerce/shiprocket/client"
    );

    const payload = buildShiprocketOrderPayload({
      orderNumber: "UPM-TEST",
      placedAt: "2026-09-25T00:00:00.000Z",
      customer: { name: "Test Customer", email: "test@example.com", phone: "+919999999999" },
      address: {
        line1: "Test address",
        line2: "",
        city: "Delhi",
        postal_code: "110001",
        state: "Delhi",
      },
      items: [{ sku: "GIR-1000", name: "Gir 1 L", units: 1, selling_price: 7_500 }],
      orderTotalRupees: 7_000,
      dimensions: { weightKg: 1, lengthCm: 10, breadthCm: 10, heightCm: 10 },
    });

    expect(payload.sub_total).toBe(7_000);
  });
});
