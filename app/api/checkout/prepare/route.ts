import { prepareCheckout } from "@/lib/commerce/checkout";
import { requestHash } from "@/lib/commerce/crypto";
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
import {
  beginIdempotentRequest,
  completeIdempotentRequest,
} from "@/lib/commerce/idempotency";
import { checkoutPrepareSchema } from "@/lib/commerce/schemas";

export const runtime = "nodejs";

export async function OPTIONS(request: Request) {
  return new Response(null, { status: 204, headers: commerceCorsHeaders(request.headers.get("origin")) });
}

export async function POST(request: Request) {
  let origin: string | null = null;
  let recordId: string | null = null;
  try {
    origin = assertCommerceOrigin(request);
    enforceRateLimit(request, "checkout-prepare", 15);
    const key = requireIdempotencyKey(request);
    const input = checkoutPrepareSchema.parse(await readJsonBody(request));
    const decision = await beginIdempotentRequest({
      endpoint: "POST /api/checkout/prepare",
      key,
      requestHash: requestHash(input),
    });
    if (decision.kind === "REPLAY") return commerceJson(decision.body, decision.status, origin);
    recordId = decision.recordId;
    const body = await prepareCheckout(input, key);
    await completeIdempotentRequest({
      recordId,
      status: 201,
      body,
      referenceType: "checkout_session",
      referenceId: body.checkout_session_id,
    });
    return commerceJson(body, 201, origin);
  } catch (error) {
    if (recordId && error instanceof CommerceError) {
      const body = {
        ok: false,
        error: {
          code: error.code,
          message: error.message,
          ...(error.details ? { details: error.details } : {}),
        },
      };
      await completeIdempotentRequest({ recordId, status: error.status, body }).catch(console.error);
      return commerceJson(body, error.status, origin);
    }
    if (recordId) {
      const body = {
        ok: false,
        error: {
          code: "SYSTEM_ERROR",
          message: "The commerce service is temporarily unavailable.",
        },
      };
      await completeIdempotentRequest({ recordId, status: 500, body }).catch(console.error);
      console.error("Unexpected checkout prepare error:", error);
      return commerceJson(body, 500, origin);
    }
    return errorResponse(error, origin);
  }
}
