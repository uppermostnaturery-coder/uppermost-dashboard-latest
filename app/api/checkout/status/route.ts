import {
  assertCommerceOrigin,
  CommerceError,
  commerceCorsHeaders,
  commerceJson,
  enforceRateLimit,
  errorResponse,
} from "@/lib/commerce/http";
import { getCheckoutStatus } from "@/lib/commerce/status";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function OPTIONS(request: Request) {
  return new Response(null, { status: 204, headers: commerceCorsHeaders(request.headers.get("origin"), "GET, OPTIONS") });
}

export async function GET(request: Request) {
  let origin: string | null = null;
  try {
    origin = assertCommerceOrigin(request);
    enforceRateLimit(request, "checkout-status", 90);
    const sessionId = new URL(request.url).searchParams.get("session_id");
    if (!sessionId || !/^[0-9a-f-]{36}$/i.test(sessionId)) {
      throw new CommerceError("VALIDATION_ERROR", "A valid session_id is required.", 400);
    }
    return commerceJson(await getCheckoutStatus(sessionId), 200, origin, "GET, OPTIONS");
  } catch (error) {
    return errorResponse(error, origin);
  }
}
