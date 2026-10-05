import { supabaseAdmin } from "@/lib/supabaseAdmin";

export function webhookReservationDecision(errorCode?: string): "DUPLICATE" | "ERROR" {
  return errorCode === "23505" ? "DUPLICATE" : "ERROR";
}

export type WebhookClaimResult = "CLAIMED" | "PROCESSED" | "IN_PROGRESS";

export async function reservePaymentWebhookEvent(args: {
  eventId: string;
  eventType: string;
  providerOrderId?: string;
  providerPaymentId?: string;
  signatureValid: boolean;
  payload: Record<string, unknown>;
}): Promise<{ duplicate: boolean; id: string; claimResult: WebhookClaimResult }> {
  const result = await supabaseAdmin.rpc("claim_payment_webhook_event", {
    p_provider: "RAZORPAY",
    p_provider_event_id: args.eventId,
    p_event_type: args.eventType,
    p_provider_order_id: args.providerOrderId ?? null,
    p_provider_payment_id: args.providerPaymentId ?? null,
    p_signature_valid: args.signatureValid,
    p_raw_payload: args.payload,
    p_stale_after_seconds: 300,
  });
  const row = Array.isArray(result.data) ? result.data[0] : result.data;
  if (result.error || !row?.event_id || !row?.claim_result) {
    throw new Error(`Webhook event claim failed: ${result.error?.message ?? "No claim result"}`);
  }
  const claimResult = row.claim_result as WebhookClaimResult;
  return {
    duplicate: claimResult !== "CLAIMED",
    id: row.event_id as string,
    claimResult,
  };
}

export async function markPaymentWebhookProcessed(eventId: string, paymentAttemptId?: string) {
  const result = await supabaseAdmin.from("payment_events").update({
    payment_attempt_id: paymentAttemptId ?? null,
    processing_status: "PROCESSED",
    processed_at: new Date().toISOString(),
    processing_error: null,
    updated_at: new Date().toISOString(),
  }).eq("id", eventId).eq("processing_status", "PROCESSING");
  if (result.error) throw new Error(`Webhook completion persistence failed: ${result.error.message}`);
}

export async function markPaymentWebhookFailed(eventId: string, error: unknown) {
  const message = error instanceof Error ? error.message : "Unknown webhook processing error";
  const result = await supabaseAdmin.from("payment_events").update({
    processing_status: "FAILED",
    processing_error: message.slice(0, 1000),
    updated_at: new Date().toISOString(),
  }).eq("id", eventId).eq("processing_status", "PROCESSING");
  if (result.error) console.error("Webhook failure persistence failed", { eventId, code: result.error.code });
}
