import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CheckoutPrepareSuccessResponse } from "../../docs/FRAMER_COMMERCE_TYPES";
import { tokenHash } from "../../lib/commerce/crypto";

const mocks = vi.hoisted(() => ({
  from: vi.fn(), loadQuote: vi.fn(), buildQuote: vi.fn(), begin: vi.fn(), complete: vi.fn(),
}));
vi.mock("@/lib/supabaseAdmin", () => ({ supabaseAdmin: { from: mocks.from } }));
vi.mock("@/lib/commerce/quotes", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../lib/commerce/quotes")>(),
  loadQuote: mocks.loadQuote,
}));
vi.mock("@/lib/commerce/idempotency", () => ({ beginIdempotentRequest: mocks.begin, completeIdempotentRequest: mocks.complete }));
vi.mock("@/lib/commerce/quoteBuilder", () => ({ buildAuthoritativeQuote: mocks.buildQuote }));
vi.mock("@/lib/commerce/customers", () => ({
  findCustomerIdentity: async () => ({ customerId: "customer-1", hasOrders: false }),
  resolveOrCreateCustomer: async () => ({ id: "customer-1", razorpay_customer_id: "cust_test" }),
  saveCustomerAddress: async () => "address-1",
}));
vi.mock("@/lib/commerce/razorpay/client", () => ({
  createRazorpayCustomer: async () => ({ id: "cust_test" }),
  createRazorpayOrder: async () => ({ id: "order_test" }),
}));

type Row = Record<string, any>;
let rows: Record<string, Row[]>;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.begin.mockResolvedValue({ kind: "START", recordId: "idempotency-1" });
  mocks.complete.mockResolvedValue(undefined);
  process.env.COMMERCE_TOKEN_PEPPER = "test-pepper";
  process.env.RAZORPAY_KEY_ID = "rzp_test_public";
  process.env.RAZORPAY_KEY_SECRET = "test-secret";
  process.env.RAZORPAY_WEBHOOK_SECRET = "test-webhook-secret";
  rows = {};
  // Database boundary only: prepare, token generation/hashing, quote validation,
  // status serialization and message resolution all execute their real code.
  mocks.from.mockImplementation((table: string) => {
    let values: Row | Row[] | undefined;
    let operation = "select";
    const filters: Array<[string, unknown]> = [];
    const query: any = {
      insert(value: Row | Row[]) { operation = "insert"; values = value; return query; },
      update(value: Row) { operation = "update"; values = value; return query; },
      select() { return query; },
      eq(key: string, value: unknown) { filters.push([key, value]); return query; },
      order() { return query; }, limit() { return query; },
      single() { return Promise.resolve(execute(true)); },
      maybeSingle() { return Promise.resolve(execute(true)); },
      then(resolve: any, reject: any) { return Promise.resolve(execute(false)).then(resolve, reject); },
    };
    const execute = (single: boolean) => {
      const existing = rows[table] ??= [];
      let selected: Row[];
      if (operation === "insert") {
        selected = (Array.isArray(values) ? values : [values!]).map((value) => ({
          id: `${table}-${existing.length + 1}`, order_number: "UPM-TEST-1", ...value,
        }));
        existing.push(...selected);
      } else {
        selected = existing.filter((row) => filters.every(([key, value]) => row[key] === value));
        if (operation === "update") selected.forEach((row) => Object.assign(row, values));
      }
      return { data: single ? selected[0] ?? null : selected, error: null };
    };
    return query;
  });
});

