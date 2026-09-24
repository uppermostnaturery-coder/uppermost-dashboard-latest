import { publicQuoteShape } from "@/lib/commerce/apiShape";
import {
  assertCommerceOrigin,
  commerceCorsHeaders,
  commerceJson,
  enforceRateLimit,
  errorResponse,
  readJsonBody,
} from "@/lib/commerce/http";
import { buildAuthoritativeQuote } from "@/lib/commerce/quoteBuilder";
import { persistQuote } from "@/lib/commerce/quotes";
import { quoteRequestSchema } from "@/lib/commerce/schemas";

export const runtime = "nodejs";

export async function OPTIONS(request: Request) {
  const origin = request.headers.get("origin");
  return new Response(null, { status: 204, headers: commerceCorsHeaders(origin) });
}

export async function POST(request: Request) {
  let origin: string | null = null;
  try {
    origin = assertCommerceOrigin(request);
    enforceRateLimit(request, "commerce-quote", 40);
    const input = quoteRequestSchema.parse(await readJsonBody(request));
    const built = await buildAuthoritativeQuote({
      items: input.items,
      postalCode: input.postal_code,
    });
    const persisted = await persistQuote({
      guestSessionId: input.guest_session_id,
      items: input.items,
      postalCode: input.postal_code,
      snapshot: built.snapshot,
      promotionVersion: built.promotionVersion,
    });
    return commerceJson(publicQuoteShape({
      quoteId: persisted.quoteId,
      quoteToken: persisted.quoteToken,
      validUntil: persisted.validUntil,
      snapshot: built.snapshot,
    }), 201, origin);
  } catch (error) {
    return errorResponse(error, origin);
  }
}

