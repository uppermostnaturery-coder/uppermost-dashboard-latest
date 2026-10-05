import { randomUUID } from "crypto";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { loadCatalogVariants, assertInventory } from "./catalog";
import { createCustomerMessage } from "./messages";
import { reconcilePaymentAttempt } from "./payments/service";
import { resolveRazorpayPaymentAttempt } from "./payments/correlation";
import { normalizeRazorpayFailure } from "./payments/states";
import { calculateCartQuote } from "./pricing/calculateCartQuote";
import { loadActivePromotions, loadPromotionEntitlements, promotionVersion } from "./promotions";
import {
  createRazorpayOrder,
  createRazorpayRecurringPayment,
  fetchRazorpayOrderPayments,
  razorpayCycleLastError,
  RazorpayApiError,
} from "./razorpay/client";
import { selectDueCycleItems } from "./subscriptions/schedule";
import type { CartLineInput } from "./types";
import {
  establishRenewalOrder,
  establishRenewalPaymentAttempt,
  canCreateRenewalProviderOrder,
  resolveRenewalPricing,
  type ExistingRenewalOrder,
} from "./renewal-order";

export type ClaimedCycle = {
  id: string;
  subscription_id: string;
  cycle_number: number;
  due_at: string;
  retry_count?: number;
};

const MAX_RENEWAL_RETRIES = 3;

export function isAboveMandateCap(amountPaise: number, maxAmountPaise: number): boolean {
  return amountPaise > maxAmountPaise;
}

export function retryDelayMs(retryCount: number): number {
  return Math.pow(2, Math.max(0, retryCount - 1)) * 24 * 60 * 60 * 1000;
}

async function claimCycles(rpc: "claim_notification_due_subscription_cycles" | "claim_due_subscription_cycles", limit: number) {
  const result = await supabaseAdmin.rpc(rpc, {
    p_worker_id: `renewal-${randomUUID()}`,
    p_limit: limit,
  });
  if (result.error) throw new Error(`Renewal claim failed: ${result.error.message}`);
  return (result.data ?? []) as ClaimedCycle[];
}

async function requireRenewalContext(cycle: ClaimedCycle) {
  const subscriptionResult = await supabaseAdmin.from("subscriptions")
    .select("id, customer_id, interval_days, started_at, status, initial_order_id")
    .eq("id", cycle.subscription_id).single();
  if (subscriptionResult.error || !subscriptionResult.data || subscriptionResult.data.status !== "ACTIVE") {
    await supabaseAdmin.from("subscription_cycles").update({ status: "CANCELLED" }).eq("id", cycle.id);
    return null;
  }
  const subscription = subscriptionResult.data;
  const [itemsResult, mandateResult, customerResult, initialOrderResult] = await Promise.all([
    supabaseAdmin.from("subscription_items").select("id, sku, quantity")
      .eq("subscription_id", subscription.id).eq("status", "ACTIVE"),
    supabaseAdmin.from("recurring_mandates").select("*").eq("subscription_id", subscription.id).single(),
    supabaseAdmin.from("customers").select("id, name, email, phone").eq("id", subscription.customer_id).single(),
    supabaseAdmin.from("orders").select("address_snapshot").eq("id", subscription.initial_order_id).single(),
  ]);
  if (itemsResult.error || !itemsResult.data?.length || mandateResult.error || !mandateResult.data || !customerResult.data || !initialOrderResult.data) {
    throw new Error("Renewal dependencies are incomplete.");
  }
  return {
    subscription,
    items: selectDueCycleItems(itemsResult.data),
    mandate: mandateResult.data,
    customer: customerResult.data,
    address: initialOrderResult.data.address_snapshot,
  };
}

