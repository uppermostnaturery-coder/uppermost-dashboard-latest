import { createHmac } from "crypto";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  reserve: vi.fn(),
  processed: vi.fn(),
  failed: vi.fn(),
  reconcile: vi.fn(),
  processToken: vi.fn(),
  replayTokens: vi.fn(),
  maybeSingle: vi.fn(),
}));

vi.mock("@/lib/commerce/webhooks", () => ({
  reservePaymentWebhookEvent: mocks.reserve,
  markPaymentWebhookProcessed: mocks.processed,
  markPaymentWebhookFailed: mocks.failed,
}));

vi.mock("@/lib/commerce/payments/service", () => ({
  reconcilePaymentAttempt: mocks.reconcile,
}));

vi.mock("@/lib/commerce/payments/mandates", async () => {
  const actual = await vi.importActual<typeof import("../../lib/commerce/payments/mandates")>(
    "../../lib/commerce/payments/mandates"
  );
  return {
    ...actual,
    processRazorpayTokenEvent: mocks.processToken,
    reprocessPendingTokenEvents: mocks.replayTokens,
  };
});

vi.mock("@/lib/supabaseAdmin", () => {
  const builder: any = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    maybeSingle: mocks.maybeSingle,
  };
  return { supabaseAdmin: { from: vi.fn(() => builder) } };
});

beforeAll(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
  process.env.RAZORPAY_KEY_ID = "rzp_test_public";
  process.env.RAZORPAY_KEY_SECRET = "test-key-secret";
  process.env.RAZORPAY_WEBHOOK_SECRET = "test-webhook-secret";
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.reserve.mockResolvedValue({ duplicate: false, id: "event-db-id", claimResult: "CLAIMED" });
  mocks.processed.mockResolvedValue(undefined);
  mocks.failed.mockResolvedValue(undefined);
  mocks.reconcile.mockResolvedValue({ state: "CONFIRMED" });
  mocks.processToken.mockResolvedValue({ state: "ACTIVE" });
  mocks.replayTokens.mockResolvedValue(undefined);
  mocks.maybeSingle.mockResolvedValue({ data: {
    id: "attempt-id",
    provider_order_id: "order_1",
    amount_paise: 1000,
    currency: "INR",
  }, error: null });
});

function signedRequest(body: Record<string, unknown>, eventId = "event-provider-id") {
  const raw = JSON.stringify(body);
  const signature = createHmac("sha256", process.env.RAZORPAY_WEBHOOK_SECRET!).update(raw).digest("hex");
  return new Request("https://example.test/api/webhooks/razorpay", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-razorpay-signature": signature,
      "x-razorpay-event-id": eventId,
    },
    body: raw,
  });
}

describe("Razorpay webhook route", () => {
  it("rejects an invalid raw-body HMAC before persistence", async () => {
    const { POST } = await import("../../app/api/webhooks/razorpay/route");
    const response = await POST(new Request("https://example.test/api/webhooks/razorpay", {
      method: "POST",
      headers: { "x-razorpay-signature": "bad" },
      body: JSON.stringify({ event: "payment.captured" }),
    }));
    expect(response.status).toBe(401);
    expect(mocks.reserve).not.toHaveBeenCalled();
  });

  for (const event of ["payment.authorized", "payment.captured", "payment.failed"]) {
    it(`dispatches ${event} explicitly`, async () => {
      const { POST } = await import("../../app/api/webhooks/razorpay/route");
      const response = await POST(signedRequest({
        event,
        payload: { payment: { entity: {
          id: "pay_1", order_id: "order_1", status: event.split(".")[1], amount: 1000, currency: "INR",
        } } },
      }));
      expect(response.status).toBe(200);
      expect(mocks.reconcile).toHaveBeenCalledTimes(1);
      expect(mocks.processed).toHaveBeenCalledWith("event-db-id", "attempt-id");
    });
  }

  for (const event of ["token.confirmed", "token.rejected", "token.cancelled", "token.paused"]) {
    it(`dispatches ${event} explicitly`, async () => {
      const { POST } = await import("../../app/api/webhooks/razorpay/route");
      const status = event.split(".")[1];
      const response = await POST(signedRequest({
        event,
        created_at: 1_790_000_000,
        payload: { token: { entity: {
          id: "token_1",
          recurring_details: { status },
        } } },
      }));
      expect(response.status).toBe(200);
      expect(mocks.processToken).toHaveBeenCalledTimes(1);
    });
  }

  it("acknowledges an unknown signed event as a safe no-op", async () => {
    const { POST } = await import("../../app/api/webhooks/razorpay/route");
    const response = await POST(signedRequest({ event: "order.paid", payload: {} }));
    expect(response.status).toBe(200);
    expect(mocks.reconcile).not.toHaveBeenCalled();
    expect(mocks.processToken).not.toHaveBeenCalled();
    expect(mocks.processed).toHaveBeenCalledTimes(1);
  });

  it("returns idempotent success for a previously processed event", async () => {
    mocks.reserve.mockResolvedValue({ duplicate: true, id: "event-db-id", claimResult: "PROCESSED" });
    const { POST } = await import("../../app/api/webhooks/razorpay/route");
    const response = await POST(signedRequest({ event: "order.paid", payload: {} }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, duplicate: true });
  });

  it("persists a processing failure so a later delivery can reclaim it", async () => {
    mocks.processToken.mockRejectedValueOnce(new Error("TOKEN_CORRELATION_PENDING"));
    const { POST } = await import("../../app/api/webhooks/razorpay/route");
    const response = await POST(signedRequest({
      event: "token.confirmed",
      payload: { token: { entity: { id: "token_late", recurring_details: { status: "confirmed" } } } },
    }));
    expect(response.status).toBe(500);
    expect(mocks.failed).toHaveBeenCalledWith("event-db-id", expect.any(Error));
  });
});

