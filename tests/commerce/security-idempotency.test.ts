import { beforeAll, describe, expect, it } from "vitest";
import type { StoredQuote } from "../../lib/commerce/quotes";

beforeAll(() => {
  process.env.COMMERCE_TOKEN_PEPPER = "test-pepper-with-sufficient-entropy";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
});

describe("quote and idempotency guards", () => {
  it("rejects forged quote ids, wrong tokens, expired and consumed quotes", async () => {
    const { tokenHash } = await import("../../lib/commerce/crypto");
    const { validateQuoteRecord } = await import("../../lib/commerce/quotes");
    const base = {
      id: "internal", public_id: "quo_valid",
      token_hash: tokenHash("qt_valid", process.env.COMMERCE_TOKEN_PEPPER!),
      guest_session_id: "guest-12345678", customer_id: null, cart_fingerprint: "fingerprint",
      items: [], shipping_context: {}, price_snapshot: {} as StoredQuote["price_snapshot"],
      pricing_version: "commerce-v1", promotion_version: "v1", status: "OPEN" as const,
      valid_until: "2099-01-01T00:00:00.000Z", consumed_by_idempotency_key: null,
    } satisfies StoredQuote;
    expect(validateQuoteRecord({ quote: null, token: "qt_valid", guestSessionId: base.guest_session_id! })).toBe("INVALID_QUOTE");
    expect(validateQuoteRecord({ quote: base, token: "qt_wrong", guestSessionId: base.guest_session_id! })).toBe("INVALID_QUOTE");
    expect(validateQuoteRecord({ quote: { ...base, valid_until: "2020-01-01T00:00:00.000Z" }, token: "qt_valid", guestSessionId: base.guest_session_id! })).toBe("QUOTE_EXPIRED");
    expect(validateQuoteRecord({ quote: { ...base, status: "CONSUMED" }, token: "qt_valid", guestSessionId: base.guest_session_id! })).toBe("QUOTE_CONSUMED");
  });

  it("replays duplicate prepare and rejects idempotency-key conflicts", async () => {
    const { resolveExistingIdempotency } = await import("../../lib/commerce/idempotency");
    const completed = { id: "idem", request_hash: "same", status: "COMPLETED" as const, response_status: 201, response_body: { ok: true, checkout_session_id: "checkout" } };
    expect(resolveExistingIdempotency(completed, "same")).toEqual({ kind: "REPLAY", status: 201, body: completed.response_body });
    expect(() => resolveExistingIdempotency(completed, "different")).toThrowError(/different request/i);
  });

  it("recognizes duplicate webhook and renewal executions", async () => {
    const { webhookReservationDecision } = await import("../../lib/commerce/webhooks");
    const { canStartRenewalCycle } = await import("../../lib/commerce/payments/states");
    expect(webhookReservationDecision("23505")).toBe("DUPLICATE");
    expect(canStartRenewalCycle("DUE")).toBe(true);
    expect(canStartRenewalCycle("PROCESSING")).toBe(false);
    expect(canStartRenewalCycle("PAYMENT_PENDING")).toBe(false);
  });

  it("detects an amount above mandate cap", async () => {
    const { isAboveMandateCap } = await import("../../lib/commerce/renewals");
    expect(isAboveMandateCap(1_000_001, 1_000_000)).toBe(true);
    expect(isAboveMandateCap(1_000_000, 1_000_000)).toBe(false);
  });
});
