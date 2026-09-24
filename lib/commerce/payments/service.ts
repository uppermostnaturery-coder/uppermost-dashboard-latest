import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { createCustomerMessage } from "../messages";
import { ensureShipmentForOrder } from "../fulfillment";
import type { RazorpayPayment } from "../razorpay/client";
import { normalizeRazorpayFailure } from "./states";

export async function reconcilePaymentAttempt(args: {
  attempt: any;
  payment: RazorpayPayment;
}) {
  const { attempt, payment } = args;
  const captured = payment.status === "captured";
  const pending = payment.status === "authorized" || payment.status === "created";
  const normalized = captured
    ? "CONFIRMED"
    : pending
      ? "PENDING"
      : normalizeRazorpayFailure(payment);

  await supabaseAdmin
    .from("payment_attempts")
    .update({
      status: payment.status.toUpperCase(),
      provider_payment_id: payment.id,
      normalized_state: normalized,
      raw_error: captured || pending ? null : {
        code: payment.error_code ?? null,
        description: payment.error_description ?? null,
        source: payment.error_source ?? null,
        step: payment.error_step ?? null,
        reason: payment.error_reason ?? null,
      },
      raw_metadata: payment,
    })
    .eq("id", attempt.id);

  const orderResult = await supabaseAdmin
    .from("orders")
    .select("id, customer_id, subscription_id")
    .eq("id", attempt.order_id)
    .single();
  if (orderResult.error || !orderResult.data) throw new Error("Order for payment was not found.");
  const order = orderResult.data;

  if (captured) {
    let sessionState = "CONFIRMED";
    if (attempt.kind === "RECURRING_AUTH") {
      const mandateResult = order.subscription_id
        ? await supabaseAdmin.from("recurring_mandates")
            .select("provider_token_id, status")
            .eq("subscription_id", order.subscription_id)
            .maybeSingle()
        : { data: null };
      const tokenId = payment.token_id ?? mandateResult.data?.provider_token_id ?? null;
      const tokenUsable = Boolean(tokenId) && (
        Boolean(payment.token_id) || mandateResult.data?.status === "ACTIVE"
      );
      if (tokenUsable && order.subscription_id) {
        const now = new Date();
        const subscriptionResult = await supabaseAdmin
          .from("subscriptions")
          .select("interval_days, current_cycle_number")
          .eq("id", order.subscription_id)
          .single();
        if (subscriptionResult.error || !subscriptionResult.data) {
          throw new Error("Subscription for payment was not found.");
        }
        const nextChargeAt = new Date(
          now.getTime() + subscriptionResult.data.interval_days * 86_400_000
        ).toISOString();
        await Promise.all([
          supabaseAdmin.from("recurring_mandates").update({
            provider_token_id: tokenId,
            status: "ACTIVE",
            authorised_at: now.toISOString(),
            raw_metadata: payment,
          }).eq("subscription_id", order.subscription_id),
          supabaseAdmin.from("subscriptions").update({
            status: "ACTIVE",
            started_at: now.toISOString(),
            next_charge_at: nextChargeAt,
          }).eq("id", order.subscription_id),
          supabaseAdmin.from("subscription_cycles").upsert({
            subscription_id: order.subscription_id,
            cycle_number: 2,
            due_at: nextChargeAt,
            status: "DUE",
          }, { onConflict: "subscription_id,cycle_number", ignoreDuplicates: true }),
        ]);
      } else {
        sessionState = "ACTIVATION_PENDING";
      }
    }

    await supabaseAdmin.from("orders").update({
      status: "CONFIRMED",
      paid_at: new Date().toISOString(),
    }).eq("id", order.id);

    if (attempt.checkout_session_id) {
      await supabaseAdmin.from("checkout_sessions").update({ state: sessionState }).eq("id", attempt.checkout_session_id);
    }
    if (attempt.subscription_cycle_id) {
      const cycleResult = await supabaseAdmin.from("subscription_cycles")
        .select("subscription_id, cycle_number")
        .eq("id", attempt.subscription_cycle_id)
        .single();
      await supabaseAdmin.from("subscription_cycles").update({
        status: "PAID",
        provider_payment_id: payment.id,
      }).eq("id", attempt.subscription_cycle_id);
      if (cycleResult.data) {
        const subResult = await supabaseAdmin.from("subscriptions")
          .select("interval_days")
          .eq("id", cycleResult.data.subscription_id)
          .single();
        if (subResult.data) {
          const nextDue = new Date(Date.now() + subResult.data.interval_days * 86_400_000).toISOString();
          await Promise.all([
            supabaseAdmin.from("subscriptions").update({
              current_cycle_number: cycleResult.data.cycle_number,
              next_charge_at: nextDue,
            }).eq("id", cycleResult.data.subscription_id),
            supabaseAdmin.from("subscription_cycles").upsert({
              subscription_id: cycleResult.data.subscription_id,
              cycle_number: cycleResult.data.cycle_number + 1,
              due_at: nextDue,
              status: "DUE",
            }, { onConflict: "subscription_id,cycle_number", ignoreDuplicates: true }),
          ]);
        }
      }
    }

    await createCustomerMessage({
      customerId: order.customer_id,
      key: attempt.kind === "RECURRING_DEBIT" ? "RENEWAL_SUCCESS" : "PAYMENT_CONFIRMED",
      orderId: order.id,
      subscriptionId: order.subscription_id ?? undefined,
      paymentAttemptId: attempt.id,
    });
    await ensureShipmentForOrder(order.id);
    return { state: sessionState };
  }

  if (attempt.checkout_session_id) {
    await supabaseAdmin.from("checkout_sessions").update({ state: normalized }).eq("id", attempt.checkout_session_id);
  }
  if (attempt.subscription_cycle_id && !pending) {
    await supabaseAdmin.from("subscription_cycles").update({
      status: "FAILED",
      last_error: { normalized_state: normalized },
    }).eq("id", attempt.subscription_cycle_id);
  }
  if (!pending) {
    await createCustomerMessage({
      customerId: order.customer_id,
      key: attempt.kind === "RECURRING_DEBIT" ? "RENEWAL_FAILED" : "PAYMENT_FAILED",
      orderId: order.id,
      subscriptionId: order.subscription_id ?? undefined,
      paymentAttemptId: attempt.id,
    });
  }
  return { state: normalized };
}
