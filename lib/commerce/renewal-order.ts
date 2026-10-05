import { supabaseAdmin } from "@/lib/supabaseAdmin";
import type { CartQuote } from "./types";

export type RenewalPricing = {
  quote: CartQuote;
  snapshot: {
    quote: CartQuote;
    exact_cycle_items: CartQuote["items"];
    promotion_version: string;
    stage: "RENEWAL";
    price_locked_at: string;
  };
  now: string;
};

export type ExistingRenewalOrder = {
  id: string;
  order_number: string;
  customer_id: string;
  subscription_id: string | null;
  subscription_cycle_id: string | null;
  order_kind: string;
  currency: string;
  subtotal_paise: number;
  discount_paise: number;
  shipping_paise: number;
  tax_paise: number;
  total_paise: number;
  address_snapshot: unknown;
  pricing_snapshot: unknown;
};

type RenewalIdentity = {
  cycleId: string;
  subscriptionId: string;
  customerId: string;
  addressSnapshot: unknown;
};

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function canonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJson);
  const object = record(value);
  if (!object) return value;
  return Object.fromEntries(
    Object.keys(object).sort().map((key) => [key, canonicalJson(object[key])])
  );
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(canonicalJson(left)) === JSON.stringify(canonicalJson(right));
}

function nonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

export function lockedPricingFromRenewalOrder(
  order: ExistingRenewalOrder,
  identity: RenewalIdentity
): RenewalPricing {
  if (
    order.customer_id !== identity.customerId
    || order.subscription_id !== identity.subscriptionId
    || order.subscription_cycle_id !== identity.cycleId
    || order.order_kind !== "RENEWAL"
    || order.currency !== "INR"
    || !sameJson(order.address_snapshot, identity.addressSnapshot)
  ) {
    throw new Error("Existing renewal order conflicts with subscription-cycle identity.");
  }

  const snapshot = record(order.pricing_snapshot);
  const quote = record(snapshot?.quote);
  const items = quote?.items;
  const exactItems = snapshot?.exact_cycle_items;
  const priceLockedAt = snapshot?.price_locked_at;
  const stage = snapshot?.stage;
  if (
    !snapshot
    || !quote
    || quote.currency !== "INR"
    || quote.stage !== "RENEWAL"
    || stage !== "RENEWAL"
    || !Array.isArray(items)
    || !Array.isArray(exactItems)
    || !sameJson(items, exactItems)
    || typeof snapshot.promotion_version !== "string"
    || typeof priceLockedAt !== "string"
    || Number.isNaN(Date.parse(priceLockedAt))
  ) {
    throw new Error("Existing renewal order has an invalid immutable pricing snapshot.");
  }

  const amounts = [
    quote.subtotal_paise,
    quote.discount_paise,
    quote.shipping_paise,
    quote.tax_paise,
    quote.total_paise,
  ];
  if (!amounts.every(nonNegativeInteger)) {
    throw new Error("Existing renewal order has invalid pricing amounts.");
  }
  if (
    order.subtotal_paise !== quote.subtotal_paise
    || order.discount_paise !== quote.discount_paise
    || order.shipping_paise !== quote.shipping_paise
    || order.tax_paise !== quote.tax_paise
    || order.total_paise !== quote.total_paise
  ) {
    throw new Error("Existing renewal order amount conflicts with its pricing snapshot.");
  }

  return {
    quote: quote as unknown as CartQuote,
    snapshot: snapshot as RenewalPricing["snapshot"],
    now: priceLockedAt,
  };
}

export async function resolveRenewalPricing(
  existingOrder: ExistingRenewalOrder | null,
  identity: RenewalIdentity,
  priceNewOrder: () => Promise<RenewalPricing>
): Promise<RenewalPricing> {
  return existingOrder
    ? lockedPricingFromRenewalOrder(existingOrder, identity)
    : priceNewOrder();
}

export function canCreateRenewalProviderOrder(
  localOrderCreatedNow: boolean,
  lastError: unknown
): boolean {
  if (localOrderCreatedNow) return true;
  const error = record(lastError);
  const status = error?.http_status;
  return error?.stage === "PROVIDER_ORDER"
    && error?.provider === "RAZORPAY"
    && typeof status === "number"
    && status >= 400
    && status < 500;
}

export async function establishRenewalOrder(input: {
  identity: RenewalIdentity;
  pricing: RenewalPricing;
}) {
  const result = await supabaseAdmin.rpc("establish_renewal_order", {
    p_cycle_id: input.identity.cycleId,
    p_subscription_id: input.identity.subscriptionId,
    p_customer_id: input.identity.customerId,
    p_currency: input.pricing.quote.currency,
    p_subtotal_paise: input.pricing.quote.subtotal_paise,
    p_discount_paise: input.pricing.quote.discount_paise,
    p_shipping_paise: input.pricing.quote.shipping_paise,
    p_tax_paise: input.pricing.quote.tax_paise,
    p_total_paise: input.pricing.quote.total_paise,
    p_address_snapshot: input.identity.addressSnapshot,
    p_pricing_snapshot: input.pricing.snapshot,
    p_item_snapshot: input.pricing.quote.items,
    p_price_locked_at: input.pricing.now,
  });
  if (result.error) throw new Error(`Renewal order establishment failed: ${result.error.message}`);
  const row = Array.isArray(result.data) ? result.data[0] : result.data;
  if (!row?.order_id || !row.order_number) throw new Error("Renewal order establishment returned no order.");
  return {
    id: String(row.order_id),
    order_number: String(row.order_number),
    created: Boolean(row.created),
  };
}

export async function establishRenewalPaymentAttempt(input: {
  cycleId: string;
  orderId: string;
  providerOrderId: string;
  amountPaise: number;
  notifiedAt: string;
  scheduledChargeAt: string;
}) {
  const result = await supabaseAdmin.rpc("establish_renewal_payment_attempt", {
    p_cycle_id: input.cycleId,
    p_order_id: input.orderId,
    p_provider_order_id: input.providerOrderId,
    p_amount_paise: input.amountPaise,
    p_currency: "INR",
    p_notified_at: input.notifiedAt,
    p_scheduled_charge_at: input.scheduledChargeAt,
  });
  if (result.error) throw new Error(`Renewal payment attempt establishment failed: ${result.error.message}`);
  const row = Array.isArray(result.data) ? result.data[0] : result.data;
  if (!row?.payment_attempt_id) throw new Error("Renewal payment attempt establishment returned no attempt.");
  return { id: String(row.payment_attempt_id), created: Boolean(row.created) };
}