async function requireActiveMandate(context: NonNullable<Awaited<ReturnType<typeof requireRenewalContext>>>, cycleId: string) {
  if (context.mandate.status === "ACTIVE" && context.mandate.provider_token_id) return true;
  await Promise.all([
    supabaseAdmin.from("subscription_cycles").update({ status: "REAUTH_REQUIRED" }).eq("id", cycleId),
    supabaseAdmin.from("subscriptions").update({ status: "REAUTH_REQUIRED" }).eq("id", context.subscription.id),
  ]);
  await createCustomerMessage({
    customerId: context.subscription.customer_id,
    key: context.mandate.status === "PAUSED" ? "MANDATE_PAUSED" : "MANDATE_REAUTH_REQUIRED",
    subscriptionId: context.subscription.id,
  });
  return false;
}

async function priceCycle(cycle: ClaimedCycle, context: NonNullable<Awaited<ReturnType<typeof requireRenewalContext>>>) {
  const requestItems: CartLineInput[] = context.items.map((item) => ({
    line_id: `renewal-${item.id}`,
    sku: item.sku,
    qty: item.quantity,
    purchase_mode: "SUBSCRIPTION",
    interval_days: context.subscription.interval_days,
  }));
  const now = new Date().toISOString();
  const catalog = await loadCatalogVariants(requestItems.map((item) => item.sku));
  assertInventory(requestItems, catalog);
  const [promotions, entitlements] = await Promise.all([
    loadActivePromotions(now),
    loadPromotionEntitlements({
      customerId: context.subscription.customer_id,
      subscriptionId: context.subscription.id,
      now,
    }),
  ]);
  const quote = calculateCartQuote({
    items: requestItems,
    catalog,
    promotions,
    entitlements,
    context: {
      stage: "RENEWAL",
      customer_id: context.subscription.customer_id,
      subscription_id: context.subscription.id,
      subscription_started_at: context.subscription.started_at ?? undefined,
      cycle_number: cycle.cycle_number,
      now,
      is_new_subscriber: false,
      is_first_order: false,
      is_returning_customer: true,
      shipping_country: "IN",
    },
  });
  return {
    quote,
    snapshot: {
      quote,
      exact_cycle_items: quote.items,
      promotion_version: promotionVersion(promotions),
      stage: "RENEWAL" as const,
      price_locked_at: now,
    },
    now,
  };
}

async function moveAboveCapToReauth(cycle: ClaimedCycle, context: NonNullable<Awaited<ReturnType<typeof requireRenewalContext>>>, pricing: Awaited<ReturnType<typeof priceCycle>>) {
  await Promise.all([
    supabaseAdmin.from("subscription_cycles").update({
      status: "REAUTH_REQUIRED",
      pricing_snapshot: pricing.snapshot,
      item_snapshot: pricing.quote.items,
      amount_paise: pricing.quote.total_paise,
      price_locked_at: pricing.now,
      last_error: { normalized_state: "CAP_EXCEEDED" },
    }).eq("id", cycle.id),
    supabaseAdmin.from("subscriptions").update({ status: "REAUTH_REQUIRED" }).eq("id", context.subscription.id),
    supabaseAdmin.from("recurring_mandates").update({ status: "REAUTH_REQUIRED" }).eq("id", context.mandate.id),
  ]);
  await createCustomerMessage({ customerId: context.subscription.customer_id, key: "MANDATE_REAUTH_REQUIRED", subscriptionId: context.subscription.id });
}

