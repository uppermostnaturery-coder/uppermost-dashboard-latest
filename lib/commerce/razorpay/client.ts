import { getRazorpayEnv } from "../env";

export type RazorpayProviderError = {
  code: string | null;
  description: string;
  source: string | null;
  step: string | null;
  reason: string | null;
  field: string | null;
};

export type RazorpaySafeContext = Partial<{
  subscription_id: string;
  subscription_cycle_id: string;
  provider_order_id: string;
  provider_payment_id: string;
  provider_token_id: string;
  amount: number;
  currency: string;
}>;

type RazorpayOperation =
  | "CREATE_CUSTOMER"
  | "CREATE_ORDER"
  | "CREATE_RENEWAL_ORDER"
  | "FETCH_PAYMENT"
  | "CREATE_RECURRING_PAYMENT"
  | "FETCH_ORDER_PAYMENTS";

export class RazorpayApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly payload: unknown,
    readonly providerError: RazorpayProviderError
  ) {
    super(message);
    this.name = "RazorpayApiError";
  }
}

function sanitizedText(value: unknown, sensitiveValues: string[]): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  let text = String(value).slice(0, 1000);
  text = text.replace(/(?:\bAuthorization\s*:\s*)?\b(?:Basic|Bearer)\s+\S+/gi, "[REDACTED]");
  for (const sensitive of sensitiveValues) {
    if (sensitive) text = text.split(sensitive).join("[REDACTED]");
  }
  return text;
}

export function sanitizeRazorpayProviderError(
  payload: unknown,
  status: number,
  sensitiveValues: string[] = []
): RazorpayProviderError {
  const root = payload && typeof payload === "object"
    ? payload as Record<string, unknown>
    : null;
  const error = root?.error && typeof root.error === "object"
    ? root.error as Record<string, unknown>
    : root;
  const genericDescription = `Razorpay request failed with status ${status}.`;
  return {
    code: sanitizedText(error?.code, sensitiveValues),
    description: sanitizedText(error?.description, sensitiveValues) ?? genericDescription,
    source: sanitizedText(error?.source, sensitiveValues),
    step: sanitizedText(error?.step, sensitiveValues),
    reason: sanitizedText(error?.reason, sensitiveValues),
    field: sanitizedText(error?.field, sensitiveValues),
  };
}

export function razorpayCycleLastError(stage: string, error: unknown) {
  if (!(error instanceof RazorpayApiError)) {
    return {
      stage,
      message: error instanceof Error ? error.message : "Unknown provider result",
    };
  }
  return {
    stage,
    provider: "RAZORPAY" as const,
    http_status: error.status,
    ...error.providerError,
  };
}

function razorpayApiPath(apiBaseUrl: string, path: string): string {
  try {
    const basePath = new URL(apiBaseUrl).pathname.replace(/\/$/, "");
    return `${basePath}${path}`.replace(/\/{2,}/g, "/");
  } catch {
    return path;
  }
}

function definedSafeContext(context: RazorpaySafeContext | undefined): RazorpaySafeContext {
  return Object.fromEntries(
    Object.entries(context ?? {}).filter(([, value]) => value !== undefined)
  ) as RazorpaySafeContext;
}

