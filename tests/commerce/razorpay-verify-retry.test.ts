import { createHmac } from "node:crypto";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  begin: vi.fn(), complete: vi.fn(), fetch: vi.fn(), resolve: vi.fn(),
  reconcile: vi.fn(), status: vi.fn(),
}));

vi.mock("@/lib/commerce/idempotency", () => ({
  beginIdempotentRequest: mocks.begin,
  completeIdempotentRequest: mocks.complete,
}));
vi.mock("@/lib/commerce/razorpay/client", () => ({ fetchRazorpayPayment: mocks.fetch }));
vi.mock("@/lib/commerce/payments/correlation", () => ({ resolveRazorpayPaymentAttempt: mocks.resolve }));
vi.mock("@/lib/commerce/payments/service", () => ({ reconcilePaymentAttempt: mocks.reconcile }));
vi.mock("@/lib/commerce/status", () => ({ getCheckoutStatus: mocks.status }));

beforeAll(() => {
  process.env.RAZORPAY_KEY_ID = "rzp_test_public";
  process.env.RAZORPAY_KEY_SECRET = "test-key-secret";
  process.env.RAZORPAY_WEBHOOK_SECRET = "test-webhook-secret";
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.begin.mockResolvedValue({ kind: "START", recordId: "idempotency-1" });
  mocks.complete.mockResolvedValue(undefined);
  mocks.reconcile.mockResolvedValue({ state: "CONFIRMED" });
  mocks.status.mockResolvedValue({ ok: true, state: "CONFIRMED" });
});

describe("browser payment verification after a Razorpay retry", () => {
  it("uses the same payment-first resolver and exact checkout context as the webhook", async () => {
    const checkout = "fa66bf95-7533-4fe8-9206-46b45f5b7778";
    const providerOrder = "order_Tk3Dr8MGXvR9ya";
    const providerPayment = "pay_Tk3EiYNHka2D7P";
    const signature = createHmac("sha256", "test-key-secret")
      .update(`${providerOrder}|${providerPayment}`).digest("hex");
    const payment = { id: providerPayment, order_id: providerOrder, status: "captured", amount: 750000, currency: "INR" };
    const attempt = { id: "attempt-B", provider_payment_id: providerPayment, order_id: "512264c5-7a1d-43ec-8a19-41c7bdfa867c" };
    mocks.fetch.mockResolvedValue(payment);
    mocks.resolve.mockResolvedValue(attempt);
    const { POST } = await import("../../app/api/payments/verify/route");
    const response = await POST(new Request("https://example.test/api/payments/verify", {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": "verify-retry-B" },
      body: JSON.stringify({
        checkout_session_id: checkout,
        razorpay_order_id: providerOrder,
        razorpay_payment_id: providerPayment,
        razorpay_signature: signature,
      }),
    }));
    expect(response.status).toBe(200);
    expect(mocks.resolve).toHaveBeenCalledWith({ payment, checkoutSessionId: checkout });
    expect(mocks.reconcile).toHaveBeenCalledWith({ attempt, payment });
    expect(mocks.complete).toHaveBeenCalledTimes(1);
  });
});