export async function processNotificationDueCycle(cycle: ClaimedCycle) {
  const context = await requireRenewalContext(cycle);
  if (!context) return { cycle_id: cycle.id, state: "CANCELLED" };
  if (!(await requireActiveMandate(context, cycle.id))) return { cycle_id: cycle.id, state: "REAUTH_REQUIRED" };

  const [cycleResult, orderResult] = await Promise.all([
    supabaseAdmin.from("subscription_cycles")
      .select("order_id, provider_order_id, pricing_snapshot, item_snapshot, amount_paise, price_locked_at, last_error")
      .eq("id", cycle.id).single(),
    supabaseAdmin.from("orders")
      .select("id, order_number, customer_id, subscription_id, subscription_cycle_id, order_kind, currency, subtotal_paise, discount_paise, shipping_paise, tax_paise, total_paise, address_snapshot, pricing_snapshot")
      .eq("subscription_cycle_id", cycle.id).maybeSingle(),
  ]);
  if (cycleResult.error || !cycleResult.data) {
    throw new Error(`Renewal cycle lookup failed: ${cycleResult.error?.message ?? "not found"}`);
  }
  if (orderResult.error) throw new Error(`Renewal order recovery failed: ${orderResult.error.message}`);

  const identity = {
    cycleId: cycle.id,
    subscriptionId: context.subscription.id,
    customerId: context.subscription.customer_id,
    addressSnapshot: context.address,
  };
  const pricing = await resolveRenewalPricing(
    orderResult.data as ExistingRenewalOrder | null,
    identity,
    () => priceCycle(cycle, context)
  );
  if (isAboveMandateCap(pricing.quote.total_paise, context.mandate.max_amount_paise)) {
    await moveAboveCapToReauth(cycle, context, pricing);
    return { cycle_id: cycle.id, state: "REAUTH_REQUIRED" };
  }

  const order = await establishRenewalOrder({ identity, pricing });

  if (cycleResult.data.provider_order_id) {
    const attempt = await establishRenewalPaymentAttempt({
      cycleId: cycle.id,
      orderId: order.id,
      providerOrderId: cycleResult.data.provider_order_id,
      amountPaise: pricing.quote.total_paise,
      notifiedAt: new Date().toISOString(),
      scheduledChargeAt: cycle.due_at,
    });
    await createCustomerMessage({
      customerId: context.subscription.customer_id,
      key: "RENEWAL_UPCOMING",
      subscriptionId: context.subscription.id,
      orderId: order.id,
      paymentAttemptId: attempt.id,
      metadata: { cycle_id: cycle.id, scheduled_charge_at: cycle.due_at },
    });
    return { cycle_id: cycle.id, state: "NOTIFIED", duplicate: true };
  }
  if (!canCreateRenewalProviderOrder(order.created, cycleResult.data.last_error)) {
    await supabaseAdmin.from("subscription_cycles").update({
      status: "RECONCILIATION_PENDING",
    }).eq("id", cycle.id);
    return { cycle_id: cycle.id, state: "RECONCILIATION_PENDING" };
  }

  let remoteOrder;
  try {
    remoteOrder = await createRazorpayOrder({
      amount: pricing.quote.total_paise,
      currency: "INR",
      receipt: `rnl-${cycle.id.replace(/-/g, "")}`,
      notes: {
        uppermost_order_id: order.id,
        subscription_id: context.subscription.id,
        subscription_cycle_id: cycle.id,
        purchase_shape: "SUBSCRIPTION",
      },
      notification: {
        token_id: context.mandate.provider_token_id,
        payment_after: Math.floor(new Date(cycle.due_at).getTime() / 1000),
      },
    });
  } catch (error) {
    const state = error instanceof RazorpayApiError && error.status < 500
      ? "REAUTH_REQUIRED"
      : "RECONCILIATION_PENDING";
    await supabaseAdmin.from("subscription_cycles").update({
      status: state,
      last_error: razorpayCycleLastError("PROVIDER_ORDER", error),
    }).eq("id", cycle.id);
    if (state === "REAUTH_REQUIRED") {
      await createCustomerMessage({
        customerId: context.subscription.customer_id,
        key: "RENEWAL_FAILED",
        subscriptionId: context.subscription.id,
        orderId: order.id,
        metadata: { cycle_id: cycle.id, stage: "PROVIDER_ORDER" },
      });
    }
    return { cycle_id: cycle.id, state };
  }

  const notifiedAt = new Date().toISOString();
  const attempt = await establishRenewalPaymentAttempt({
    cycleId: cycle.id,
    orderId: order.id,
    providerOrderId: remoteOrder.id,
    amountPaise: pricing.quote.total_paise,
    notifiedAt,
    scheduledChargeAt: cycle.due_at,
  });
  await createCustomerMessage({
    customerId: context.subscription.customer_id,
    key: "RENEWAL_UPCOMING",
    subscriptionId: context.subscription.id,
    orderId: order.id,
    paymentAttemptId: attempt.id,
    metadata: { cycle_id: cycle.id, scheduled_charge_at: cycle.due_at },
  });
  return { cycle_id: cycle.id, state: "NOTIFIED" };
}

