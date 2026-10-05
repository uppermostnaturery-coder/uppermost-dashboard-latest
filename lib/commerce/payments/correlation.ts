import { supabaseAdmin } from "@/lib/supabaseAdmin";
import type { RazorpayPayment } from "../razorpay/client";

export async function resolveRazorpayPaymentAttempt(args: {
  payment: RazorpayPayment;
  checkoutSessionId?: string;
  subscriptionCycleId?: string;
}) {
  const { payment } = args;
  if (!payment.id || !payment.order_id) {
    throw new Error("PAYMENT_ATTEMPT_CORRELATION_PENDING");
  }
  const result = await supabaseAdmin.rpc("resolve_razorpay_payment_attempt", {
    p_provider_order_id: payment.order_id,
    p_provider_payment_id: payment.id,
    p_amount_paise: payment.amount,
    p_currency: payment.currency,
    p_checkout_session_id: args.checkoutSessionId ?? null,
    p_subscription_cycle_id: args.subscriptionCycleId ?? null,
  });
  if (result.error) {
    throw new Error(`Payment attempt correlation failed: ${result.error.message}`);
  }
  const attempt = Array.isArray(result.data) ? result.data[0] : result.data;
  if (!attempt?.id) throw new Error("PAYMENT_ATTEMPT_CORRELATION_PENDING");
  return attempt;
}
