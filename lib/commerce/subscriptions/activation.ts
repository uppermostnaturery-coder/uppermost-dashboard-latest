import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { addExactUtcDays, renewalScheduleForDueAt } from "./schedule";

export function recurringActivationState(paymentCaptured: boolean, mandateActive: boolean) {
  return paymentCaptured && mandateActive ? "CONFIRMED" as const : "ACTIVATION_PENDING" as const;
}

export async function activateSubscriptionIfReady(subscriptionId: string) {
  const [subscriptionResult, mandateResult] = await Promise.all([
    supabaseAdmin.from("subscriptions")
      .select("id, checkout_session_id, initial_order_id, interval_days, current_cycle_number, status, started_at")
      .eq("id", subscriptionId)
      .single(),
    supabaseAdmin.from("recurring_mandates")
      .select("status, provider_token_id")
      .eq("subscription_id", subscriptionId)
      .single(),
  ]);
  if (subscriptionResult.error || !subscriptionResult.data) {
    throw new Error("Subscription activation lookup failed.");
  }
  if (mandateResult.error || !mandateResult.data) {
    throw new Error("Mandate activation lookup failed.");
  }

  const subscription = subscriptionResult.data;
  const paymentResult = await supabaseAdmin.from("payment_attempts")
    .select("status, normalized_state")
    .eq("order_id", subscription.initial_order_id)
    .eq("kind", "RECURRING_AUTH")
    .or("status.eq.CAPTURED,normalized_state.eq.CONFIRMED")
    .maybeSingle();
  if (paymentResult.error) throw new Error(`Activation payment lookup failed: ${paymentResult.error.message}`);

  const paymentCaptured = paymentResult.data?.status === "CAPTURED" || paymentResult.data?.normalized_state === "CONFIRMED";
  const mandateActive = mandateResult.data.status === "ACTIVE" && Boolean(mandateResult.data.provider_token_id);
  const activationState = recurringActivationState(paymentCaptured, mandateActive);
  if (activationState !== "CONFIRMED") {
    await supabaseAdmin.from("checkout_sessions")
      .update({ state: "ACTIVATION_PENDING" })
      .eq("id", subscription.checkout_session_id)
      .neq("state", "CONFIRMED");
    return { activated: false as const, state: activationState };
  }

  const startedAt = subscription.started_at ?? new Date().toISOString();
  const nextChargeAt = addExactUtcDays(startedAt, subscription.interval_days);
  const schedule = renewalScheduleForDueAt(nextChargeAt);
  const cycleNumber = Math.max(2, subscription.current_cycle_number + 1);
  const results = await Promise.all([
    supabaseAdmin.from("subscriptions").update({
      status: "ACTIVE",
      started_at: startedAt,
      next_charge_at: nextChargeAt,
    }).eq("id", subscriptionId).in("status", ["PENDING_AUTH", "ACTIVE"]),
    supabaseAdmin.from("checkout_sessions").update({ state: "CONFIRMED" })
      .eq("id", subscription.checkout_session_id),
    supabaseAdmin.from("subscription_cycles").upsert({
      subscription_id: subscriptionId,
      cycle_number: cycleNumber,
      due_at: nextChargeAt,
      notification_due_at: schedule.notificationDueAt,
      scheduled_charge_at: schedule.scheduledChargeAt,
      status: "DUE",
    }, { onConflict: "subscription_id,cycle_number", ignoreDuplicates: true }),
  ]);
  const error = results.find((result) => result.error)?.error;
  if (error) throw new Error(`Subscription activation failed: ${error.message}`);
  return { activated: true as const, state: "CONFIRMED" as const, nextChargeAt };
}