export async function processRenewalCycle(cycle: ClaimedCycle) {
  const context = await requireRenewalContext(cycle);
  if (!context) return { cycle_id: cycle.id, state: "CANCELLED" };
  if (!(await requireActiveMandate(context, cycle.id))) return { cycle_id: cycle.id, state: "REAUTH_REQUIRED" };
  const cycleResult = await supabaseAdmin.from("subscription_cycles")
    .select("order_id, provider_order_id, amount_paise, retry_count, price_locked_at")
    .eq("id", cycle.id).single();
  if (cycleResult.error || !cycleResult.data?.order_id || !cycleResult.data.provider_order_id || cycleResult.data.amount_paise == null || !cycleResult.data.price_locked_at) {
    throw new Error("Renewal cycle is not price-locked and notification-ready.");
  }
  if (isAboveMandateCap(cycleResult.data.amount_paise, context.mandate.max_amount_paise)) {
    await Promise.all([
      supabaseAdmin.from("subscription_cycles").update({ status: "REAUTH_REQUIRED" }).eq("id", cycle.id),
      supabaseAdmin.from("subscriptions").update({ status: "REAUTH_REQUIRED" }).eq("id", context.subscription.id),
    ]);
    return { cycle_id: cycle.id, state: "REAUTH_REQUIRED" };
  }
  const attemptResult = await supabaseAdmin.from("payment_attempts").select("*")
    .eq("subscription_cycle_id", cycle.id)
    .order("created_at", { ascending: true }).limit(1).single();
  if (attemptResult.error || !attemptResult.data) throw new Error("Renewal payment attempt is missing.");

  if (Number(cycleResult.data.retry_count) > 0) {
    try {
      const existing = await fetchRazorpayOrderPayments(cycleResult.data.provider_order_id);
      const captured = existing.items.find((payment) => payment.status === "captured");
      if (captured) {
        const attempt = await resolveRazorpayPaymentAttempt({ payment: captured, subscriptionCycleId: cycle.id });
        await reconcilePaymentAttempt({ attempt, payment: captured });
        return { cycle_id: cycle.id, state: "CONFIRMED", reconciled: true };
      }
    } catch (error) {
      await supabaseAdmin.from("subscription_cycles").update({
        status: "RECONCILIATION_PENDING",
        last_error: razorpayCycleLastError("PRE_RETRY_RECONCILIATION", error),
      }).eq("id", cycle.id);
      return { cycle_id: cycle.id, state: "RECONCILIATION_PENDING" };
    }
  }

  try {
    const payment = await createRazorpayRecurringPayment({
      email: context.customer.email,
      contact: context.customer.phone,
      amount: cycleResult.data.amount_paise,
      currency: "INR",
      order_id: cycleResult.data.provider_order_id,
      customer_id: context.mandate.provider_customer_id,
      token: context.mandate.provider_token_id,
      description: `Uppermost subscription renewal cycle ${cycle.cycle_number}`,
    });
    const attempt = await resolveRazorpayPaymentAttempt({ payment, subscriptionCycleId: cycle.id });
    await reconcilePaymentAttempt({ attempt, payment });
    return { cycle_id: cycle.id, state: payment.status === "captured" ? "CONFIRMED" : "PAYMENT_PENDING" };
  } catch (error) {
    if (!(error instanceof RazorpayApiError) || error.status >= 500) {
      await supabaseAdmin.from("subscription_cycles").update({
        status: "RECONCILIATION_PENDING",
        last_error: razorpayCycleLastError("RECURRING_DEBIT", error),
      }).eq("id", cycle.id);
      return { cycle_id: cycle.id, state: "RECONCILIATION_PENDING" };
    }
    const normalized = normalizeRazorpayFailure(error.payload as Record<string, unknown>);
    const retryCount = Number(cycleResult.data.retry_count) + 1;
    const retryable = ["INSUFFICIENT_FUNDS", "FAILED_RETRYABLE"].includes(normalized) && retryCount < MAX_RENEWAL_RETRIES;
    await supabaseAdmin.from("subscription_cycles").update({
      status: retryable ? "FAILED" : "REAUTH_REQUIRED",
      retry_count: retryCount,
      next_retry_at: retryable ? new Date(Date.now() + retryDelayMs(retryCount)).toISOString() : null,
      last_error: { ...razorpayCycleLastError("RECURRING_DEBIT", error), normalized_state: normalized },
    }).eq("id", cycle.id);
    await createCustomerMessage({
      customerId: context.subscription.customer_id,
      key: "RENEWAL_FAILED",
      subscriptionId: context.subscription.id,
      orderId: cycleResult.data.order_id,
      paymentAttemptId: attemptResult.data.id,
      metadata: { cycle_id: cycle.id, normalized_state: normalized, retry_count: retryCount },
    });
    return { cycle_id: cycle.id, state: retryable ? "FAILED_RETRYABLE" : "REAUTH_REQUIRED" };
  }
}

