import { getRazorpayEnv } from "../env";

export class RazorpayApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly payload: unknown
  ) {
    super(message);
    this.name = "RazorpayApiError";
  }
}

async function razorpayRequest<T>(path: string, init: RequestInit): Promise<T> {
  const env = getRazorpayEnv();
  const response = await fetch(`${env.apiBaseUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Basic ${Buffer.from(`${env.keyId}:${env.keySecret}`).toString("base64")}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
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
    throw new RazorpayApiError(
      `Razorpay request failed with status ${response.status}.`,
      response.status,
      payload
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
  return razorpayRequest<RazorpayCustomer>("/customers", {
    method: "POST",
    body: JSON.stringify({ ...input, fail_existing: input.fail_existing ?? "0" }),
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
  return razorpayRequest<RazorpayOrder>("/orders", {
    method: "POST",
    body: JSON.stringify({
      amount: input.amount,
      currency: input.currency,
      receipt: input.receipt,
      notes: input.notes,
      ...(input.notification ? { notification: input.notification } : {}),
      ...recurringFields,
    }),
  });
}

export async function fetchRazorpayPayment(paymentId: string): Promise<RazorpayPayment> {
  return razorpayRequest<RazorpayPayment>(`/payments/${encodeURIComponent(paymentId)}`, {
    method: "GET",
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
  return razorpayRequest<RazorpayPayment>("/payments/create/recurring", {
    method: "POST",
    body: JSON.stringify({ ...input, recurring: true }),
  });
}

export async function fetchRazorpayOrderPayments(orderId: string): Promise<{ items: RazorpayPayment[] }> {
  return razorpayRequest<{ items: RazorpayPayment[] }>(`/orders/${encodeURIComponent(orderId)}/payments`, {
    method: "GET",
  });
}
