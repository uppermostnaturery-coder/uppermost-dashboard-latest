import { randomUUID } from "crypto";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { loadCatalogVariants, assertInventory } from "./catalog";
import { createCustomerMessage } from "./messages";
import { loadActivePromotions, loadPromotionEntitlements, promotionVersion } from "./promotions";
import { calculateCartQuote } from "./pricing/calculateCartQuote";
import { createRazorpayOrder, createRazorpayRecurringPayment } from "./razorpay/client";
import { reconcilePaymentAttempt } from "./payments/service";
import type { CartLineInput } from "./types";

export type ClaimedCycle = {
  id: string;
  subscription_id: string;
  cycle_number: number;
  due_at: string;
};

export function isAboveMandateCap(amountPaise: number, maxAmountPaise: number): boolean {
  return amountPaise > maxAmountPaise;
}

export async function sendDueRenewalNotifications(): Promise<number> {
  const horizon = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const cycles = await supabaseAdmin.from("subscription_cycles")
    .select("id, subscription_id")
    .eq("status", "DUE")
    .is("pre_debit_notified_at", null)
    .lte("due_at", horizon)
    .limit(100);
  if (cycles.error) throw new Error(`Renewal notification lookup failed: ${cycles.error.message}`);
  for (const cycle of cycles.data ?? []) {
    const sub = await supabaseAdmin.from("subscriptions").select("customer_id").eq("id", cycle.subscription_id).single();
    if (!sub.data) continue;
    await createCustomerMessage({
      customerId: sub.data.customer_id,
      key: "RENEWAL_UPCOMING",
      subscriptionId: cycle.subscription_id,
      metadata: { cycle_id: cycle.id },
    });
    await supabaseAdmin.from("subscription_cycles")
      .update({ pre_debit_notified_at: new Date().toISOString() })
      .eq("id", cycle.id)
      .is("pre_debit_notified_at", null);
  }
  return cycles.data?.length ?? 0;
}

export async function claimDueRenewals(limit: number): Promise<ClaimedCycle[]> {
  const workerId = `renewal-${randomUUID()}`;
  const result = await supabaseAdmin.rpc("claim_due_subscription_cycles", {
    p_worker_id: workerId,
    p_limit: limit,
  });
  if (result.error) throw new Error(`Renewal claim failed: ${result.error.message}`);
  return (result.data ?? []) as ClaimedCycle[];
}

