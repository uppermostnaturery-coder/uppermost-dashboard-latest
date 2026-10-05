import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { createCustomerMessage } from "../messages";
import { ensureShipmentForOrder } from "../fulfillment";
import type { RazorpayPayment } from "../razorpay/client";
import { activateSubscriptionIfReady } from "../subscriptions/activation";
import { addExactUtcDays, renewalScheduleForDueAt } from "../subscriptions/schedule";
import {
  bindMandateTokenFromPayment,
  embeddedRazorpayTokenEvent,
  processRazorpayTokenEvent,
  reprocessPendingTokenEvents,
  type RazorpayTokenEntity,
} from "./mandates";
import { normalizeRazorpayFailure } from "./states";
import {
  canApplyPaymentStatus,
  normalizedStateForProviderStatus,
  PaymentReconciliationMismatchError,
  validateProviderPaymentIdentity,
} from "./transitions";

export function shouldIgnoreNonFinalPaymentUpdate(
  currentState: string,
  incomingPaymentStatus: string
): boolean {
  return !canApplyPaymentStatus(currentState, incomingPaymentStatus);
}

export function embeddedRecurringTokenEvidence(payment: RazorpayPayment) {
  const embedded = payment.token;
  if (payment.token_id && embedded?.id && payment.token_id !== embedded.id) {
    throw new Error("PAYMENT_EMBEDDED_TOKEN_ID_CONFLICT");
  }
  const providerTokenId = embedded?.id ?? payment.token_id ?? null;
  const eventType = embedded ? embeddedRazorpayTokenEvent(embedded) : null;
  return { embedded, providerTokenId, eventType };
}

