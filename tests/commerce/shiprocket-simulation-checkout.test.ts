import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CartLineInput, CatalogVariant } from "../../lib/commerce/types";
import type { StoredQuote } from "../../lib/commerce/quotes";

type FixtureRow = Record<string, unknown>;
type QueryResult = { data: FixtureRow | FixtureRow[] | null; error: null };
interface FixtureQuery extends PromiseLike<QueryResult> {
  insert(values: FixtureRow | FixtureRow[]): FixtureQuery;
  update(values: FixtureRow): FixtureQuery;
  select(): FixtureQuery;
  eq(): FixtureQuery;
  neq(field: string, value: unknown): FixtureQuery;
  single(): Promise<QueryResult>;
  maybeSingle(): Promise<QueryResult>;
}

const seams = vi.hoisted(() => ({
  catalog: vi.fn(), loadQuote: vi.fn(), persistQuote: vi.fn(), providerOrder: vi.fn(),
  writes: [] as Array<{ table: string; values: FixtureRow }>,
  rpc: vi.fn(), query: null as null | ((table: string) => FixtureQuery),
}));
vi.mock("@/lib/supabaseAdmin", () => ({ supabaseAdmin: { rpc: seams.rpc, from(table: string) {
  if (seams.query) return seams.query(table);
  const query: FixtureQuery = {
    insert(values) { seams.writes.push({ table, values: Array.isArray(values) ? { rows: values } : values }); return query; },
    update(values) { seams.writes.push({ table, values }); return query; },
    select() { return query; }, eq() { return query; }, neq() { return query; },
    single: async () => ({ data: table === "orders" ? { id: "order-local", order_number: "UM-SIM-1" } : { id: "checkout-local" }, error: null }),
    maybeSingle: async () => ({ data: null, error: null }),
    then(onfulfilled, onrejected) { return Promise.resolve<QueryResult>({ data: table === "order_items" ? [{ id: "item-local", line_id: "gir" }] : null, error: null }).then(onfulfilled, onrejected); },
  };
  return query;
} } }));
vi.mock("@/lib/commerce/catalog", async () => ({
  ...await vi.importActual<typeof import("../../lib/commerce/catalog")>("../../lib/commerce/catalog"),
  loadCatalogVariants: seams.catalog,
}));
vi.mock("@/lib/commerce/promotions", () => ({
  loadActivePromotions: async () => [], loadPromotionEntitlements: async () => [], promotionVersion: () => "fixture-v1",
}));
vi.mock("@/lib/commerce/quotes", async () => ({
  ...await vi.importActual<typeof import("../../lib/commerce/quotes")>("../../lib/commerce/quotes"),
  loadQuote: seams.loadQuote, persistQuote: seams.persistQuote,
}));
vi.mock("@/lib/commerce/customers", () => ({
  findCustomerIdentity: async () => ({ customerId: undefined, hasOrders: false }),
  resolveOrCreateCustomer: async () => ({ id: "customer-local", razorpay_customer_id: null }),
  saveCustomerAddress: async () => "address-local",
}));
vi.mock("@/lib/analytics/identity", () => ({ bestEffortIdentityLink: async () => undefined }));
vi.mock("@/lib/commerce/messages", () => ({ createCustomerMessage: async () => undefined }));
vi.mock("@/lib/commerce/razorpay/client", () => ({ createRazorpayOrder: seams.providerOrder, createRazorpayCustomer: vi.fn() }));

import { buildAuthoritativeQuote } from "../../lib/commerce/quoteBuilder";
import { prepareCheckout } from "../../lib/commerce/checkout";
import { tokenHash } from "../../lib/commerce/crypto";
import { POST } from "../../app/api/shipping/serviceability/route";
import { reconcilePaymentAttempt } from "../../lib/commerce/payments/service";

const variant: CatalogVariant = {
  id: "gir-v", product_id: "gir-p", product_code: "GIR_GHEE", product_name: "Gir Cow Ghee", product_family: "GIR",
  sku: "GIR-1000", variant_name: "1 L", size_label: "1 L", price_paise: 750000, currency: "INR",
  weight_grams: 1200, length_cm: 14, breadth_cm: 14, height_cm: 18,
  inventory_policy: "SUPABASE", inventory_quantity: 20, is_active: true,
};
const items: CartLineInput[] = [{ line_id: "gir", sku: "GIR-1000", qty: 1, purchase_mode: "BUY_ONCE" }];
const input = {
  guest_session_id: "guest-local-test", quote_id: "quote-public-local", quote_token: "q-test-token-for-local-simulation-only",
  customer: { name: "Local Test", email: "local@example.invalid", phone: "+919999999999" },
  shipping_address: { line1: "Local fixture", city: "Mumbai", state: "Maharashtra", postal_code: "400001", country: "IN" as const },
  billing_same_as_shipping: true,
};