export async function processRenewalCycle(cycle: ClaimedCycle) {
  const subscriptionResult = await supabaseAdmin.from("subscriptions")
    .select("id, customer_id, interval_days, started_at, status, initial_order_id")
    .eq("id", cycle.subscription_id)
    .single();
  if (subscriptionResult.error || !subscriptionResult.data || subscriptionResult.data.status !== "ACTIVE") {
    await supabaseAdmin.from("subscription_cycles").update({ status: "CANCELLED" }).eq("id", cycle.id);
    return { cycle_id: cycle.id, state: "CANCELLED" };
  }
  const subscription = subscriptionResult.data;
  const [itemsResult, mandateResult, customerResult, initialOrderResult] = await Promise.all([
    supabaseAdmin.from("subscription_items").select("id, sku, quantity").eq("subscription_id", subscription.id).eq("status", "ACTIVE"),
    supabaseAdmin.from("recurring_mandates").select("*").eq("subscription_id", subscription.id).single(),
    supabaseAdmin.from("customers").select("id, name, email, phone").eq("id", subscription.customer_id).single(),
    supabaseAdmin.from("orders").select("address_snapshot").eq("id", subscription.initial_order_id).single(),
  ]);
  if (itemsResult.error || !itemsResult.data?.length || mandateResult.error || !mandateResult.data || !customerResult.data || !initialOrderResult.data) {
    throw new Error("Renewal dependencies are incomplete.");
  }
  const mandate = mandateResult.data;
  if (mandate.status !== "ACTIVE" || !mandate.provider_token_id) {
    await Promise.all([
      supabaseAdmin.from("subscription_cycles").update({ status: "REAUTH_REQUIRED" }).eq("id", cycle.id),
      supabaseAdmin.from("subscriptions").update({ status: "REAUTH_REQUIRED" }).eq("id", subscription.id),
    ]);
    await createCustomerMessage({ customerId: subscription.customer_id, key: "MANDATE_REAUTH_REQUIRED", subscriptionId: subscription.id });
    return { cycle_id: cycle.id, state: "REAUTH_REQUIRED" };
  }

  const requestItems: CartLineInput[] = itemsResult.data.map((item) => ({
    line_id: `renewal-${item.id}`,
    sku: item.sku,
    qty: item.quantity,
    purchase_mode: "SUBSCRIPTION",
    interval_days: subscription.interval_days,
  }));
  const now = new Date().toISOString();
  const catalog = await loadCatalogVariants(requestItems.map((item) => item.sku));
  assertInventory(requestItems, catalog);
  const [promotions, entitlements] = await Promise.all([
    loadActivePromotions(now),
    loadPromotionEntitlements({ customerId: subscription.customer_id, subscriptionId: subscription.id, now }),
  ]);
  const quote = calculateCartQuote({
    items: requestItems,
    catalog,
    promotions,
    entitlements,
    context: {
      stage: "RENEWAL",
      customer_id: subscription.customer_id,
      subscription_id: subscription.id,
      subscription_started_at: subscription.started_at ?? undefined,
      cycle_number: cycle.cycle_number,
      now,
      is_new_subscriber: false,
      is_first_order: false,
      is_returning_customer: true,
      shipping_country: "IN",
    },
  });
  const pricingSnapshot = { quote, promotion_version: promotionVersion(promotions), stage: "RENEWAL" };
  if (isAboveMandateCap(quote.total_paise, mandate.max_amount_paise)) {
    await Promise.all([
      supabaseAdmin.from("subscription_cycles").update({
        status: "REAUTH_REQUIRED",
        pricing_snapshot: pricingSnapshot,
        amount_paise: quote.total_paise,
        last_error: { normalized_state: "CAP_EXCEEDED" },
      }).eq("id", cycle.id),
      supabaseAdmin.from("subscriptions").update({ status: "REAUTH_REQUIRED" }).eq("id", subscription.id),
      supabaseAdmin.from("recurring_mandates").update({ status: "REAUTH_REQUIRED" }).eq("id", mandate.id),
    ]);
    await createCustomerMessage({ customerId: subscription.customer_id, key: "MANDATE_REAUTH_REQUIRED", subscriptionId: subscription.id });
    return { cycle_id: cycle.id, state: "CAP_EXCEEDED" };
  }

  const orderResult = await supabaseAdmin.from("orders").insert({
    customer_id: subscription.customer_id,
    subscription_id: subscription.id,
    order_kind: "RENEWAL",
    status: "PAYMENT_PENDING",
    subtotal_paise: quote.subtotal_paise,
    discount_paise: quote.discount_paise,
    shipping_paise: quote.shipping_paise,
    tax_paise: quote.tax_paise,
    total_paise: quote.total_paise,
    address_snapshot: initialOrderResult.data.address_snapshot,
    pricing_snapshot: pricingSnapshot,
  }).select("id, order_number").single();
  if (orderResult.error || !orderResult.data) throw new Error(`Renewal order creation failed: ${orderResult.error?.message}`);
  const order = orderResult.data;
  const itemsInsert = await supabaseAdmin.from("order_items").insert(quote.items.map((item) => ({
    order_id: order.id,
    product_id: item.product_id,
    product_variant_id: item.product_variant_id,
    line_id: item.line_id,
    sku: item.sku,
    product_name: item.product_name,
    variant_name: item.variant_name,
    quantity: item.qty,
    purchase_mode: "SUBSCRIPTION",
    interval_days: item.interval_days,
    unit_price_paise: item.unit_price_paise,
    line_subtotal_paise: item.line_subtotal_paise,
    line_total_paise: item.line_total_paise,
    snapshot: item,
  })));
  if (itemsInsert.error) throw new Error(`Renewal order items failed: ${itemsInsert.error.message}`);
  if (quote.adjustments.length) {
    await supabaseAdmin.from("order_adjustments").insert(quote.adjustments.map((adjustment) => ({
      order_id: order.id,
      promotion_id: adjustment.promotion_id,
      label: adjustment.label,
      adjustment_type: adjustment.type,
      scope: adjustment.scope,
      amount_paise: adjustment.amount_paise,
      metadata: { code: adjustment.code, applies_to_line_ids: adjustment.applies_to_line_ids },
    })));
  }
  if (quote.benefits.length) {
    await supabaseAdmin.from("order_benefits").insert(quote.benefits.map((benefit) => ({
      order_id: order.id,
      promotion_id: benefit.promotion_id,
      benefit_type: benefit.benefit_type,
      label: benefit.label,
      metadata: benefit.metadata,
    })));
  }
  const remoteOrder = await createRazorpayOrder({
    amount: quote.total_paise,
    currency: "INR",
    receipt: order.order_number,
    notes: { uppermost_order_id: order.id, subscription_id: subscription.id, purchase_shape: "SUBSCRIPTION" },
  });
  const attemptResult = await supabaseAdmin.from("payment_attempts").insert({
    subscription_cycle_id: cycle.id,
    order_id: order.id,
    kind: "RECURRING_DEBIT",
    amount_paise: quote.total_paise,
    provider_order_id: remoteOrder.id,
    status: "CREATED",
    normalized_state: "AUTHORIZING",
  }).select("*").single();
  if (attemptResult.error || !attemptResult.data) throw new Error(`Renewal payment attempt failed: ${attemptResult.error?.message}`);
  await supabaseAdmin.from("subscription_cycles").update({
    status: "PAYMENT_PENDING",
    order_id: order.id,
    pricing_snapshot: pricingSnapshot,
    amount_paise: quote.total_paise,
    provider_order_id: remoteOrder.id,
  }).eq("id", cycle.id);
  const payment = await createRazorpayRecurringPayment({
    email: customerResult.data.email,
    contact: customerResult.data.phone,
    amount: quote.total_paise,
    currency: "INR",
    order_id: remoteOrder.id,
    customer_id: mandate.provider_customer_id,
    token: mandate.provider_token_id,
    description: `Uppermost subscription renewal ${order.order_number}`,
  });
  await reconcilePaymentAttempt({ attempt: attemptResult.data, payment });
  return { cycle_id: cycle.id, state: payment.status === "captured" ? "CONFIRMED" : "PENDING" };
}

export async function runRenewals(limit = 20) {
  const notified = await sendDueRenewalNotifications();
  const cycles = await claimDueRenewals(limit);
  const results = [];
  for (const cycle of cycles) {
    try {
      results.push(await processRenewalCycle(cycle));
    } catch (error) {
      console.error("Renewal cycle failed:", cycle.id, error);
      await supabaseAdmin.from("subscription_cycles").update({
        status: "FAILED",
        last_error: { message: error instanceof Error ? error.message : "Unknown renewal error" },
      }).eq("id", cycle.id);
      results.push({ cycle_id: cycle.id, state: "SYSTEM_ERROR" });
    }
  }
  return { notified, claimed: cycles.length, results };
}
