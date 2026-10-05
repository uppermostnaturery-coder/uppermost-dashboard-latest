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
  rpc: vi.fn(),
}));

vi.mock("@/lib/commerce/webhooks", () => ({
  reservePaymentWebhookEvent: mocks.reserve,
  markPaymentWebhookProcessed: mocks.processed,
  markPaymentWebhookFailed: mocks.failed,
}));

vi.mock("@/lib/commerce/payments/service", async () => {
  const actual = await vi.importActual<typeof import("../../lib/commerce/payments/service")>(
    "../../lib/commerce/payments/service"
  );
  return { ...actual, reconcilePaymentAttempt: mocks.reconcile };
});

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
  return { supabaseAdmin: { from: vi.fn(() => builder), rpc: mocks.rpc } };
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
  mocks.rpc.mockResolvedValue({ data: [{
    id: "attempt-id",
    provider_order_id: "order_1",
    amount_paise: 1000,
    currency: "INR",
  }], error: null });
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
  it("preserves failed pay_A and captures pay_B on the same provider order", async () => {
    const attempts = new Map<string, { id: string; provider_payment_id: string; status: string }>();
    mocks.rpc.mockImplementation(async (_name, args) => {
      const id = args.p_provider_payment_id;
      const prior = attempts.get(id);
      if (prior) return { data: [prior], error: null };
      const next = { id: `attempt-${id}`, provider_payment_id: id, status: "CREATED" };
      attempts.set(id, next);
      return { data: [next], error: null };
    });
    mocks.reconcile.mockImplementation(async ({ attempt, payment }) => {
      attempt.status = payment.status.toUpperCase();
    });
    const { POST } = await import("../../app/api/webhooks/razorpay/route");
    const entity = (id: string, status: string) => ({
      id, order_id: "order_Tk3Dr8MGXvR9ya", status, amount: 750000,
      currency: "INR", ...(status === "failed" ? { error_reason: "payment_cancelled", error_source: "customer" } : {}),
    });
    for (const [id, status] of [
      ["pay_Tk3E2IiIdjjokP", "failed"],
      ["pay_Tk3EiYNHka2D7P", "authorized"],
      ["pay_Tk3EiYNHka2D7P", "captured"],
    ]) {
      const response = await POST(signedRequest({
        event: `payment.${status}`,
        payload: { payment: { entity: entity(id, status) } },
      }, `event-${id}-${status}`));
      expect(response.status).toBe(200);
    }
    expect(attempts.size).toBe(2);
    expect(attempts.get("pay_Tk3E2IiIdjjokP")?.status).toBe("FAILED");
    expect(attempts.get("pay_Tk3EiYNHka2D7P")?.status).toBe("CAPTURED");
    expect(mocks.rpc).toHaveBeenCalledWith("resolve_razorpay_payment_attempt", expect.objectContaining({
      p_provider_order_id: "order_Tk3Dr8MGXvR9ya",
      p_provider_payment_id: "pay_Tk3EiYNHka2D7P",
    }));
  });

  it("can correlate captured-before-authorized for a new payment ID", async () => {
    const { POST } = await import("../../app/api/webhooks/razorpay/route");
    for (const status of ["captured", "authorized"]) {
      const response = await POST(signedRequest({ event: `payment.${status}`, payload: {
        payment: { entity: { id: "pay_B", order_id: "order_1", status, amount: 1000, currency: "INR" } },
      } }, `event-pay_B-${status}`));
      expect(response.status).toBe(200);
    }
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
    expect(mocks.reconcile).toHaveBeenCalledTimes(2);
  });

  it("fails webhook processing closed when atomic correlation reports a context conflict", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "Payment amount, currency, or local context mismatch" } });
    const { POST } = await import("../../app/api/webhooks/razorpay/route");
    const response = await POST(signedRequest({ event: "payment.captured", payload: {
      payment: { entity: { id: "pay_wrong", order_id: "order_1", status: "captured", amount: 999, currency: "USD" } },
    } }));
    expect(response.status).toBe(500);
    expect(mocks.reconcile).not.toHaveBeenCalled();
    expect(mocks.failed).toHaveBeenCalledTimes(1);
  });

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

  it("passes the real embedded confirmed recurring-token payload into capture reconciliation", async () => {
    const { POST } = await import("../../app/api/webhooks/razorpay/route");
    const response = await POST(signedRequest({
      event: "payment.captured",
      created_at: 1_790_000_000,
      payload: { payment: { entity: {
        id: "pay_Tk3e0A9yrAGRhN",
        order_id: "order_Tk3dtVL4COB84H",
        status: "captured",
        amount: 375000,
        currency: "INR",
        token_id: "token_Tk3e0Jvok384vy",
        token: {
          id: "token_Tk3e0Jvok384vy",
          recurring: true,
          recurring_details: { status: "confirmed" },
        },
      } } },
    }));

    expect(response.status).toBe(200);
    expect(mocks.reconcile).toHaveBeenCalledWith(expect.objectContaining({
      providerEventId: "event-provider-id",
      providerEventCreatedAt: 1_790_000_000,
      payment: expect.objectContaining({
        token: expect.objectContaining({
          id: "token_Tk3e0Jvok384vy",
          recurring: true,
          recurring_details: { status: "confirmed" },
        }),
      }),
    }));
  });

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
    const { embeddedRazorpayTokenEvent, providerTokenState } = await import("../../lib/commerce/payments/mandates");
    expect(providerTokenState("token.confirmed", { recurring_details: { status: "confirmed" } })).toBe("ACTIVE");
    expect(() => providerTokenState("token.confirmed", { recurring_details: { status: "mystery" } })).toThrow(/unsupported/i);
    expect(() => providerTokenState("token.paused", { recurring_details: { status: "confirmed" } })).toThrow(/disagree/i);
    expect(embeddedRazorpayTokenEvent({ id: "token_1", recurring: true, recurring_details: { status: "confirmed" } })).toBe("token.confirmed");
    expect(embeddedRazorpayTokenEvent({ id: "token_1", recurring: true, recurring_details: { status: "rejected" } })).toBe("token.rejected");
    expect(embeddedRazorpayTokenEvent({ id: "token_1", recurring: true, recurring_details: { status: "paused" } })).toBe("token.paused");
    expect(embeddedRazorpayTokenEvent({ id: "token_1", recurring: true, recurring_details: { status: "cancelled" } })).toBe("token.cancelled");
    expect(embeddedRazorpayTokenEvent({ id: "token_1", recurring: true })).toBeNull();
    expect(embeddedRazorpayTokenEvent({ id: "token_1", recurring: false, recurring_details: { status: "confirmed" } })).toBeNull();
    expect(() => embeddedRazorpayTokenEvent({ id: "token_1", recurring: true, recurring_details: { status: "unknown" } })).toThrow(/unsupported/i);
  });

  it("requires matching top-level and embedded token IDs", async () => {
    const { embeddedRecurringTokenEvidence } = await import("../../lib/commerce/payments/service");
    expect(() => embeddedRecurringTokenEvidence({
      id: "pay_1", order_id: "order_1", status: "captured", amount: 1000, currency: "INR",
      token_id: "token_expected",
      token: { id: "token_other", recurring: true, recurring_details: { status: "confirmed" } },
    })).toThrow(/TOKEN_ID_CONFLICT/);
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