async function razorpayRequest<T>(args: {
  operation: RazorpayOperation;
  path: string;
  init: RequestInit;
  safeContext?: RazorpaySafeContext;
}): Promise<T> {
  const env = getRazorpayEnv();
  const response = await fetch(`${env.apiBaseUrl}${args.path}`, {
    ...args.init,
    headers: {
      Authorization: `Basic ${Buffer.from(`${env.keyId}:${env.keySecret}`).toString("base64")}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(args.init.headers ?? {}),
    },
    cache: "no-store",
  });
  const text = await response.text();
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }
  if (!response.ok) {
    const providerError = sanitizeRazorpayProviderError(payload, response.status, [
      env.keyId,
      env.keySecret,
      Buffer.from(`${env.keyId}:${env.keySecret}`).toString("base64"),
    ]);
    console.error({
      provider: "RAZORPAY",
      operation: args.operation,
      method: (args.init.method ?? "GET").toUpperCase(),
      path: razorpayApiPath(env.apiBaseUrl, args.path),
      status: response.status,
      provider_error: providerError,
      ...definedSafeContext(args.safeContext),
    });
    throw new RazorpayApiError(
      `Razorpay request failed with status ${response.status}.`,
      response.status,
      payload,
      providerError
    );
  }
  return payload as T;
}

export type RazorpayCustomer = { id: string };
export type RazorpayOrder = {
  id: string;
  amount: number;
  currency: string;
  status: string;
  receipt?: string;
};
export type RazorpayPayment = {
  id: string;
  order_id?: string;
  status: string;
  amount: number;
  currency: string;
  created_at?: number;
  customer_id?: string;
  token_id?: string;
  token?: {
    id?: string;
    recurring?: boolean;
    recurring_details?: { status?: string };
    created_at?: number;
  };
  method?: string;
  error_code?: string | null;
  error_description?: string | null;
  error_source?: string | null;
  error_step?: string | null;
  error_reason?: string | null;
};

export async function createRazorpayCustomer(input: {
  name: string;
  email: string;
  contact: string;
  fail_existing?: "0" | "1";
}): Promise<RazorpayCustomer> {
  return razorpayRequest<RazorpayCustomer>({
    operation: "CREATE_CUSTOMER",
    path: "/customers",
    init: {
      method: "POST",
      body: JSON.stringify({ ...input, fail_existing: input.fail_existing ?? "0" }),
    },
  });
}

export async function createRazorpayOrder(input: {
  amount: number;
  currency: "INR";
  receipt: string;
  notes: Record<string, string>;
  customer_id?: string;
  recurring?: {
    max_amount: number;
    expire_at: number;
    frequency: "as_presented";
  };
  notification?: {
    token_id: string;
    payment_after: number;
  };
}): Promise<RazorpayOrder> {
  const recurringFields = input.recurring
    ? {
        customer_id: input.customer_id,
        method: "upi",
        token: input.recurring,
      }
    : {};
  return razorpayRequest<RazorpayOrder>({
    operation: input.notification ? "CREATE_RENEWAL_ORDER" : "CREATE_ORDER",
    path: "/orders",
    safeContext: {
      subscription_id: input.notes.subscription_id,
      subscription_cycle_id: input.notes.subscription_cycle_id,
      provider_token_id: input.notification?.token_id,
      amount: input.amount,
      currency: input.currency,
    },
    init: {
      method: "POST",
      body: JSON.stringify({
        amount: input.amount,
        currency: input.currency,
        receipt: input.receipt,
        notes: input.notes,
        ...(input.notification ? { notification: input.notification } : {}),
        ...recurringFields,
      }),
    },
  });
}

export async function fetchRazorpayPayment(paymentId: string): Promise<RazorpayPayment> {
  const path = `/payments/${encodeURIComponent(paymentId)}`;
  return razorpayRequest<RazorpayPayment>({
    operation: "FETCH_PAYMENT",
    path,
    safeContext: { provider_payment_id: paymentId },
    init: { method: "GET" },
  });
}

export async function createRazorpayRecurringPayment(input: {
  email: string;
  contact: string;
  amount: number;
  currency: "INR";
  order_id: string;
  customer_id: string;
  token: string;
  description: string;
}): Promise<RazorpayPayment> {
  return razorpayRequest<RazorpayPayment>({
    operation: "CREATE_RECURRING_PAYMENT",
    path: "/payments/create/recurring",
    safeContext: {
      provider_order_id: input.order_id,
      provider_token_id: input.token,
      amount: input.amount,
      currency: input.currency,
    },
    init: {
      method: "POST",
      body: JSON.stringify({ ...input, recurring: true }),
    },
  });
}

export async function fetchRazorpayOrderPayments(orderId: string): Promise<{ items: RazorpayPayment[] }> {
  const path = `/orders/${encodeURIComponent(orderId)}/payments`;
  return razorpayRequest<{ items: RazorpayPayment[] }>({
    operation: "FETCH_ORDER_PAYMENTS",
    path,
    safeContext: { provider_order_id: orderId },
    init: { method: "GET" },
  });
}
