import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { createPublicToken, tokenHash } from "./crypto";
import { findCustomerIdentity, resolveOrCreateCustomer, saveCustomerAddress } from "./customers";
import { getCommerceEnv, getRazorpayEnv } from "./env";
import { CommerceError } from "./http";
import { buildAuthoritativeQuote } from "./quoteBuilder";
import {
  assertValidQuote,
  loadQuote,
  persistQuote,
  quotePricingFingerprint,
  validateQuoteRecord,
} from "./quotes";
import { publicQuoteShape } from "./apiShape";
import { createRazorpayCustomer, createRazorpayOrder } from "./razorpay/client";
import type { CartLineInput, CartQuote } from "./types";

type PrepareInput = {
  guest_session_id: string;
  quote_id: string;
  quote_token: string;
  customer: { name: string; email: string; phone: string };
  shipping_address: Record<string, unknown> & { postal_code: string; country: "IN" };
  billing_same_as_shipping: boolean;
  recurring_consent?: { accepted: true; version: string };
};

function purchaseShape(items: CartLineInput[]) {
  const hasSubscription = items.some((item) => item.purchase_mode === "SUBSCRIPTION");
  const hasOneTime = items.some((item) => item.purchase_mode === "BUY_ONCE");
  return hasSubscription && hasOneTime
    ? ("MIXED" as const)
    : hasSubscription
      ? ("SUBSCRIPTION" as const)
      : ("BUY_ONCE" as const);
}

async function insertOrderSnapshot(args: {
  checkoutSessionId: string;
  customerId: string;
  address: Record<string, unknown>;
  quote: CartQuote;
  fullSnapshot: Record<string, unknown>;
  experienceTokenHash: string;
}) {
  const { data: order, error: orderError } = await supabaseAdmin
    .from("orders")
    .insert({
      checkout_session_id: args.checkoutSessionId,
      customer_id: args.customerId,
      status: "PAYMENT_PENDING",
      subtotal_paise: args.quote.subtotal_paise,
      discount_paise: args.quote.discount_paise,
      shipping_paise: args.quote.shipping_paise,
      tax_paise: args.quote.tax_paise,
      total_paise: args.quote.total_paise,
      address_snapshot: args.address,
      pricing_snapshot: args.fullSnapshot,
      experience_token_hash: args.experienceTokenHash,
    })
    .select("id, order_number")
    .single();
  if (orderError || !order) throw new Error(`Order creation failed: ${orderError?.message}`);

  const { data: orderItems, error: itemError } = await supabaseAdmin
    .from("order_items")
    .insert(args.quote.items.map((item) => ({
      order_id: order.id,
      product_id: item.product_id,
      product_variant_id: item.product_variant_id,
      line_id: item.line_id,
      sku: item.sku,
      product_name: item.product_name,
      variant_name: item.variant_name,
      quantity: item.qty,
      purchase_mode: item.purchase_mode,
      interval_days: item.interval_days ?? null,
      unit_price_paise: item.unit_price_paise,
      line_subtotal_paise: item.line_subtotal_paise,
      line_total_paise: item.line_total_paise,
      snapshot: item,
    })))
    .select("id, line_id, purchase_mode");
  if (itemError) throw new Error(`Order item creation failed: ${itemError.message}`);

  if (args.quote.adjustments.length > 0) {
    const { error } = await supabaseAdmin.from("order_adjustments").insert(
      args.quote.adjustments.map((adjustment) => ({
        order_id: order.id,
        promotion_id: adjustment.promotion_id,
        label: adjustment.label,
        adjustment_type: adjustment.type,
        scope: adjustment.scope,
        amount_paise: adjustment.amount_paise,
        metadata: {
          code: adjustment.code,
          applies_to_line_ids: adjustment.applies_to_line_ids,
        },
      }))
    );
    if (error) throw new Error(`Order adjustment creation failed: ${error.message}`);
  }
  if (args.quote.benefits.length > 0) {
    const { error } = await supabaseAdmin.from("order_benefits").insert(
      args.quote.benefits.map((benefit) => ({
        order_id: order.id,
        promotion_id: benefit.promotion_id,
        benefit_type: benefit.benefit_type,
        label: benefit.label,
        metadata: { code: benefit.code, ...benefit.metadata },
      }))
    );
    if (error) throw new Error(`Order benefit creation failed: ${error.message}`);
  }
  return { order, orderItems: orderItems ?? [] };
}

