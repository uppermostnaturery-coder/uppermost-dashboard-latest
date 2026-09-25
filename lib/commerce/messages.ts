import { supabaseAdmin } from "@/lib/supabaseAdmin";
import type { CustomerMessageKey } from "./types";

export type CustomerMessage = {
  key: CustomerMessageKey;
  title: string;
  body: string;
  severity: "INFO" | "SUCCESS" | "WARNING" | "ERROR";
  cta_label?: string;
  cta_url?: string;
};

export const MESSAGE_FALLBACKS: Record<CustomerMessageKey, Omit<CustomerMessage, "key">> = {
  PAYMENT_CONFIRMING: { title: "Confirming your payment", body: "Your payment is being securely confirmed. Please keep this page open.", severity: "INFO" },
  PAYMENT_CONFIRMED: { title: "Payment confirmed", body: "Your Uppermost order is confirmed.", severity: "SUCCESS", cta_label: "View order journey" },
  PAYMENT_PENDING: { title: "Payment pending", body: "We are waiting for final confirmation. Do not make another payment yet.", severity: "WARNING" },
  PAYMENT_FAILED: { title: "Payment could not be completed", body: "No fulfilment has started. Please retry when prompted.", severity: "ERROR", cta_label: "Try again" },
  ORDER_PREPARING: { title: "Order being prepared", body: "Your order is being prepared with care.", severity: "INFO" },
  ORDER_SHIPPED: { title: "Order shipped", body: "Your Uppermost order is on its way.", severity: "SUCCESS", cta_label: "Track order" },
  IN_TRANSIT: { title: "In transit", body: "Your order is moving through the courier network.", severity: "INFO", cta_label: "Track order" },
  OUT_FOR_DELIVERY: { title: "Out for delivery", body: "Your order is scheduled for delivery today.", severity: "INFO" },
  DELIVERED: { title: "Delivered", body: "Your Uppermost order has been delivered.", severity: "SUCCESS" },
  RENEWAL_UPCOMING: { title: "Upcoming subscription renewal", body: "Your next subscription order is being prepared for payment.", severity: "INFO" },
  RENEWAL_SUCCESS: { title: "Renewal confirmed", body: "Your subscription renewal payment is confirmed.", severity: "SUCCESS", cta_label: "Track order" },
  RENEWAL_FAILED: { title: "Renewal needs attention", body: "We could not complete this renewal. No duplicate debit will be attempted while it is unresolved.", severity: "ERROR" },
  MANDATE_REAUTH_REQUIRED: { title: "Mandate update required", body: "The renewal amount is above your authorised mandate maximum. Please approve a new mandate.", severity: "WARNING", cta_label: "Update mandate" },
  MANDATE_PAUSED: { title: "Mandate paused", body: "Your recurring mandate is paused. Resume it before the next renewal.", severity: "WARNING", cta_label: "Review mandate" },
  QUOTE_CHANGED: { title: "Order total updated", body: "Pricing or eligibility changed. Please review the refreshed order before paying.", severity: "WARNING", cta_label: "Review order" },
};

export async function resolveMessage(key: CustomerMessageKey): Promise<CustomerMessage> {
  const { data } = await supabaseAdmin
    .from("message_templates")
    .select("title, body, severity, cta_label, cta_url")
    .eq("message_key", key)
    .eq("channel", "IN_APP")
    .eq("is_active", true)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  const fallback = MESSAGE_FALLBACKS[key];
  return {
    key,
    title: data?.title ?? fallback.title,
    body: data?.body ?? fallback.body,
    severity: (data?.severity ?? fallback.severity) as CustomerMessage["severity"],
    ...(data?.cta_label || fallback.cta_label ? { cta_label: data?.cta_label ?? fallback.cta_label } : {}),
    ...(data?.cta_url || fallback.cta_url ? { cta_url: data?.cta_url ?? fallback.cta_url } : {}),
  };
}

export async function createCustomerMessage(args: {
  customerId: string;
  key: CustomerMessageKey;
  orderId?: string;
  subscriptionId?: string;
  paymentAttemptId?: string;
  shipmentId?: string;
  metadata?: Record<string, unknown>;
}): Promise<CustomerMessage> {
  const message = await resolveMessage(args.key);
  const inserted = await supabaseAdmin.from("customer_messages").insert({
    customer_id: args.customerId,
    message_key: args.key,
    order_id: args.orderId ?? null,
    subscription_id: args.subscriptionId ?? null,
    payment_attempt_id: args.paymentAttemptId ?? null,
    shipment_id: args.shipmentId ?? null,
    title: message.title,
    body: message.body,
    severity: message.severity,
    cta_label: message.cta_label ?? null,
    cta_url: message.cta_url ?? null,
    metadata: args.metadata ?? {},
  }).select("id").single();

  let messageId = inserted.data?.id ?? null;
  if (inserted.error?.code === "23505") {
    let existing = supabaseAdmin
      .from("customer_messages")
      .select("id")
      .eq("message_key", args.key);
    existing = args.orderId
      ? existing.eq("order_id", args.orderId)
      : existing.is("order_id", null);
    existing = args.paymentAttemptId
      ? existing.eq("payment_attempt_id", args.paymentAttemptId)
      : existing.is("payment_attempt_id", null);
    existing = args.shipmentId
      ? existing.eq("shipment_id", args.shipmentId)
      : existing.is("shipment_id", null);
    const result = await existing.order("created_at", { ascending: true }).limit(1).maybeSingle();
    messageId = result.data?.id ?? null;
    if (result.error) console.error("Customer message lookup failed:", result.error);
  } else if (inserted.error) {
    console.error("Customer message persistence failed:", inserted.error);
  }

  if (messageId) {
    const now = new Date().toISOString();
    const delivery = await supabaseAdmin.from("message_deliveries").upsert({
      customer_message_id: messageId,
      channel: "IN_APP",
      provider: "UPPERMOST",
      status: "DELIVERED",
      attempt_number: 1,
      sent_at: now,
      delivered_at: now,
    }, {
      onConflict: "customer_message_id,channel,attempt_number",
      ignoreDuplicates: true,
    });
    if (delivery.error) console.error("In-app message delivery persistence failed:", delivery.error);
  }
  return message;
}
