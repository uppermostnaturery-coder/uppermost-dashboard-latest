import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { createCustomerMessage } from "../messages";
import { activateSubscriptionIfReady } from "../subscriptions/activation";

export const RAZORPAY_TOKEN_EVENTS = [
  "token.confirmed",
  "token.rejected",
  "token.cancelled",
  "token.paused",
] as const;

export type RazorpayTokenEvent = (typeof RAZORPAY_TOKEN_EVENTS)[number];
export type MandateState = "PENDING" | "ACTIVE" | "PAUSED" | "REJECTED" | "REAUTH_REQUIRED" | "EXPIRED" | "CANCELLED";

export type RazorpayTokenEntity = {
  id?: string;
  customer_id?: string;
  payment_id?: string;
  order_id?: string;
  recurring?: boolean;
  created_at?: number;
  recurring_details?: { status?: string };
};

const TOKEN_EVENT_STATE: Record<RazorpayTokenEvent, MandateState> = {
  "token.confirmed": "ACTIVE",
  "token.rejected": "REJECTED",
  "token.cancelled": "CANCELLED",
  "token.paused": "PAUSED",
};

export function isRazorpayTokenEvent(value: string): value is RazorpayTokenEvent {
  return (RAZORPAY_TOKEN_EVENTS as readonly string[]).includes(value);
}

export function embeddedRazorpayTokenEvent(token: RazorpayTokenEntity): RazorpayTokenEvent | null {
  if (!token.id || token.recurring !== true) return null;
  const status = token.recurring_details?.status?.trim().toLowerCase();
  if (!status) return null;
  const eventByStatus: Record<string, RazorpayTokenEvent> = {
    confirmed: "token.confirmed",
    rejected: "token.rejected",
    paused: "token.paused",
    cancelled: "token.cancelled",
    canceled: "token.cancelled",
  };
  const eventType = eventByStatus[status];
  if (!eventType) throw new Error(`Unsupported Razorpay embedded recurring token status: ${status}`);
  return eventType;
}

export function providerTokenState(eventType: RazorpayTokenEvent, token: RazorpayTokenEntity): MandateState {
  const payloadStatus = token.recurring_details?.status?.trim().toLowerCase();
  const accepted: Record<string, MandateState> = {
    confirmed: "ACTIVE",
    active: "ACTIVE",
    rejected: "REJECTED",
    paused: "PAUSED",
    cancelled: "CANCELLED",
    canceled: "CANCELLED",
  };
  if (payloadStatus) {
    const mapped = accepted[payloadStatus];
    if (!mapped) throw new Error(`Unsupported Razorpay recurring token status: ${payloadStatus}`);
    if (mapped !== TOKEN_EVENT_STATE[eventType]) {
      throw new Error(`Razorpay token event and recurring status disagree: ${eventType}/${payloadStatus}`);
    }
    return mapped;
  }
  // Razorpay's confirmed card-token example omits recurring_details. The
  // explicit allowlisted event name is the only fallback; no generic payload
  // or unknown state can activate a mandate.
  return TOKEN_EVENT_STATE[eventType];
}

export function nextMandateState(current: MandateState, incoming: MandateState): MandateState {
  if (current === "CANCELLED" || current === "EXPIRED") return current;
  if (current === "REJECTED") return incoming === "CANCELLED" ? "CANCELLED" : current;
  if (current === "PAUSED") return incoming === "CANCELLED" ? "CANCELLED" : current;
  if (current === "REAUTH_REQUIRED") return incoming === "CANCELLED" ? "CANCELLED" : current;
  if (current === "ACTIVE" && (incoming === "PENDING" || incoming === "REJECTED")) return current;
  return incoming;
}

function eventCreatedAt(payloadCreatedAt: number | undefined, tokenCreatedAt: number | undefined): string | null {
  const seconds = payloadCreatedAt ?? tokenCreatedAt;
  return typeof seconds === "number" && Number.isFinite(seconds)
    ? new Date(seconds * 1000).toISOString()
    : null;
}

