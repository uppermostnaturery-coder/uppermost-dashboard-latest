import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requestHash, verifyHmacHex } from "@/lib/commerce/crypto";
import { getRazorpayEnv } from "@/lib/commerce/env";
import { commerceJson, errorResponse } from "@/lib/commerce/http";
import { reconcilePaymentAttempt } from "@/lib/commerce/payments/service";
import type { RazorpayPayment } from "@/lib/commerce/razorpay/client";
import { reservePaymentWebhookEvent } from "@/lib/commerce/webhooks";

export const runtime = "nodejs";

type RazorpayWebhook = {
  event?: string;
  payload?: {
    payment?: { entity?: RazorpayPayment };
    token?: { entity?: { id?: string; status?: string; customer_id?: string } };
  };
};

export async function POST(request: Request) {
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
    const eventId = request.headers.get("x-razorpay-event-id") ?? requestHash(raw);
    const reservation = await reservePaymentWebhookEvent({
      eventId,
      eventType,
      providerOrderId: payment?.order_id,
      providerPaymentId: payment?.id,
      signatureValid: true,
      payload: payload as Record<string, unknown>,
    });
    if (reservation.duplicate) return commerceJson({ ok: true, duplicate: true }, 200, null);

    let attempt: any = null;
    if (payment?.order_id) {
      const result = await supabaseAdmin.from("payment_attempts")
        .select("*")
        .eq("provider_order_id", payment.order_id)
        .maybeSingle();
      attempt = result.data;
    } else if (payment?.id) {
      const result = await supabaseAdmin.from("payment_attempts")
        .select("*")
        .eq("provider_payment_id", payment.id)
        .maybeSingle();
      attempt = result.data;
    }

    if (attempt && payment && ["payment.authorized", "payment.captured", "payment.failed"].includes(eventType)) {
      await reconcilePaymentAttempt({ attempt, payment });
      await supabaseAdmin.from("payment_events").update({
        payment_attempt_id: attempt.id,
        processed_at: new Date().toISOString(),
      }).eq("id", reservation.id!);
    } else if (token?.id) {
      const status = token.status?.toLowerCase();
      const normalized = status === "confirmed" || status === "active"
        ? "ACTIVE"
        : status === "paused"
          ? "PAUSED"
          : status === "cancelled"
            ? "CANCELLED"
            : status === "expired"
              ? "EXPIRED"
              : "PENDING";
      let mandateQuery = supabaseAdmin.from("recurring_mandates")
        .select("id, subscription_id")
        .eq("provider_token_id", token.id)
        .maybeSingle();
      let mandate = (await mandateQuery).data;
      if (!mandate && token.customer_id) {
        const pending = await supabaseAdmin.from("recurring_mandates")
          .select("id, subscription_id")
          .eq("provider_customer_id", token.customer_id)
          .eq("status", "PENDING")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        mandate = pending.data;
      }
      if (mandate) {
        await supabaseAdmin.from("recurring_mandates").update({
          provider_token_id: token.id,
          status: normalized,
          ...(normalized === "ACTIVE" ? { authorised_at: new Date().toISOString() } : {}),
          raw_metadata: token,
        }).eq("id", mandate.id);
        if (normalized === "ACTIVE") {
          const subscription = await supabaseAdmin.from("subscriptions")
            .select("initial_order_id, checkout_session_id, interval_days, current_cycle_number")
            .eq("id", mandate.subscription_id)
            .single();
          const paymentAttempt = subscription.data
            ? await supabaseAdmin.from("payment_attempts")
                .select("status")
                .eq("order_id", subscription.data.initial_order_id)
                .eq("kind", "RECURRING_AUTH")
                .maybeSingle()
            : { data: null };
          if (subscription.data && paymentAttempt.data?.status === "CAPTURED") {
            const nextChargeAt = new Date(Date.now() + subscription.data.interval_days * 86_400_000).toISOString();
            await Promise.all([
              supabaseAdmin.from("subscriptions").update({
                status: "ACTIVE",
                started_at: new Date().toISOString(),
                next_charge_at: nextChargeAt,
              }).eq("id", mandate.subscription_id),
              supabaseAdmin.from("checkout_sessions").update({
                state: "CONFIRMED",
              }).eq("id", subscription.data.checkout_session_id),
              supabaseAdmin.from("subscription_cycles").upsert({
                subscription_id: mandate.subscription_id,
                cycle_number: Math.max(2, subscription.data.current_cycle_number + 1),
                due_at: nextChargeAt,
                status: "DUE",
              }, { onConflict: "subscription_id,cycle_number", ignoreDuplicates: true }),
            ]);
          }
        }
      }
      await supabaseAdmin.from("payment_events").update({ processed_at: new Date().toISOString() }).eq("id", reservation.id!);
    } else {
      await supabaseAdmin.from("payment_events").update({ processed_at: new Date().toISOString() }).eq("id", reservation.id!);
    }
    return commerceJson({ ok: true }, 200, null);
  } catch (error) {
    return errorResponse(error, null);
  }
}
