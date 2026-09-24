import {
  assertCommerceOrigin,
  commerceCorsHeaders,
  commerceJson,
  enforceRateLimit,
  errorResponse,
  readJsonBody,
} from "@/lib/commerce/http";
import { buildAuthoritativeQuote } from "@/lib/commerce/quoteBuilder";
import { shippingServiceabilitySchema } from "@/lib/commerce/schemas";

export const runtime = "nodejs";

export async function OPTIONS(request: Request) {
  return new Response(null, { status: 204, headers: commerceCorsHeaders(request.headers.get("origin")) });
}

export async function POST(request: Request) {
  let origin: string | null = null;
  try {
    origin = assertCommerceOrigin(request);
    enforceRateLimit(request, "shipping-serviceability", 40);
    const input = shippingServiceabilitySchema.parse(await readJsonBody(request));
    const built = await buildAuthoritativeQuote({ items: input.items, postalCode: input.postal_code });
    const shipping = built.snapshot.shipping;
    return commerceJson({
      ok: true,
      serviceable: shipping.serviceable ?? false,
      estimated_delivery_from: shipping.estimated_delivery_from ?? null,
      estimated_delivery_to: shipping.estimated_delivery_to ?? null,
      ...(shipping.best_courier_internal_reference
        ? { best_courier_internal_reference: shipping.best_courier_internal_reference }
        : {}),
      shipping_amount_paise: Number(shipping.shipping_amount_paise ?? 0),
      message: shipping.message ?? "Delivery details are unavailable.",
    }, 200, origin);
  } catch (error) {
    return errorResponse(error, origin);
  }
}