async function locateMandate(token: RazorpayTokenEntity) {
  if (!token.id) return null;
  const byToken = await supabaseAdmin.from("recurring_mandates").select("*")
    .eq("provider_token_id", token.id).maybeSingle();
  if (byToken.error) throw new Error(`Mandate token lookup failed: ${byToken.error.message}`);
  if (byToken.data) return byToken.data;

  if (token.order_id) {
    const byOrder = await supabaseAdmin.from("recurring_mandates").select("*")
      .eq("provider_order_id", token.order_id).maybeSingle();
    if (byOrder.error) throw new Error(`Mandate order lookup failed: ${byOrder.error.message}`);
    if (byOrder.data) return byOrder.data;
  }

  const lookup = token.payment_id
    ? { column: "provider_payment_id", value: token.payment_id }
    : token.order_id
      ? { column: "provider_order_id", value: token.order_id }
      : null;
  if (!lookup) return null;
  const attempt = await supabaseAdmin.from("payment_attempts")
    .select("order_id")
    .eq(lookup.column, lookup.value)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (attempt.error) throw new Error(`Token payment correlation failed: ${attempt.error.message}`);
  if (!attempt.data) return null;
  const order = await supabaseAdmin.from("orders").select("subscription_id")
    .eq("id", attempt.data.order_id).maybeSingle();
  if (order.error) throw new Error(`Token order correlation failed: ${order.error.message}`);
  if (!order.data?.subscription_id) return null;
  const mandate = await supabaseAdmin.from("recurring_mandates").select("*")
    .eq("subscription_id", order.data.subscription_id).maybeSingle();
  if (mandate.error) throw new Error(`Token mandate correlation failed: ${mandate.error.message}`);
  return mandate.data;
}

function assertMandateProviderBinding(
  mandate: {
    provider_token_id?: string | null;
    provider_order_id?: string | null;
    provider_payment_id?: string | null;
  },
  token: RazorpayTokenEntity
) {
  if (mandate.provider_token_id && mandate.provider_token_id !== token.id) {
    throw new Error("MANDATE_PROVIDER_TOKEN_CONFLICT");
  }
  if (token.order_id && mandate.provider_order_id && mandate.provider_order_id !== token.order_id) {
    throw new Error("MANDATE_PROVIDER_ORDER_CONFLICT");
  }
  if (token.payment_id && mandate.provider_payment_id && mandate.provider_payment_id !== token.payment_id) {
    throw new Error("MANDATE_PROVIDER_PAYMENT_CONFLICT");
  }
}

export async function processRazorpayTokenEvent(args: {
  eventType: RazorpayTokenEvent;
  eventId: string;
  payloadCreatedAt?: number;
  token: RazorpayTokenEntity;
}) {
  if (!args.token.id) throw new Error("Razorpay token event has no token ID.");
  const mandate = await locateMandate(args.token);
  if (!mandate) throw new Error("TOKEN_CORRELATION_PENDING");
  assertMandateProviderBinding(mandate, args.token);
  const occurredAt = eventCreatedAt(args.payloadCreatedAt, args.token.created_at);
  const incoming = providerTokenState(args.eventType, args.token);
  const transition = await supabaseAdmin.rpc("apply_recurring_mandate_event", {
    p_mandate_id: mandate.id,
    p_incoming_status: incoming,
    p_provider_event_id: args.eventId,
    p_event_created_at: occurredAt,
    p_provider_token_id: args.token.id,
    p_provider_order_id: args.token.order_id ?? null,
    p_provider_payment_id: args.token.payment_id ?? null,
    p_raw_metadata: args.token,
  });
  const transitionRow = Array.isArray(transition.data) ? transition.data[0] : transition.data;
  if (transition.error || !transitionRow) throw new Error(`Mandate transition failed: ${transition.error?.message ?? "No result"}`);
  const next = transitionRow.resulting_status as MandateState;
  if (!transitionRow.applied) return { ignored: true, reason: "STALE_EVENT", mandateId: mandate.id };

  if (next === "ACTIVE") await activateSubscriptionIfReady(mandate.subscription_id);
  if (["PAUSED", "REJECTED", "CANCELLED"].includes(next)) {
    const subscriptionStatus = next === "PAUSED" ? "PAUSED" : next === "CANCELLED" ? "CANCELLED" : "REAUTH_REQUIRED";
    await supabaseAdmin.from("subscriptions").update({ status: subscriptionStatus }).eq("id", mandate.subscription_id).neq("status", "CANCELLED");
    const key = next === "PAUSED" ? "MANDATE_PAUSED" : next === "CANCELLED" ? "MANDATE_CANCELLED" : "MANDATE_REJECTED";
    await createCustomerMessage({ customerId: mandate.customer_id, key, subscriptionId: mandate.subscription_id });
  }
  return { ignored: false, state: next, mandateId: mandate.id };
}

