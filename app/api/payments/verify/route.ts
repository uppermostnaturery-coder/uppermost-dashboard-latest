import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requestHash, verifyHmacHex } from "@/lib/commerce/crypto";
import { getRazorpayEnv } from "@/lib/commerce/env";
import {
  assertCommerceOrigin,
  CommerceError,
  commerceCorsHeaders,
  commerceJson,
  enforceRateLimit,
  errorResponse,
  readJsonBody,
  requireIdempotencyKey,
} from "@/lib/commerce/http";
import { beginIdempotentRequest, completeIdempotentRequest } from "@/lib/commerce/idempotency";
import { reconcilePaymentAttempt } from "@/lib/commerce/payments/service";
import { fetchRazorpayPayment } from "@/lib/commerce/razorpay/client";
import { paymentVerifySchema } from "@/lib/commerce/schemas";
import { getCheckoutStatus } from "@/lib/commerce/status";

export const runtime = "nodejs";

export async function OPTIONS(request: Request) {
  return new Response(null, { status: 204, headers: commerceCorsHeaders(request.headers.get("origin")) });
}

export async function POST(request: Request) {
  let origin: string | null = null;
  let recordId: string | null = null;
  try {
    origin = assertCommerceOrigin(request);
    enforceRateLimit(request, "payments-verify", 20);
    const key = requireIdempotencyKey(request);
    const input = paymentVerifySchema.parse(await readJsonBody(request));
    const decision = await beginIdempotentRequest({
      endpoint: "POST /api/payments/verify",
      key,
      requestHash: requestHash(input),
    });
    if (decision.kind === "REPLAY") return commerceJson(decision.body, decision.status, origin);
    recordId = decision.recordId;

    const signatureValid = verifyHmacHex(
      `${input.razorpay_order_id}|${input.razorpay_payment_id}`,
      input.razorpay_signature,
      getRazorpayEnv().keySecret
    );
    if (!signatureValid) throw new CommerceError("INVALID_PAYMENT_SIGNATURE", "Payment signature is invalid.", 400);

    const attemptResult = await supabaseAdmin.from("payment_attempts")
      .select("*")
      .eq("checkout_session_id", input.checkout_session_id)
      .eq("provider_order_id", input.razorpay_order_id)
      .single();
    if (attemptResult.error || !attemptResult.data) {
      throw new CommerceError("PAYMENT_ATTEMPT_NOT_FOUND", "Payment attempt was not found.", 404);
    }
    const payment = await fetchRazorpayPayment(input.razorpay_payment_id);
    if (
      payment.order_id !== input.razorpay_order_id ||
      payment.amount !== attemptResult.data.amount_paise ||
      payment.currency !== attemptResult.data.currency
    ) {
      throw new CommerceError("PAYMENT_MISMATCH", "Payment details do not match the checkout.", 409);
    }
    await reconcilePaymentAttempt({ attempt: attemptResult.data, payment });
    const body = await getCheckoutStatus(input.checkout_session_id);
    await completeIdempotentRequest({
      recordId,
      status: 200,
      body,
      referenceType: "checkout_session",
      referenceId: input.checkout_session_id,
    });
    return commerceJson(body, 200, origin);
  } catch (error) {
    if (recordId) {
      const body = {
        ok: false,
        error: {
          code: error instanceof CommerceError ? error.code : "SYSTEM_ERROR",
          message: error instanceof CommerceError
            ? error.message
            : "The commerce service is temporarily unavailable.",
        },
      };
      const status = error instanceof CommerceError ? error.status : 500;
      await completeIdempotentRequest({ recordId, status, body }).catch(console.error);
      if (!(error instanceof CommerceError)) console.error("Unexpected payment verify error:", error);
      return commerceJson(body, status, origin);
    }
    return errorResponse(error, origin);
  }
}
