import { supabaseAdmin } from "@/lib/supabaseAdmin";

export function webhookReservationDecision(errorCode?: string): "DUPLICATE" | "ERROR" {
  return errorCode === "23505" ? "DUPLICATE" : "ERROR";
}

export async function reservePaymentWebhookEvent(args: {
  eventId: string;
  eventType: string;
  providerOrderId?: string;
  providerPaymentId?: string;
  signatureValid: boolean;
  payload: Record<string, unknown>;
}): Promise<{ duplicate: boolean; id?: string }> {
  const result = await supabaseAdmin.from("payment_events").insert({
    provider: "RAZORPAY",
    provider_event_id: args.eventId,
    event_type: args.eventType,
    provider_order_id: args.providerOrderId ?? null,
    provider_payment_id: args.providerPaymentId ?? null,
    signature_valid: args.signatureValid,
    raw_payload: args.payload,
  }).select("id").single();
  if (result.error && webhookReservationDecision(result.error.code) === "DUPLICATE") {
    return { duplicate: true };
  }
  if (result.error || !result.data) throw new Error(`Webhook event persistence failed: ${result.error?.message}`);
  return { duplicate: false, id: result.data.id as string };
}