describe("mandate and payment transition policy", () => {
  it("reads recurring_details.status and never promotes an unknown state", async () => {
    const { providerTokenState } = await import("../../lib/commerce/payments/mandates");
    expect(providerTokenState("token.confirmed", { recurring_details: { status: "confirmed" } })).toBe("ACTIVE");
    expect(() => providerTokenState("token.confirmed", { recurring_details: { status: "mystery" } })).toThrow(/unsupported/i);
    expect(() => providerTokenState("token.paused", { recurring_details: { status: "confirmed" } })).toThrow(/disagree/i);
  });

  it("keeps terminal and paused mandate states monotonic", async () => {
    const { nextMandateState } = await import("../../lib/commerce/payments/mandates");
    expect(nextMandateState("CANCELLED", "ACTIVE")).toBe("CANCELLED");
    expect(nextMandateState("PAUSED", "ACTIVE")).toBe("PAUSED");
    expect(nextMandateState("ACTIVE", "REJECTED")).toBe("ACTIVE");
    expect(nextMandateState("PENDING", "ACTIVE")).toBe("ACTIVE");
  });

  it("rejects amount, currency, order, and existing-payment mismatches", async () => {
    const { validateProviderPaymentIdentity } = await import("../../lib/commerce/payments/transitions");
    expect(() => validateProviderPaymentIdentity({
      expectedProviderOrderId: "order_expected",
      existingProviderPaymentId: "pay_expected",
      expectedAmountPaise: 1000,
      expectedCurrency: "INR",
      payment: { id: "pay_other", order_id: "order_other", amount: 999, currency: "USD" },
    })).toThrow(/provider_order_id.*provider_payment_id.*amount_paise.*currency/i);
  });

  it("never lets a stale failure downgrade capture", async () => {
    const { canApplyPaymentStatus } = await import("../../lib/commerce/payments/transitions");
    expect(canApplyPaymentStatus("CAPTURED", "failed")).toBe(false);
    expect(canApplyPaymentStatus("CONFIRMED", "authorized")).toBe(false);
    expect(canApplyPaymentStatus("FAILED", "captured")).toBe(true);
  });

  it("differentiates mandate failure classes", async () => {
    const { normalizeRazorpayFailure } = await import("../../lib/commerce/payments/states");
    expect(normalizeRazorpayFailure({ error_reason: "mandate paused" })).toBe("MANDATE_PAUSED");
    expect(normalizeRazorpayFailure({ error_reason: "mandate rejected" })).toBe("MANDATE_REJECTED");
    expect(normalizeRazorpayFailure({ error_reason: "mandate cancelled" })).toBe("MANDATE_CANCELLED");
    expect(normalizeRazorpayFailure({ error_reason: "mandate expired" })).toBe("MANDATE_EXPIRED");
    expect(normalizeRazorpayFailure({ error_reason: "provider unavailable" })).toBe("FAILED_RETRYABLE");
  });

  it("requires capture and confirmed mandate regardless of arrival order", async () => {
    const { recurringActivationState } = await import("../../lib/commerce/subscriptions/activation");
    expect(recurringActivationState(true, false)).toBe("ACTIVATION_PENDING");
    expect(recurringActivationState(false, true)).toBe("ACTIVATION_PENDING");
    expect(recurringActivationState(true, true)).toBe("CONFIRMED");
  });
});
