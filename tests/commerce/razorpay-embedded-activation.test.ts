import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  bind: vi.fn(),
  processToken: vi.fn(),
  replayTokens: vi.fn(),
  message: vi.fn(),
  shipment: vi.fn(),
  query: null as null | ((table: string) => unknown),
}));

vi.mock("@/lib/supabaseAdmin", () => ({
  supabaseAdmin: { from: (table: string) => mocks.query!(table) },
}));

vi.mock("@/lib/commerce/payments/mandates", async () => {
  const actual = await vi.importActual<typeof import("../../lib/commerce/payments/mandates")>(
    "../../lib/commerce/payments/mandates"
  );
  return {
    ...actual,
    bindMandateTokenFromPayment: mocks.bind,
    processRazorpayTokenEvent: mocks.processToken,
    reprocessPendingTokenEvents: mocks.replayTokens,
  };
});

vi.mock("@/lib/commerce/messages", () => ({ createCustomerMessage: mocks.message }));
vi.mock("@/lib/commerce/fulfillment", () => ({ ensureShipmentForOrder: mocks.shipment }));

type Row = Record<string, any>;

function createHarness() {
  const db = {
    payment_attempts: {
      id: "attempt-1",
      order_id: "order-internal-1",
      checkout_session_id: "checkout-1",
      subscription_cycle_id: null,
      provider_order_id: "order_Tk3dtVL4COB84H",
      provider_payment_id: null,
      kind: "RECURRING_AUTH",
      amount_paise: 375000,
      currency: "INR",
      status: "CREATED",
      normalized_state: "CHECKOUT_READY",
      raw_error: null,
    } as Row,
    orders: {
      id: "order-internal-1",
      customer_id: "customer-1",
      subscription_id: "subscription-1",
      status: "PAYMENT_PENDING",
      paid_at: null,
    } as Row,
    checkout_sessions: { id: "checkout-1", state: "VERIFYING" } as Row,
    subscriptions: {
      id: "subscription-1",
      checkout_session_id: "checkout-1",
      initial_order_id: "order-internal-1",
      interval_days: 30,
      current_cycle_number: 1,
      status: "PENDING_AUTH",
      started_at: null,
      next_charge_at: null,
    } as Row,
    recurring_mandates: {
      id: "mandate-1",
      subscription_id: "subscription-1",
      status: "PENDING",
      provider_token_id: null,
      provider_order_id: "order_Tk3dtVL4COB84H",
      provider_payment_id: null,
    } as Row,
    subscription_cycles: [] as Row[],
  };

  class Query implements PromiseLike<any> {
    private operation: "select" | "update" | "upsert" = "select";
    private values: Row | null = null;
    private filters: Array<{ op: "eq" | "neq" | "in" | "is"; column: string; value: any }> = [];

    constructor(private readonly table: keyof typeof db) {}
    select() { return this; }
    update(values: Row) { this.operation = "update"; this.values = values; return this; }
    upsert(values: Row) { this.operation = "upsert"; this.values = values; return this; }
    eq(column: string, value: any) { this.filters.push({ op: "eq", column, value }); return this; }
    neq(column: string, value: any) { this.filters.push({ op: "neq", column, value }); return this; }
    in(column: string, value: any[]) { this.filters.push({ op: "in", column, value }); return this; }
    is(column: string, value: any) { this.filters.push({ op: "is", column, value }); return this; }
    order() { return this; }
    limit() { return this; }
    single() { return Promise.resolve(this.execute()); }
    maybeSingle() { return Promise.resolve(this.execute()); }
    then<TResult1 = any, TResult2 = never>(
      onfulfilled?: ((value: any) => TResult1 | PromiseLike<TResult1>) | null,
      onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null
    ): PromiseLike<TResult1 | TResult2> {
      return Promise.resolve(this.execute()).then(onfulfilled, onrejected);
    }

    private matches(row: Row) {
      return this.filters.every((filter) => {
        if (filter.op === "eq") return row[filter.column] === filter.value;
        if (filter.op === "neq") return row[filter.column] !== filter.value;
        if (filter.op === "in") return filter.value.includes(row[filter.column]);
        return row[filter.column] === filter.value;
      });
    }

    private execute() {
      if (this.table === "subscription_cycles") {
        if (this.operation === "upsert" && this.values) {
          const existing = db.subscription_cycles.find((cycle) =>
            cycle.subscription_id === this.values!.subscription_id &&
            cycle.cycle_number === this.values!.cycle_number
          );
          if (!existing) db.subscription_cycles.push({ ...this.values });
        }
        return { data: null, error: null };
      }

      const row = db[this.table] as Row;
      if (!this.matches(row)) return { data: null, error: null };
      if (this.operation === "update" && this.values) Object.assign(row, this.values);
      return { data: row, error: null };
    }
  }

  mocks.query = (table: string) => new Query(table as keyof typeof db);
  mocks.bind.mockImplementation(async ({ providerTokenId, providerOrderId, providerPaymentId }) => {
    const mandate = db.recurring_mandates;
    if (mandate.provider_token_id && mandate.provider_token_id !== providerTokenId) {
      throw new Error("MANDATE_PROVIDER_TOKEN_CONFLICT");
    }
    Object.assign(mandate, {
      provider_token_id: providerTokenId,
      provider_order_id: providerOrderId,
      provider_payment_id: providerPaymentId,
    });
  });
  mocks.processToken.mockImplementation(async ({ eventType, token }) => {
    if (eventType === "token.confirmed" && token.recurring_details?.status === "confirmed") {
      db.recurring_mandates.status = "ACTIVE";
      return { ignored: false, state: "ACTIVE", mandateId: "mandate-1" };
    }
    return { ignored: false, state: db.recurring_mandates.status, mandateId: "mandate-1" };
  });
  mocks.replayTokens.mockResolvedValue(undefined);
  mocks.message.mockResolvedValue(undefined);
  mocks.shipment.mockResolvedValue(undefined);
  return db;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("embedded Razorpay recurring-token activation", () => {
  it("converges a captured payment with a confirmed embedded token to one active subscription cycle", async () => {
    const db = createHarness();
    const { reconcilePaymentAttempt } = await import("../../lib/commerce/payments/service");
    const payment = {
      id: "pay_Tk3e0A9yrAGRhN",
      order_id: "order_Tk3dtVL4COB84H",
      status: "captured",
      amount: 375000,
      currency: "INR",
      created_at: 1_790_000_000,
      token_id: "token_Tk3e0Jvok384vy",
      token: {
        id: "token_Tk3e0Jvok384vy",
        recurring: true,
        recurring_details: { status: "confirmed" },
      },
    };

    await reconcilePaymentAttempt({
      attempt: db.payment_attempts,
      payment,
      providerEventId: "event-captured-1",
      providerEventCreatedAt: 1_790_000_000,
    });

    expect(db.payment_attempts.status).toBe("CAPTURED");
    expect(db.payment_attempts.normalized_state).toBe("CONFIRMED");
    expect(db.orders.status).toBe("CONFIRMED");
    expect(db.recurring_mandates.status).toBe("ACTIVE");
    expect(db.subscriptions.status).toBe("ACTIVE");
    expect(db.checkout_sessions.state).toBe("CONFIRMED");
    expect(db.subscriptions.started_at).toBeTruthy();
    expect(db.subscriptions.next_charge_at).toBeTruthy();
    expect(new Date(db.subscriptions.next_charge_at).getTime() - new Date(db.subscriptions.started_at).getTime())
      .toBe(30 * 24 * 60 * 60 * 1000);
    expect(db.subscription_cycles).toHaveLength(1);
    expect(db.subscription_cycles[0]).toMatchObject({ cycle_number: 2, status: "DUE" });
    expect(mocks.processToken).toHaveBeenCalledWith(expect.objectContaining({
      eventType: "token.confirmed",
      eventId: "event-captured-1",
    }));

    const startedAt = db.subscriptions.started_at;
    const nextChargeAt = db.subscriptions.next_charge_at;
    await reconcilePaymentAttempt({
      attempt: db.payment_attempts,
      payment,
      providerEventId: "event-captured-duplicate",
      providerEventCreatedAt: 1_790_000_000,
    });
    expect(db.subscription_cycles).toHaveLength(1);
    expect(db.subscriptions.started_at).toBe(startedAt);
    expect(db.subscriptions.next_charge_at).toBe(nextChargeAt);
  });

  it("keeps capture activation-pending when only token_id is present", async () => {
    const db = createHarness();
    const { reconcilePaymentAttempt } = await import("../../lib/commerce/payments/service");
    await reconcilePaymentAttempt({
      attempt: db.payment_attempts,
      payment: {
        id: "pay_Tk3e0A9yrAGRhN",
        order_id: "order_Tk3dtVL4COB84H",
        status: "captured",
        amount: 375000,
        currency: "INR",
        token_id: "token_Tk3e0Jvok384vy",
      },
    });

    expect(db.payment_attempts.status).toBe("CAPTURED");
    expect(db.recurring_mandates.status).toBe("PENDING");
    expect(db.subscriptions.status).toBe("PENDING_AUTH");
    expect(db.checkout_sessions.state).toBe("ACTIVATION_PENDING");
    expect(db.subscriptions.started_at).toBeNull();
    expect(db.subscriptions.next_charge_at).toBeNull();
    expect(db.subscription_cycles).toHaveLength(0);
    expect(mocks.processToken).not.toHaveBeenCalled();
  });

  it("activates when standalone token confirmation arrives after capture", async () => {
    const db = createHarness();
    const { reconcilePaymentAttempt } = await import("../../lib/commerce/payments/service");
    const { activateSubscriptionIfReady } = await import("../../lib/commerce/subscriptions/activation");
    await reconcilePaymentAttempt({
      attempt: db.payment_attempts,
      payment: {
        id: "pay_Tk3e0A9yrAGRhN",
        order_id: "order_Tk3dtVL4COB84H",
        status: "captured",
        amount: 375000,
        currency: "INR",
        token_id: "token_Tk3e0Jvok384vy",
      },
    });
    expect(db.checkout_sessions.state).toBe("ACTIVATION_PENDING");

    db.recurring_mandates.status = "ACTIVE";
    await activateSubscriptionIfReady("subscription-1");
    expect(db.subscriptions.status).toBe("ACTIVE");
    expect(db.checkout_sessions.state).toBe("CONFIRMED");
    expect(db.subscription_cycles).toHaveLength(1);
  });

  it("activates when standalone token confirmation arrives before capture", async () => {
    const db = createHarness();
    const { reconcilePaymentAttempt } = await import("../../lib/commerce/payments/service");
    const { activateSubscriptionIfReady } = await import("../../lib/commerce/subscriptions/activation");
    db.recurring_mandates.status = "ACTIVE";
    db.recurring_mandates.provider_token_id = "token_Tk3e0Jvok384vy";
    const beforeCapture = await activateSubscriptionIfReady("subscription-1");
    expect(beforeCapture.state).toBe("ACTIVATION_PENDING");

    await reconcilePaymentAttempt({
      attempt: db.payment_attempts,
      payment: {
        id: "pay_Tk3e0A9yrAGRhN",
        order_id: "order_Tk3dtVL4COB84H",
        status: "captured",
        amount: 375000,
        currency: "INR",
        token_id: "token_Tk3e0Jvok384vy",
      },
    });
    expect(db.subscriptions.status).toBe("ACTIVE");
    expect(db.checkout_sessions.state).toBe("CONFIRMED");
    expect(db.subscription_cycles).toHaveLength(1);
  });

  it("fails closed and records a reconciliation error for conflicting token IDs", async () => {
    const db = createHarness();
    const { reconcilePaymentAttempt } = await import("../../lib/commerce/payments/service");
    await expect(reconcilePaymentAttempt({
      attempt: db.payment_attempts,
      payment: {
        id: "pay_Tk3e0A9yrAGRhN",
        order_id: "order_Tk3dtVL4COB84H",
        status: "captured",
        amount: 375000,
        currency: "INR",
        token_id: "token_expected",
        token: {
          id: "token_conflicting",
          recurring: true,
          recurring_details: { status: "confirmed" },
        },
      },
    })).rejects.toThrow("PAYMENT_EMBEDDED_TOKEN_ID_CONFLICT");

    expect(db.payment_attempts.raw_error).toEqual({ code: "PAYMENT_EMBEDDED_TOKEN_ID_CONFLICT" });
    expect(db.recurring_mandates.status).toBe("PENDING");
    expect(db.subscriptions.status).toBe("PENDING_AUTH");
    expect(db.subscription_cycles).toHaveLength(0);
  });
});
