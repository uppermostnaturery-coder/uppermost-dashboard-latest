import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("@/lib/supabaseAdmin", () => ({
  supabaseAdmin: { rpc: mocks.rpc },
}));

beforeEach(() => mocks.rpc.mockReset());

describe("Razorpay payment-attempt correlation", () => {
  const migration = readFileSync(resolve(process.cwd(), "supabase/migrations/20261005120000_allow_razorpay_payment_retries.sql"), "utf8");

  it("replaces both invalid one-attempt uniqueness rules while retaining immutable payment IDs", () => {
    expect(migration).toContain("drop constraint if exists payment_attempts_provider_order_id_key");
    expect(migration).toContain("drop index if exists public.payment_attempts_subscription_cycle_unique_idx");
    expect(migration).toContain("create unique index if not exists payment_attempts_one_success_per_order_idx");
    expect(migration).toContain("create unique index if not exists payment_attempts_unbound_provider_order_idx");
    expect(migration).not.toContain("drop constraint if exists payment_attempts_provider_payment_id_key");
  });

  it("locks correlation and rejects a second success, active predecessor, and mismatched context", () => {
    expect(migration).toContain("pg_catalog.pg_advisory_xact_lock");
    expect(migration).toContain("Business order already has a successful payment");
    expect(migration).toContain("Previous payment attempt is not terminal unsuccessful");
    expect(migration).toContain("Payment amount, currency, or local context mismatch");
    expect(migration).toContain("Provider payment ID is bound to another payment context");
  });

  it("correlates the real second payment ID within the same provider order and checkout", async () => {
    const secondAttempt = {
      id: "attempt-B",
      provider: "RAZORPAY",
      provider_order_id: "order_Tk3Dr8MGXvR9ya",
      provider_payment_id: "pay_Tk3EiYNHka2D7P",
      checkout_session_id: "fa66bf95-7533-4fe8-9206-46b45f5b7778",
      order_id: "512264c5-7a1d-43ec-8a19-41c7bdfa867c",
      amount_paise: 750000,
      currency: "INR",
    };
    mocks.rpc.mockResolvedValue({ data: [secondAttempt], error: null });
    const { resolveRazorpayPaymentAttempt } = await import("../../lib/commerce/payments/correlation");

    const attempt = await resolveRazorpayPaymentAttempt({
      payment: {
        id: "pay_Tk3EiYNHka2D7P",
        order_id: "order_Tk3Dr8MGXvR9ya",
        status: "captured",
        amount: 750000,
        currency: "INR",
      },
      checkoutSessionId: "fa66bf95-7533-4fe8-9206-46b45f5b7778",
    });

    expect(attempt).toEqual(secondAttempt);
    expect(mocks.rpc).toHaveBeenCalledWith("resolve_razorpay_payment_attempt", {
      p_provider_order_id: "order_Tk3Dr8MGXvR9ya",
      p_provider_payment_id: "pay_Tk3EiYNHka2D7P",
      p_amount_paise: 750000,
      p_currency: "INR",
      p_checkout_session_id: "fa66bf95-7533-4fe8-9206-46b45f5b7778",
      p_subscription_cycle_id: null,
    });
  });

  it("fails closed when the database rejects an amount, currency, or checkout mismatch", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "Payment amount, currency, or local context mismatch" } });
    const { resolveRazorpayPaymentAttempt } = await import("../../lib/commerce/payments/correlation");
    await expect(resolveRazorpayPaymentAttempt({
      payment: { id: "pay_wrong", order_id: "order_Tk3Dr8MGXvR9ya", status: "captured", amount: 1, currency: "USD" },
      checkoutSessionId: "wrong-checkout",
    })).rejects.toThrow(/correlation failed/);
  });
});