export async function reconcilePaymentAttempt(args: {
  attempt: any;
  payment: RazorpayPayment;
  providerEventId?: string;
  providerEventCreatedAt?: number;
}) {
  const { attempt, payment } = args;
  try {
    validateProviderPaymentIdentity({
      expectedProviderOrderId: attempt.provider_order_id,
      existingProviderPaymentId: attempt.provider_payment_id,
      expectedAmountPaise: attempt.amount_paise,
      expectedCurrency: attempt.currency ?? "INR",
      payment,
    });
  } catch (error) {
    if (error instanceof PaymentReconciliationMismatchError) {
      await supabaseAdmin.from("payment_attempts").update({
        raw_error: { code: error.code, mismatches: error.mismatches },
      }).eq("id", attempt.id);
    }
    throw error;
  }

  if (!canApplyPaymentStatus(attempt.status, payment.status) || !canApplyPaymentStatus(attempt.normalized_state, payment.status)) {
    return { state: "CONFIRMED", ignored: true };
  }
  const captured = payment.status === "captured";
  const pending = payment.status === "authorized" || payment.status === "created";
  const normalized = normalizedStateForProviderStatus(payment.status, normalizeRazorpayFailure(payment));

  let attemptUpdate = supabaseAdmin
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

  if (!captured) {
    attemptUpdate = attemptUpdate.neq("normalized_state", "CONFIRMED");
  }
  const updatedAttempt = await attemptUpdate.select("id").maybeSingle();
  if (updatedAttempt.error) {
    throw new Error(`Payment attempt update failed: ${updatedAttempt.error.message}`);
  }
  if (!captured && !updatedAttempt.data) {
    return { state: "CONFIRMED" };
  }

  const orderResult = await supabaseAdmin
    .from("orders")
    .select("id, customer_id, subscription_id, status")
    .eq("id", attempt.order_id)
    .single();
  if (orderResult.error || !orderResult.data) throw new Error("Order for payment was not found.");
  const order = orderResult.data;

  if (captured) {
    let sessionState = "CONFIRMED";
    if (attempt.kind === "RECURRING_AUTH") {
      try {
        const evidence = embeddedRecurringTokenEvidence(payment);
        if (order.subscription_id && evidence.providerTokenId && payment.order_id) {
          await bindMandateTokenFromPayment({
            subscriptionId: order.subscription_id,
            providerTokenId: evidence.providerTokenId,
            providerOrderId: payment.order_id,
            providerPaymentId: payment.id,
          });
        }
        if (evidence.eventType && evidence.embedded?.id) {
          const correlatedToken: RazorpayTokenEntity = {
            ...evidence.embedded,
            payment_id: payment.id,
            order_id: payment.order_id,
          };
          await processRazorpayTokenEvent({
            eventType: evidence.eventType,
            eventId: args.providerEventId ?? `payment-evidence:${payment.id}:${evidence.eventType}`,
            payloadCreatedAt: args.providerEventCreatedAt ?? payment.created_at,
            token: correlatedToken,
          });
        }
        if (evidence.providerTokenId) {
          await reprocessPendingTokenEvents(evidence.providerTokenId);
        }
        if (order.subscription_id) {
          const activation = await activateSubscriptionIfReady(order.subscription_id);
          sessionState = activation.state;
        }
      } catch (error) {
        const reconciliationError = await supabaseAdmin.from("payment_attempts").update({
          raw_error: {
            code: error instanceof Error ? error.message : "MANDATE_TOKEN_RECONCILIATION_FAILED",
          },
        }).eq("id", attempt.id);
        if (reconciliationError.error) {
          throw new Error(`Mandate reconciliation error persistence failed: ${reconciliationError.error.message}`);
        }
        throw error;
      }
    } else if (order.status === "CONFIRMED" && attempt.checkout_session_id) {
      const currentSession = await supabaseAdmin
        .from("checkout_sessions")
        .select("state")
        .eq("id", attempt.checkout_session_id)
        .maybeSingle();
      if (currentSession.error) {
        throw new Error(`Checkout session lookup failed: ${currentSession.error.message}`);
      }
      sessionState = currentSession.data?.state ?? sessionState;
    }

    const orderUpdate = await supabaseAdmin.from("orders").update({
      status: "CONFIRMED",
      paid_at: new Date().toISOString(),
    }).eq("id", order.id).neq("status", "CONFIRMED");
    if (orderUpdate.error) {
      throw new Error(`Order confirmation failed: ${orderUpdate.error.message}`);
    }

    if (attempt.checkout_session_id) {
      const sessionUpdate = await supabaseAdmin
        .from("checkout_sessions")
        .update({ state: sessionState })
        .eq("id", attempt.checkout_session_id);
      if (sessionUpdate.error) {
        throw new Error(`Checkout confirmation failed: ${sessionUpdate.error.message}`);
      }
    }
    if (attempt.subscription_cycle_id) {
      const cycleResult = await supabaseAdmin.from("subscription_cycles")
        .select("subscription_id, cycle_number, due_at")
        .eq("id", attempt.subscription_cycle_id)
        .single();
      const cycleUpdate = await supabaseAdmin.from("subscription_cycles").update({
        status: "PAID",
        provider_payment_id: payment.id,
      }).eq("id", attempt.subscription_cycle_id);
      if (cycleUpdate.error) {
        throw new Error(`Subscription cycle confirmation failed: ${cycleUpdate.error.message}`);
      }
      if (cycleResult.data) {
        const subResult = await supabaseAdmin.from("subscriptions")
          .select("interval_days")
          .eq("id", cycleResult.data.subscription_id)
          .single();
        if (subResult.data) {
          const nextDue = addExactUtcDays(cycleResult.data.due_at, subResult.data.interval_days);
          const nextSchedule = renewalScheduleForDueAt(nextDue);
          const advancementResults = await Promise.all([
            supabaseAdmin.from("subscriptions").update({
              current_cycle_number: cycleResult.data.cycle_number,
              next_charge_at: nextDue,
            }).eq("id", cycleResult.data.subscription_id),
            supabaseAdmin.from("subscription_cycles").upsert({
              subscription_id: cycleResult.data.subscription_id,
              cycle_number: cycleResult.data.cycle_number + 1,
              due_at: nextDue,
              notification_due_at: nextSchedule.notificationDueAt,
              scheduled_charge_at: nextSchedule.scheduledChargeAt,
              status: "DUE",
            }, { onConflict: "subscription_id,cycle_number", ignoreDuplicates: true }),
          ]);
          const advancementError = advancementResults.find((result) => result.error)?.error;
          if (advancementError) {
            throw new Error(`Subscription cycle advancement failed: ${advancementError.message}`);
          }
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
    const sessionUpdate = await supabaseAdmin
      .from("checkout_sessions")
      .update({ state: normalized })
      .eq("id", attempt.checkout_session_id)
      .neq("state", "CONFIRMED");
    if (sessionUpdate.error) {
      throw new Error(`Checkout payment-state update failed: ${sessionUpdate.error.message}`);
    }
  }
  if (attempt.subscription_cycle_id && pending) {
    const cyclePending = await supabaseAdmin.from("subscription_cycles").update({
      status: "PAYMENT_PENDING",
      provider_payment_id: payment.id,
    }).eq("id", attempt.subscription_cycle_id).neq("status", "PAID");
    if (cyclePending.error) {
      throw new Error(`Subscription cycle pending-state update failed: ${cyclePending.error.message}`);
    }
  }
  if (attempt.subscription_cycle_id && !pending) {
    const retryable = normalized === "FAILED_RETRYABLE" || normalized === "INSUFFICIENT_FUNDS";
    const currentCycle = await supabaseAdmin.from("subscription_cycles")
      .select("retry_count")
      .eq("id", attempt.subscription_cycle_id)
      .single();
    if (currentCycle.error || !currentCycle.data) {
      throw new Error(`Subscription cycle retry lookup failed: ${currentCycle.error?.message}`);
    }
    const retryCount = Number(currentCycle.data.retry_count ?? 0) + 1;
    const nextRetryAt = retryable && retryCount < 3
      ? new Date(Date.now() + Math.pow(2, retryCount - 1) * 24 * 60 * 60 * 1000).toISOString()
      : null;
    const cycleUpdate = await supabaseAdmin.from("subscription_cycles").update({
      status: retryable && retryCount < 3 ? "FAILED" : "REAUTH_REQUIRED",
      retry_count: retryCount,
      next_retry_at: nextRetryAt,
      last_error: { normalized_state: normalized },
    }).eq("id", attempt.subscription_cycle_id).neq("status", "PAID");
    if (cycleUpdate.error) {
      throw new Error(`Subscription cycle failure update failed: ${cycleUpdate.error.message}`);
    }
    if (order.subscription_id && normalized.startsWith("MANDATE_")) {
      const subscriptionStatus = normalized === "MANDATE_PAUSED"
        ? "PAUSED"
        : normalized === "MANDATE_CANCELLED"
          ? "CANCELLED"
          : "REAUTH_REQUIRED";
      const mandateStatus = normalized === "MANDATE_ACTION_REQUIRED"
        ? "REAUTH_REQUIRED"
        : normalized.replace("MANDATE_", "");
      await Promise.all([
        supabaseAdmin.from("subscriptions").update({ status: subscriptionStatus }).eq("id", order.subscription_id),
        supabaseAdmin.from("recurring_mandates").update({ status: mandateStatus }).eq("subscription_id", order.subscription_id),
      ]);
      const messageKey = normalized === "MANDATE_PAUSED"
        ? "MANDATE_PAUSED"
        : normalized === "MANDATE_CANCELLED"
          ? "MANDATE_CANCELLED"
          : normalized === "MANDATE_REJECTED"
            ? "MANDATE_REJECTED"
            : "MANDATE_REAUTH_REQUIRED";
      await createCustomerMessage({
        customerId: order.customer_id,
        key: messageKey,
        subscriptionId: order.subscription_id,
      });
    }
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