async function storedQuote(lines = items): Promise<StoredQuote> {
  const built = await buildAuthoritativeQuote({ items: lines, postalCode: "400001" });
  return {
    id: "quote-local", public_id: input.quote_id, token_hash: tokenHash(input.quote_token, "local-test-pepper"),
    guest_session_id: input.guest_session_id, customer_id: null, cart_fingerprint: "fixture", items: lines,
    shipping_context: { postal_code: "400001" }, price_snapshot: built.snapshot, pricing_version: "commerce-v1",
    promotion_version: "fixture-v1", status: "OPEN", valid_until: new Date(Date.now() + 600000).toISOString(), consumed_by_idempotency_key: null,
  };
}

beforeEach(() => {
  vi.stubEnv("SHIPROCKET_STAGING_SIMULATION_ENABLED", "true");
  vi.stubEnv("VERCEL_ENV", "preview");
  vi.stubEnv("VERCEL_GIT_COMMIT_REF", "staging");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://jwsivyxapfnyaafdcdos.supabase.co");
  vi.stubEnv("COMMUNICATION_BASE_URL", "https://staging.uppermost.store");
  vi.stubEnv("SHIPROCKET_API_ENABLED", "false");
  vi.stubEnv("COMMUNICATION_DRY_RUN", "true");
  vi.stubEnv("RAZORPAY_KEY_ID", "rzp_test_local");
  vi.stubEnv("RAZORPAY_KEY_SECRET", "local-fixture-secret");
  vi.stubEnv("RAZORPAY_WEBHOOK_SECRET", "local-fixture-webhook");
  vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "a".repeat(40));
  vi.stubEnv("SHIPROCKET_STAGING_TEST_PINCODES", "400001,110001");
  vi.stubEnv("COMMERCE_TOKEN_PEPPER", "local-test-pepper");
  vi.stubEnv("COMMERCE_ALLOWED_ORIGINS", "https://staging.uppermost.store");
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Unexpected network access in local contract test"); }));
  seams.writes.length = 0;
  seams.query = null;
  seams.rpc.mockReset().mockResolvedValue({ data: { shipment_id: "simulated-shipment", simulated: true }, error: null });
  seams.catalog.mockResolvedValue([{ ...variant }]);
  seams.providerOrder.mockReset().mockResolvedValue({ id: "order_provider_fixture" });
  seams.loadQuote.mockReset();
  seams.persistQuote.mockReset().mockResolvedValue({ quoteId: "replacement-local", quoteToken: "replacement-token", validUntil: "2027-01-01T00:00:00Z" });
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("local staging shipping simulation checkout contract", () => {
  it("builds an authoritative zero-shipping quote with explicit simulation provenance and no provider request", async () => {
    const built = await buildAuthoritativeQuote({ items, postalCode: "400001" });
    expect(built.snapshot.initial.total_paise).toBe(750000);
    expect(built.snapshot.initial.shipping_paise).toBe(0);
    expect(built.snapshot.shipping).toMatchObject({ serviceable: true, simulated: true, simulation_project_ref: "jwsivyxapfnyaafdcdos", simulation_postal_code: "400001", shipping_amount_paise: 0 });
    expect(String(built.snapshot.shipping.message)).toMatch(/SIMULATED/i);
    expect(built.snapshot.shipping).not.toHaveProperty("best_courier_internal_reference");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("returns the safe public serviceability contract without exposing internal provenance or fake courier identity", async () => {
    const response = await POST(new Request("https://staging.uppermost.store/api/shipping/serviceability", {
      method: "POST", headers: { "Content-Type": "application/json", Origin: "https://staging.uppermost.store" },
      body: JSON.stringify({ items, postal_code: "400001", shipping_amount_paise: 1, weight_grams: 1 }),
    }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ ok: true, serviceable: true, shipping_amount_paise: 0 });
    expect(body.message).toMatch(/SIMULATED/i);
    for (const field of ["simulation_project_ref", "simulation_postal_code", "best_courier_internal_reference", "awb", "courier_name"]) expect(body).not.toHaveProperty(field);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("prepares a real one-time checkout with the authoritative paise amount and test key", async () => {
    seams.loadQuote.mockResolvedValue(await storedQuote());
    const result = await prepareCheckout(input, "local-idempotency-key");
    expect(result.razorpay).toMatchObject({ key_id: "rzp_test_local", amount_paise: 750000, currency: "INR", recurring: false });
    expect(seams.providerOrder).toHaveBeenCalledWith(expect.objectContaining({ amount: 750000, currency: "INR", receipt: "UM-SIM-1" }));
    expect(seams.writes.find(write => write.table === "orders" && write.values.status)?.values).toMatchObject({ status: "PAYMENT_PENDING", total_paise: 750000, shipping_paise: 0 });
    expect(seams.writes.some(write => write.table === "shipments")).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("retains subscription consent enforcement before provider order creation", async () => {
    seams.loadQuote.mockResolvedValue(await storedQuote([{ ...items[0], purchase_mode: "SUBSCRIPTION", interval_days: 30 }]));
    await expect(prepareCheckout(input, "local-consent-key")).rejects.toMatchObject({ code: "RECURRING_CONSENT_REQUIRED" });
    expect(seams.providerOrder).not.toHaveBeenCalled();
    expect(seams.writes).toEqual([]);
  });

  it("keeps one-time lines out of renewal pricing while simulated shipping serves the whole initial cart", async () => {
    const built = await buildAuthoritativeQuote({ items: [
      { ...items[0], purchase_mode: "SUBSCRIPTION", interval_days: 30 },
      { ...items[0], line_id: "gir-extra", qty: 2 },
    ], postalCode: "400001" });
    expect(built.snapshot.initial.total_paise).toBe(2250000);
    expect(built.snapshot.recurring_groups).toHaveLength(1);
    expect(built.snapshot.recurring_groups[0].quote.total_paise).toBe(750000);
    expect(built.snapshot.recurring_groups[0].quote.items.map(item => item.line_id)).toEqual(["gir"]);
    expect(built.snapshot.recurring_groups[0].mandate_max_amount_paise).toBe(2250000);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("blocks checkout for a pincode outside the explicit simulation allowlist", async () => {
    seams.loadQuote.mockResolvedValue(await storedQuote());
    await expect(prepareCheckout({ ...input, shipping_address: { ...input.shipping_address, postal_code: "560001" } }, "local-disallowed-pin"))
      .rejects.toMatchObject({ code: "UNSERVICEABLE_PINCODE" });
    expect(seams.providerOrder).not.toHaveBeenCalled();
    expect(seams.writes).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("retains authoritative inventory enforcement when simulated shipping is enabled", async () => {
    seams.loadQuote.mockResolvedValue(await storedQuote());
    seams.catalog.mockResolvedValue([{ ...variant, inventory_quantity: 0 }]);
    await expect(prepareCheckout(input, "local-stock-key")).rejects.toMatchObject({ code: "INSUFFICIENT_INVENTORY" });
    expect(seams.providerOrder).not.toHaveBeenCalled();
    expect(seams.writes).toEqual([]);
  });

  it("refuses a repriced quote rather than silently charging a changed amount", async () => {
    seams.loadQuote.mockResolvedValue(await storedQuote());
    seams.catalog.mockResolvedValue([{ ...variant, price_paise: 800000 }]);
    await expect(prepareCheckout(input, "local-price-key")).rejects.toMatchObject({ code: "QUOTE_CHANGED" });
    expect(seams.providerOrder).not.toHaveBeenCalled();
    expect(seams.writes).toEqual([]);
  });

  it("retains quote-token authentication with simulation enabled", async () => {
    seams.loadQuote.mockResolvedValue(await storedQuote());
    await expect(prepareCheckout({ ...input, quote_token: "forged-token" }, "local-forged-key")).rejects.toMatchObject({ code: "INVALID_QUOTE" });
    expect(seams.providerOrder).not.toHaveBeenCalled();
    expect(seams.writes).toEqual([]);
  });

  function localLiveServiceabilityFixture() {
    vi.stubEnv("SHIPROCKET_STAGING_SIMULATION_ENABLED", "false");
    vi.stubEnv("SHIPROCKET_API_ENABLED", "true");
    vi.stubEnv("SHIPROCKET_TOKEN", "local-fixture-token");
    vi.stubEnv("SHIPROCKET_PICKUP_POSTCODE", "110001");
    vi.stubEnv("SHIPROCKET_WEBHOOK_SECRET", "local-fixture-secret");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      data: { available_courier_companies: [{ estimated_delivery_days: 4, freight_charge: 0 }] },
    }), { status: 200, headers: { "Content-Type": "application/json" } })));
  }

  it("requires quote review when a stored simulated quote would become live at the same price", async () => {
    seams.loadQuote.mockResolvedValue(await storedQuote());
    localLiveServiceabilityFixture();
    await expect(prepareCheckout(input, "simulation-to-live-key")).rejects.toMatchObject({ code: "QUOTE_CHANGED" });
    expect(seams.providerOrder).not.toHaveBeenCalled();
    expect(seams.writes).toEqual([]);
  });

  it("requires quote review when a stored live quote would become simulated at the same price", async () => {
    localLiveServiceabilityFixture();
    seams.loadQuote.mockResolvedValue(await storedQuote());
    vi.stubEnv("SHIPROCKET_STAGING_SIMULATION_ENABLED", "true");
    vi.stubEnv("SHIPROCKET_API_ENABLED", "false");
    vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Unexpected provider access after selecting simulation"); }));
    await expect(prepareCheckout(input, "live-to-simulation-key")).rejects.toMatchObject({ code: "QUOTE_CHANGED" });
    expect(seams.providerOrder).not.toHaveBeenCalled();
    expect(seams.writes).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("requires quote review when the simulated delivery pincode changes between configured pincodes", async () => {
    seams.loadQuote.mockResolvedValue(await storedQuote());
    await expect(prepareCheckout({ ...input, shipping_address: { ...input.shipping_address, postal_code: "110001" } }, "simulation-pincode-change-key"))
      .rejects.toMatchObject({ code: "QUOTE_CHANGED" });
    expect(seams.providerOrder).not.toHaveBeenCalled();
    expect(seams.writes).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });
});

// This exercises the real prepare -> reconciliation -> fulfilment chain against local
// database/provider doubles. It does not verify a provider signature or execute SQL.
describe("local prepared one-time payment to simulated fulfilment", () => {
  async function preparedPayment() {
    seams.loadQuote.mockResolvedValue(await storedQuote());
    await prepareCheckout(input, "local-paid-flow-key");
    const order: FixtureRow = {
      id: "order-local", customer_id: "customer-local", subscription_id: null,
      ...seams.writes.find(write => write.table === "orders" && write.values.status)!.values,
    };
    const attempt: FixtureRow = {
      id: "attempt-local", currency: "INR", provider_payment_id: null,
      ...seams.writes.find(write => write.table === "payment_attempts")!.values,
    };
    const checkout = { id: "checkout-local", state: "CHECKOUT_READY" };
    const rows: Record<string, FixtureRow> = { orders: order, payment_attempts: attempt, checkout_sessions: checkout };
    seams.query = (table: string) => {
      if (!rows[table]) throw new Error(`Unexpected database table in paid-flow fixture: ${table}`);
      let update: FixtureRow | null = null;
      const excluded: Array<[string, unknown]> = [];
      const result = (): QueryResult => {
        const row = rows[table];
        if (excluded.some(([field, value]) => row[field] === value)) return { data: null, error: null };
        if (update) Object.assign(row, update);
        return { data: { ...row }, error: null };
      };
      const query: FixtureQuery = {
        select() { return query; }, eq() { return query; },
        neq(field: string, value: unknown) { excluded.push([field, value]); return query; },
        update(values) { update = values; return query; },
        insert() { throw new Error("Unexpected insertion after payment preparation"); },
        single: async () => result(), maybeSingle: async () => result(),
        then(onfulfilled, onrejected) { return Promise.resolve(result()).then(onfulfilled, onrejected); },
      };
      return query;
    };
    return { order, attempt, checkout, payment: { id: "pay_local", order_id: "order_provider_fixture", amount: 750000, currency: "INR", status: "captured", method: "upi" } };
  }

  it("confirms the exact prepared amount then reaches the real service-only simulation hook", async () => {
    const { order, attempt, checkout, payment } = await preparedPayment();
    expect(seams.rpc).not.toHaveBeenCalled();
    const result = await reconcilePaymentAttempt({ attempt, payment });
    expect(result.state).toBe("CONFIRMED");
    expect(attempt.status).toBe("CAPTURED");
    expect(order.status).toBe("CONFIRMED");
    expect(checkout.state).toBe("CONFIRMED");
    expect(seams.rpc).toHaveBeenCalledExactlyOnceWith("comm_create_simulated_shipment", {
      p_order_id: "order-local", p_context: expect.objectContaining({ project_ref: "jwsivyxapfnyaafdcdos", environment: "preview", dry_run: true, razorpay_test_key: true }),
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(["created", "authorized", "failed"])("does not create any shipment for a %s payment", async status => {
    const { order, attempt, payment } = await preparedPayment();
    await reconcilePaymentAttempt({ attempt, payment: { ...payment, status } });
    expect(order.status).toBe("PAYMENT_PENDING");
    expect(seams.rpc).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    { amount: 749999 }, { currency: "USD" }, { order_id: "order_unrelated" },
  ])("rejects mismatched verified payment identity before simulation fulfilment: %j", async mismatch => {
    const { order, attempt, payment } = await preparedPayment();
    await expect(reconcilePaymentAttempt({ attempt, payment: { ...payment, ...mismatch } })).rejects.toThrow();
    expect(order.status).toBe("PAYMENT_PENDING");
    expect(seams.rpc).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
});
