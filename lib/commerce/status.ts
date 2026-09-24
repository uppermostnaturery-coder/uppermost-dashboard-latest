import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { CommerceError } from "./http";
import { resolveMessage } from "./messages";
import type { CustomerMessageKey, NormalizedPaymentState } from "./types";

const MESSAGE_BY_STATE: Partial<Record<NormalizedPaymentState, CustomerMessageKey>> = {
  CHECKOUT_READY: "PAYMENT_CONFIRMING",
  AUTHORIZING: "PAYMENT_CONFIRMING",
  VERIFYING: "PAYMENT_CONFIRMING",
  CONFIRMED: "PAYMENT_CONFIRMED",
  ACTIVATION_PENDING: "PAYMENT_PENDING",
  PENDING: "PAYMENT_PENDING",
  FAILED_RETRYABLE: "PAYMENT_FAILED",
  INSUFFICIENT_FUNDS: "PAYMENT_FAILED",
  MANDATE_ACTION_REQUIRED: "MANDATE_REAUTH_REQUIRED",
  MANDATE_PAUSED: "MANDATE_PAUSED",
  MANDATE_EXPIRED: "MANDATE_REAUTH_REQUIRED",
  CAP_EXCEEDED: "MANDATE_REAUTH_REQUIRED",
  CUSTOMER_CANCELLED: "PAYMENT_FAILED",
  QUOTE_CHANGED: "QUOTE_CHANGED",
  QUOTE_EXPIRED: "QUOTE_CHANGED",
  SYSTEM_ERROR: "PAYMENT_FAILED",
};

export function retryAllowedForState(state: string): boolean {
  return ["FAILED_RETRYABLE", "INSUFFICIENT_FUNDS", "CUSTOMER_CANCELLED", "SYSTEM_ERROR"].includes(state);
}

export async function getCheckoutStatus(sessionId: string) {
  const result = await supabaseAdmin
    .from("checkout_sessions")
    .select("id, state, order_id, experience_token")
    .eq("id", sessionId)
    .maybeSingle();
  if (result.error) throw new Error(`Checkout status lookup failed: ${result.error.message}`);
  if (!result.data) throw new CommerceError("CHECKOUT_NOT_FOUND", "Checkout session was not found.", 404);

  let orderNumber: string | undefined;
  let subscriptionId: string | undefined;
  if (result.data.order_id) {
    const order = await supabaseAdmin
      .from("orders")
      .select("order_number, subscription_id")
      .eq("id", result.data.order_id)
      .single();
    if (order.data) {
      orderNumber = order.data.order_number;
      subscriptionId = order.data.subscription_id ?? undefined;
    }
  }
  const state = result.data.state as NormalizedPaymentState;
  const message = await resolveMessage(MESSAGE_BY_STATE[state] ?? "PAYMENT_PENDING");
  return {
    ok: true,
    state,
    retry_allowed: retryAllowedForState(state),
    ...(orderNumber ? { order_id: orderNumber } : {}),
    ...(subscriptionId ? { subscription_id: subscriptionId } : {}),
    message,
    ...(state === "CONFIRMED" || state === "ACTIVATION_PENDING"
      ? { next: { type: "EXPERIENCE", url: `/experience?t=${result.data.experience_token}` } }
      : {}),
  };
}

