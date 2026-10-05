import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { sha256, verifyHmacHex } from "@/lib/commerce/crypto";
import { getRazorpayEnv } from "@/lib/commerce/env";
import { commerceJson, errorResponse } from "@/lib/commerce/http";
import {
  isRazorpayTokenEvent,
  processRazorpayTokenEvent,
  type RazorpayTokenEntity,
} from "@/lib/commerce/payments/mandates";
import { reconcilePaymentAttempt } from "@/lib/commerce/payments/service";
import type { RazorpayPayment } from "@/lib/commerce/razorpay/client";
import {
  markPaymentWebhookFailed,
  markPaymentWebhookProcessed,
  reservePaymentWebhookEvent,
} from "@/lib/commerce/webhooks";

export const runtime = "nodejs";

const RAZORPAY_PAYMENT_EVENTS = [
  "payment.authorized",
  "payment.captured",
  "payment.failed",
] as const;

type RazorpayWebhook = {
  event?: string;
  created_at?: number;
  payload?: {
    payment?: { entity?: RazorpayPayment };
    token?: { entity?: RazorpayTokenEntity };
  };
};

function isPaymentEvent(value: string): boolean {
  return (RAZORPAY_PAYMENT_EVENTS as readonly string[]).includes(value);
}

async function findPaymentAttempt(payment: RazorpayPayment) {
  if (payment.order_id) {
    const result = await supabaseAdmin.from("payment_attempts")
      .select("*").eq("provider_order_id", payment.order_id).maybeSingle();
    if (result.error) throw new Error(`Payment attempt lookup failed: ${result.error.message}`);
    if (result.data) return result.data;
  }
  const result = await supabaseAdmin.from("payment_attempts")
    .select("*").eq("provider_payment_id", payment.id).maybeSingle();
  if (result.error) throw new Error(`Payment attempt lookup failed: ${result.error.message}`);
  return result.data;
}

export async function POST(request: Request) {
  let claimedEventId: string | null = null;
  try {
    const raw = await request.text();
    const signature = request.headers.get("x-razorpay-signature") ?? "";
    if (!verifyHmacHex(raw, signature, getRazorpayEnv().webhookSecret)) {
      return commerceJson({ ok: false, error: { code: "INVALID_WEBHOOK_SIGNATURE", message: "Invalid signature." } }, 401, null);
    }

    const payload = JSON.parse(raw) as RazorpayWebhook;
    const eventType = payload.event ?? "unknown";
    const payment = payload.payload?.payment?.entity;
    const token = payload.payload?.token?.entity;
    const providerEventId = request.headers.get("x-razorpay-event-id")?.trim() || sha256(raw);
    const reservation = await reservePaymentWebhookEvent({
      eventId: providerEventId,
      eventType,
      providerOrderId: payment?.order_id ?? token?.order_id,
      providerPaymentId: payment?.id ?? token?.payment_id,
      signatureValid: true,
      payload: payload as Record<string, unknown>,
    });
    claimedEventId = reservation.id;
    if (reservation.claimResult === "PROCESSED") {
      return commerceJson({ ok: true, duplicate: true }, 200, null);
    }
    if (reservation.claimResult === "IN_PROGRESS") {
      return commerceJson({ ok: true, processing: true }, 202, null);
    }

    if (isPaymentEvent(eventType)) {
      if (!payment) throw new Error(`Razorpay ${eventType} event has no payment entity.`);
      const attempt = await findPaymentAttempt(payment);
      if (!attempt) throw new Error("PAYMENT_ATTEMPT_CORRELATION_PENDING");
      await reconcilePaymentAttempt({
        attempt,
        payment,
        providerEventId,
        providerEventCreatedAt: payload.created_at,
      });
      await markPaymentWebhookProcessed(reservation.id, attempt.id);
    } else if (isRazorpayTokenEvent(eventType)) {
      if (!token) throw new Error(`Razorpay ${eventType} event has no token entity.`);
      await processRazorpayTokenEvent({
        eventType,
        eventId: providerEventId,
        payloadCreatedAt: payload.created_at,
        token,
      });
      await markPaymentWebhookProcessed(reservation.id);
    } else {
      // Signed unknown events, including order.paid, are safe no-ops.
      // payment.captured remains Uppermost's financial authority.
      await markPaymentWebhookProcessed(reservation.id);
    }
    return commerceJson({ ok: true }, 200, null);
  } catch (error) {
    if (claimedEventId) await markPaymentWebhookFailed(claimedEventId, error);
    return errorResponse(error, null);
  }
}