describe("checkout experience navigation", () => {
  it.each(["BUY_ONCE", "SUBSCRIPTION", "MIXED"])(
    "returns the persisted experience URL during prepare for %s, without confirming payment",
    async (shape) => {
      const items = [{
        line_id: "gir", sku: "GIR-1000", qty: 1,
        purchase_mode: shape === "BUY_ONCE" ? "BUY_ONCE" : "SUBSCRIPTION",
        ...(shape === "BUY_ONCE" ? {} : { interval_days: 30 }),
        product_id: "product-gir", product_variant_id: "variant-gir",
        product_name: "Gir", variant_name: "1 L", unit_price_paise: 750000,
        line_subtotal_paise: 750000, line_total_paise: 750000,
      }];
      if (shape === "MIXED") items.push({ ...items[0], line_id: "murrah", sku: "MURRAH-1000", purchase_mode: "BUY_ONCE", interval_days: undefined });
      const initial = { items, adjustments: [], benefits: [], subtotal_paise: 750000 * items.length,
        discount_paise: 0, shipping_paise: 0, tax_paise: 0, total_paise: 750000 * items.length };
      const snapshot = {
        initial, shipping: { serviceable: true, shipping_amount_paise: 0 },
        recurring_groups: shape === "BUY_ONCE" ? [] : [{ interval_days: 30,
          quote: { ...initial, items: [items[0]], total_paise: 750000 }, mandate_max_amount_paise: 1750000 }],
      };
      mocks.loadQuote.mockResolvedValue({
        id: "quote-1", token_hash: tokenHash("qt_" + "a".repeat(43), "test-pepper"), guest_session_id: "guest-test",
        items, price_snapshot: snapshot, status: "OPEN", valid_until: new Date(Date.now() + 60000).toISOString(),
      });
      mocks.buildQuote.mockResolvedValue({ snapshot, promotionVersion: "test" });
      const input = {
        guest_session_id: "guest-test", quote_id: "quo_test_quote", quote_token: "qt_" + "a".repeat(43),
        customer: { name: "Test Customer", email: "test@example.com", phone: "+919999999999" },
        shipping_address: { line1: "123 Test Road", city: "Delhi", state: "Delhi", postal_code: "110001", country: "IN" }, billing_same_as_shipping: true,
        ...(shape === "BUY_ONCE" ? {} : { recurring_consent: { accepted: true as const, version: "v1-test" } }),
      };
      const { POST } = await import("../../app/api/checkout/prepare/route");
      const request = () => new Request("https://example.test/api/checkout/prepare", {
        method: "POST", headers: { "content-type": "application/json", "idempotency-key": "prepare-test-key" },
        body: JSON.stringify(input),
      });
      const response = await POST(request());
      expect(response.status).toBe(201);
      const body = await response.json();
      expect(body.next).toEqual({ type: "EXPERIENCE", url: expect.stringMatching(/^\/experience\?t=exp_[A-Za-z0-9_-]{43}$/) });
      const token = new URL(body.next.url, "https://uppermost.store").searchParams.get("t")!;
      expect(rows.checkout_sessions[0].experience_token).toBe(token);
      expect(rows.orders[0].experience_token_hash).toBe(tokenHash(token, "test-pepper"));
      expect(body.state).toBe("CHECKOUT_READY");
      expect(rows.orders[0].status).toBe("PAYMENT_PENDING");
      const { getCheckoutStatus } = await import("../../lib/commerce/status");
      expect(await getCheckoutStatus(body.checkout_session_id)).not.toHaveProperty("next");
      // An unchanged legacy idempotency response remains a valid public response.
      const { next: _next, ...legacy } = body as CheckoutPrepareSuccessResponse;
      const legacyResponse: CheckoutPrepareSuccessResponse = legacy;
      const rowCount = Object.values(rows).reduce((count, table) => count + table.length, 0);
      for (const replay of [body, legacyResponse]) {
        mocks.begin.mockResolvedValue({ kind: "REPLAY", status: 201, body: replay });
        const replayed = await POST(request());
        expect(replayed.status).toBe(201);
        expect(await replayed.json()).toEqual(replay);
        expect(Object.values(rows).reduce((count, table) => count + table.length, 0)).toBe(rowCount);
      }
      for (const state of ["CONFIRMED", "ACTIVATION_PENDING"]) {
        rows.checkout_sessions[0].state = state;
        expect((await getCheckoutStatus(body.checkout_session_id)).next).toEqual(body.next);
      }
    },
  );
});