async function safelyProcess(cycle: ClaimedCycle, process: (cycle: ClaimedCycle) => Promise<Record<string, unknown>>) {
  try {
    return await process(cycle);
  } catch (error) {
    console.error("Renewal stage failed", { cycleId: cycle.id, cycleNumber: cycle.cycle_number });
    const current = await supabaseAdmin.from("subscription_cycles").select("status")
      .eq("id", cycle.id).maybeSingle();
    if (current.data?.status === "NOTIFICATION_PROCESSING" || current.data?.status === "PROCESSING") {
      await supabaseAdmin.from("subscription_cycles").update({
        status: "RECONCILIATION_PENDING",
        last_error: { message: error instanceof Error ? error.message : "Unknown renewal error" },
      }).eq("id", cycle.id);
    }
    return { cycle_id: cycle.id, state: "SYSTEM_ERROR" };
  }
}

export async function reconcilePendingRenewals(limit = 20) {
  const pending = await supabaseAdmin.from("subscription_cycles")
    .select("id, provider_order_id")
    .in("status", ["RECONCILIATION_PENDING", "PAYMENT_PENDING"])
    .not("provider_order_id", "is", null)
    .order("updated_at", { ascending: true })
    .limit(limit);
  if (pending.error) throw new Error(`Renewal reconciliation lookup failed: ${pending.error.message}`);
  const results: Array<Record<string, unknown>> = [];
  for (const cycle of pending.data ?? []) {
    try {
      const providerPayments = await fetchRazorpayOrderPayments(cycle.provider_order_id);
      const captured = providerPayments.items.find((payment) => payment.status === "captured");
      if (captured) {
        const attempt = await resolveRazorpayPaymentAttempt({ payment: captured, subscriptionCycleId: cycle.id });
        await reconcilePaymentAttempt({ attempt, payment: captured });
        results.push({ cycle_id: cycle.id, state: "CONFIRMED" });
      } else {
        results.push({ cycle_id: cycle.id, state: "RECONCILIATION_PENDING" });
      }
    } catch {
      results.push({ cycle_id: cycle.id, state: "RECONCILIATION_PENDING" });
    }
  }
  return results;
}

export async function runRenewals(limit = 20) {
  const reconciliations = await reconcilePendingRenewals(limit);
  const notificationCycles = await claimCycles("claim_notification_due_subscription_cycles", limit);
  const notifications = [];
  for (const cycle of notificationCycles) notifications.push(await safelyProcess(cycle, processNotificationDueCycle));
  const debitCycles = await claimCycles("claim_due_subscription_cycles", limit);
  const debits = [];
  for (const cycle of debitCycles) debits.push(await safelyProcess(cycle, processRenewalCycle));
  return {
    reconciliations,
    notifications_claimed: notificationCycles.length,
    debits_claimed: debitCycles.length,
    notifications,
    debits,
  };
}