export async function prepareCheckout(input: PrepareInput, idempotencyKey: string) {
  const stored = await loadQuote(input.quote_id);
  assertValidQuote(validateQuoteRecord({
    quote: stored,
    token: input.quote_token,
    guestSessionId: input.guest_session_id,
  }));
  if (!stored) throw new CommerceError("INVALID_QUOTE", "Quote validation failed.", 400);

  const items = stored.items as CartLineInput[];
  const hasSubscription = items.some((item) => item.purchase_mode === "SUBSCRIPTION");
  if (hasSubscription && !input.recurring_consent?.accepted) {
    throw new CommerceError(
      "RECURRING_CONSENT_REQUIRED",
      "Recurring payment consent is required for subscription items.",
      400
    );
  }

  const identity = await findCustomerIdentity(input.customer);
  const current = await buildAuthoritativeQuote({
    items,
    postalCode: input.shipping_address.postal_code,
    customerId: identity.customerId,
    isFirstOrder: !identity.hasOrders,
    isNewSubscriber: !identity.hasOrders,
  });
  if (current.snapshot.shipping.serviceable === false) {
    throw new CommerceError(
      "UNSERVICEABLE_PINCODE",
      "Delivery is not currently available for this pincode.",
      409
    );
  }
  if (quotePricingFingerprint(stored.price_snapshot) !== quotePricingFingerprint(current.snapshot)) {
    const replacement = await persistQuote({
      guestSessionId: input.guest_session_id,
      items,
      postalCode: input.shipping_address.postal_code,
      snapshot: current.snapshot,
      promotionVersion: current.promotionVersion,
    });
    throw new CommerceError(
      "QUOTE_CHANGED",
      "Pricing or eligibility changed. Review the refreshed quote.",
      409,
      { quote: publicQuoteShape({
        quoteId: replacement.quoteId,
        quoteToken: replacement.quoteToken,
        validUntil: replacement.validUntil,
        snapshot: current.snapshot,
      }) }
    );
  }

  const customer = await resolveOrCreateCustomer(input.customer);
  const addressId = await saveCustomerAddress({
    customerId: customer.id,
    customerName: input.customer.name,
    customerPhone: input.customer.phone,
    address: input.shipping_address,
  });
  const shape = purchaseShape(items);
  const recurringGroup = current.snapshot.recurring_groups[0];
  const experienceToken = createPublicToken("exp");
  const env = getCommerceEnv();
  const { data: checkout, error: checkoutError } = await supabaseAdmin
    .from("checkout_sessions")
    .insert({
      quote_id: stored.id,
      customer_id: customer.id,
      address_id: addressId,
      guest_session_id: input.guest_session_id,
      state: "CHECKOUT_READY",
      payment_kind: hasSubscription ? "RECURRING_AUTH" : "ONE_TIME",
      purchase_shape: shape,
      amount_paise: current.snapshot.initial.total_paise,
      recurring_projection_paise: recurringGroup?.quote.total_paise ?? 0,
      mandate_max_amount_paise: recurringGroup?.mandate_max_amount_paise ?? null,
      recurring_interval_days: recurringGroup?.interval_days ?? null,
      recurring_consent: input.recurring_consent ?? null,
      address_snapshot: input.shipping_address,
      pricing_snapshot: current.snapshot,
      experience_token: experienceToken,
    })
    .select("id")
    .single();
  if (checkoutError?.code === "23505") {
    throw new CommerceError("QUOTE_CONSUMED", "This quote has already been used.", 409);
  }
  if (checkoutError || !checkout) throw new Error(`Checkout creation failed: ${checkoutError?.message}`);

  const { order, orderItems } = await insertOrderSnapshot({
    checkoutSessionId: checkout.id,
    customerId: customer.id,
    address: input.shipping_address,
    quote: current.snapshot.initial,
    fullSnapshot: current.snapshot as unknown as Record<string, unknown>,
    experienceTokenHash: tokenHash(experienceToken, env.tokenPepper),
  });
  await supabaseAdmin.from("checkout_sessions").update({ order_id: order.id }).eq("id", checkout.id);

  let providerCustomerId = customer.razorpay_customer_id as string | null;
  let subscriptionId: string | null = null;
  if (hasSubscription) {
    if (!providerCustomerId) {
      const remoteCustomer = await createRazorpayCustomer({
        name: input.customer.name,
        email: input.customer.email,
        contact: input.customer.phone,
      });
      providerCustomerId = remoteCustomer.id;
      await supabaseAdmin.from("customers").update({ razorpay_customer_id: providerCustomerId }).eq("id", customer.id);
    }
    const { data: subscription, error } = await supabaseAdmin.from("subscriptions").insert({
      customer_id: customer.id,
      checkout_session_id: checkout.id,
      initial_order_id: order.id,
      interval_days: recurringGroup.interval_days,
      pricing_context: { initial_promotion_version: current.promotionVersion },
    }).select("id").single();
    if (error || !subscription) throw new Error(`Subscription creation failed: ${error?.message}`);
    subscriptionId = subscription.id;
    await supabaseAdmin.from("orders").update({ subscription_id: subscriptionId }).eq("id", order.id);
    const subscriptionLines = current.snapshot.initial.items.filter((item) => item.purchase_mode === "SUBSCRIPTION");
    const orderItemByLine = new Map(orderItems.map((item: any) => [item.line_id, item.id]));
    const itemInsert = await supabaseAdmin.from("subscription_items").insert(
      subscriptionLines.map((item) => ({
        subscription_id: subscriptionId,
        product_id: item.product_id,
        product_variant_id: item.product_variant_id,
        source_order_item_id: orderItemByLine.get(item.line_id) ?? null,
        sku: item.sku,
        quantity: item.qty,
        metadata: { interval_days: item.interval_days },
      }))
    );
    if (itemInsert.error) throw new Error(`Subscription item creation failed: ${itemInsert.error.message}`);
    const expiry = new Date(Date.now() + getRazorpayEnv().mandateExpiryDays * 86_400_000);
    const mandateInsert = await supabaseAdmin.from("recurring_mandates").insert({
      subscription_id: subscriptionId,
      customer_id: customer.id,
      provider_customer_id: providerCustomerId,
      max_amount_paise: recurringGroup.mandate_max_amount_paise,
      expires_at: expiry.toISOString(),
    });
    if (mandateInsert.error) throw new Error(`Mandate creation failed: ${mandateInsert.error.message}`);
  }

  const mandateExpiresAt = Math.floor(
    (Date.now() + getRazorpayEnv().mandateExpiryDays * 86_400_000) / 1000
  );
  const remoteOrder = await createRazorpayOrder({
    amount: current.snapshot.initial.total_paise,
    currency: "INR",
    receipt: order.order_number,
    notes: {
      uppermost_order_id: order.id,
      checkout_session_id: checkout.id,
      purchase_shape: shape,
    },
    ...(hasSubscription ? {
      customer_id: providerCustomerId!,
      recurring: {
        max_amount: recurringGroup.mandate_max_amount_paise,
        expire_at: mandateExpiresAt,
        frequency: "as_presented" as const,
      },
    } : {}),
  });
  const attemptResult = await supabaseAdmin.from("payment_attempts").insert({
    checkout_session_id: checkout.id,
    order_id: order.id,
    kind: hasSubscription ? "RECURRING_AUTH" : "ONE_TIME",
    amount_paise: current.snapshot.initial.total_paise,
    provider_order_id: remoteOrder.id,
    status: "CREATED",
    normalized_state: "CHECKOUT_READY",
  });
  if (attemptResult.error) throw new Error(`Payment attempt creation failed: ${attemptResult.error.message}`);
  await Promise.all([
    supabaseAdmin.from("checkout_sessions").update({
      provider_order_id: remoteOrder.id,
      provider_customer_id: providerCustomerId,
    }).eq("id", checkout.id),
    supabaseAdmin.from("commerce_quotes").update({
      status: "CONSUMED",
      consumed_at: new Date().toISOString(),
      consumed_by_idempotency_key: idempotencyKey,
      customer_id: customer.id,
    }).eq("id", stored.id).eq("status", "OPEN"),
  ]);

  return {
    ok: true,
    checkout_session_id: checkout.id,
    uppermost_order_id: order.order_number,
    payment_kind: hasSubscription ? "RECURRING_AUTH" : "ONE_TIME",
    state: "CHECKOUT_READY",
    razorpay: {
      key_id: getRazorpayEnv().keyId,
      order_id: remoteOrder.id,
      ...(providerCustomerId ? { customer_id: providerCustomerId } : {}),
      amount_paise: current.snapshot.initial.total_paise,
      currency: "INR",
      recurring: hasSubscription,
      prefill: {
        name: input.customer.name,
        email: input.customer.email,
        contact: input.customer.phone,
      },
    },
    display: {
      amount_now_paise: current.snapshot.initial.total_paise,
      recurring_projection_paise: recurringGroup?.quote.total_paise ?? 0,
      mandate_max_amount_paise: recurringGroup?.mandate_max_amount_paise ?? null,
      interval_days: recurringGroup?.interval_days ?? null,
    },
    subscription_id: subscriptionId,
  };
}
