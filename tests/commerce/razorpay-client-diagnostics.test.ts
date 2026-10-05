import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("Razorpay client diagnostics", () => {
  beforeEach(() => {
    process.env.RAZORPAY_KEY_ID = "rzp_test_public_key";
    process.env.RAZORPAY_KEY_SECRET = "super-secret-key";
    process.env.RAZORPAY_WEBHOOK_SECRET = "webhook-secret";
    process.env.RAZORPAY_API_BASE_URL = "https://api.razorpay.com/v1";
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("logs and exposes only allowlisted provider error fields", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      error: {
        code: "BAD_REQUEST_ERROR",
        description: "payment_after must be in the future",
        source: "business",
        step: "order_create",
        reason: "invalid_payment_after",
        field: "notification.payment_after",
        authorization: "Basic should-never-appear",
        key_secret: "super-secret-key",
      },
      request_headers: { Authorization: "Basic should-never-appear" },
    }), { status: 400, headers: { "content-type": "application/json" } }));
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const {
      createRazorpayOrder,
      razorpayCycleLastError,
      RazorpayApiError,
    } = await import("../../lib/commerce/razorpay/client");

    let caught: unknown;
    try {
      await createRazorpayOrder({
        amount: 700_000,
        currency: "INR",
        receipt: "rnl-cycle",
        notes: {
          subscription_id: "sub-1",
          subscription_cycle_id: "cycle-1",
        },
        notification: {
          token_id: "token-safe-id",
          payment_after: 1_800_000_000,
        },
      });
    } catch (error) {
      caught = error;
    }

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(caught).toBeInstanceOf(RazorpayApiError);
    const error = caught as InstanceType<typeof RazorpayApiError>;
    expect(error.providerError).toEqual({
      code: "BAD_REQUEST_ERROR",
      description: "payment_after must be in the future",
      source: "business",
      step: "order_create",
      reason: "invalid_payment_after",
      field: "notification.payment_after",
    });
    expect(razorpayCycleLastError("PROVIDER_ORDER", error)).toEqual({
      stage: "PROVIDER_ORDER",
      provider: "RAZORPAY",
      http_status: 400,
      code: "BAD_REQUEST_ERROR",
      description: "payment_after must be in the future",
      source: "business",
      step: "order_create",
      reason: "invalid_payment_after",
      field: "notification.payment_after",
    });
    expect(log).toHaveBeenCalledWith({
      provider: "RAZORPAY",
      operation: "CREATE_RENEWAL_ORDER",
      method: "POST",
      path: "/v1/orders",
      status: 400,
      provider_error: error.providerError,
      subscription_id: "sub-1",
      subscription_cycle_id: "cycle-1",
      provider_token_id: "token-safe-id",
      amount: 700_000,
      currency: "INR",
    });
    const serializedLog = JSON.stringify(log.mock.calls);
    expect(serializedLog).not.toContain("super-secret-key");
    expect(serializedLog).not.toContain("Authorization");
    expect(serializedLog).not.toContain("should-never-appear");
    expect(serializedLog).not.toContain("Basic ");
  });

  it("uses a safe generic provider error for malformed non-JSON responses", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("<html>upstream failed</html>", {
      status: 502,
      headers: { "content-type": "text/html" },
    }));
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { fetchRazorpayPayment, RazorpayApiError } = await import("../../lib/commerce/razorpay/client");

    await expect(fetchRazorpayPayment("pay_safe_id")).rejects.toMatchObject({
      name: "RazorpayApiError",
      status: 502,
      providerError: {
        code: null,
        description: "Razorpay request failed with status 502.",
        source: null,
        step: null,
        reason: null,
        field: null,
      },
    } satisfies Partial<InstanceType<typeof RazorpayApiError>>);
    expect(log).toHaveBeenCalledWith({
      provider: "RAZORPAY",
      operation: "FETCH_PAYMENT",
      method: "GET",
      path: "/v1/payments/pay_safe_id",
      status: 502,
      provider_error: {
        code: null,
        description: "Razorpay request failed with status 502.",
        source: null,
        step: null,
        reason: null,
        field: null,
      },
      provider_payment_id: "pay_safe_id",
    });
    expect(JSON.stringify(log.mock.calls)).not.toContain("<html>");
  });

  it("redacts credentials if a known provider field echoes them", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      error: {
        code: "BAD_REQUEST_ERROR",
        description: "Authorization: Bearer customer-secret and super-secret-key",
      },
    }), { status: 400 }));
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { createRazorpayCustomer } = await import("../../lib/commerce/razorpay/client");

    await expect(createRazorpayCustomer({
      name: "Test",
      email: "test@example.com",
      contact: "+919999999999",
    })).rejects.toThrow("Razorpay request failed with status 400.");
    const serializedLog = JSON.stringify(log.mock.calls);
    expect(serializedLog).not.toContain("customer-secret");
    expect(serializedLog).not.toContain("super-secret-key");
    expect(serializedLog).not.toContain("Authorization");
    expect(serializedLog).not.toContain("Bearer ");
  });
});