export async function bindMandateTokenFromPayment(args: {
  subscriptionId: string;
  providerTokenId: string;
  providerOrderId: string;
  providerPaymentId: string;
}) {
  const current = await supabaseAdmin.from("recurring_mandates")
    .select("id, provider_token_id, provider_order_id, provider_payment_id")
    .eq("subscription_id", args.subscriptionId)
    .single();
  if (current.error || !current.data) {
    throw new Error(`Mandate payment correlation failed: ${current.error?.message ?? "Mandate not found"}`);
  }
  assertMandateProviderBinding(current.data, {
    id: args.providerTokenId,
    order_id: args.providerOrderId,
    payment_id: args.providerPaymentId,
  });

  let update = supabaseAdmin.from("recurring_mandates").update({
    provider_token_id: args.providerTokenId,
    provider_order_id: args.providerOrderId,
    provider_payment_id: args.providerPaymentId,
  }).eq("id", current.data.id);
  update = current.data.provider_token_id
    ? update.eq("provider_token_id", current.data.provider_token_id)
    : update.is("provider_token_id", null);
  update = current.data.provider_order_id
    ? update.eq("provider_order_id", current.data.provider_order_id)
    : update.is("provider_order_id", null);
  update = current.data.provider_payment_id
    ? update.eq("provider_payment_id", current.data.provider_payment_id)
    : update.is("provider_payment_id", null);
  const result = await update.select("id").maybeSingle();
  if (result.error || !result.data) {
    throw new Error(`Mandate payment correlation failed: ${result.error?.message ?? "Provider binding changed concurrently"}`);
  }
}

export async function reprocessPendingTokenEvents(providerTokenId: string) {
  const events = await supabaseAdmin.from("payment_events")
    .select("id, provider_event_id, event_type, raw_payload")
    .eq("provider", "RAZORPAY")
    .eq("processing_status", "FAILED")
    .in("event_type", [...RAZORPAY_TOKEN_EVENTS])
    .contains("raw_payload", { payload: { token: { entity: { id: providerTokenId } } } })
    .order("created_at", { ascending: true })
    .limit(20);
  if (events.error) throw new Error(`Pending token-event lookup failed: ${events.error.message}`);
  for (const event of events.data ?? []) {
    const payload = event.raw_payload as {
      created_at?: number;
      payload?: { token?: { entity?: RazorpayTokenEntity } };
    };
    const token = payload.payload?.token?.entity;
    if (!token || !isRazorpayTokenEvent(event.event_type)) continue;
    const claim = await supabaseAdmin.rpc("claim_payment_webhook_event", {
      p_provider: "RAZORPAY",
      p_provider_event_id: event.provider_event_id,
      p_event_type: event.event_type,
      p_provider_order_id: token.order_id ?? null,
      p_provider_payment_id: token.payment_id ?? null,
      p_signature_valid: true,
      p_raw_payload: event.raw_payload,
      p_stale_after_seconds: 300,
    });
    const row = Array.isArray(claim.data) ? claim.data[0] : claim.data;
    if (claim.error || row?.claim_result !== "CLAIMED") continue;
    try {
      await processRazorpayTokenEvent({
        eventType: event.event_type,
        eventId: event.provider_event_id,
        payloadCreatedAt: payload.created_at,
        token,
      });
      await supabaseAdmin.from("payment_events").update({
        processing_status: "PROCESSED",
        processed_at: new Date().toISOString(),
        processing_error: null,
        updated_at: new Date().toISOString(),
      }).eq("id", event.id);
    } catch (error) {
      await supabaseAdmin.from("payment_events").update({
        processing_status: "FAILED",
        processing_error: error instanceof Error ? error.message.slice(0, 1000) : "Token replay failed",
        updated_at: new Date().toISOString(),
      }).eq("id", event.id);
    }
  }
}
