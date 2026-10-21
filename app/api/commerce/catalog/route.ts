import {withObservation} from "@/lib/observability/server";
import {
  assertCommerceOrigin,
  commerceCorsHeaders,
  commerceJson,
  enforceRateLimit,
  errorResponse,
} from "@/lib/commerce/http";
import { loadPublicCatalog } from "@/lib/commerce/publicCatalog";

export const runtime = "nodejs";

const METHODS = "GET, OPTIONS";
const PUBLIC_CACHE = "public, max-age=30, s-maxage=30, stale-while-revalidate=30";

async function observedOPTIONS(request: Request) {
  return new Response(null, {
    status: 204,
    headers: commerceCorsHeaders(request.headers.get("origin"), METHODS),
  });
}

async function observedGET(request: Request) {
  let origin: string | null = null;
  try {
    origin = assertCommerceOrigin(request);
    enforceRateLimit(request, "commerce-catalog", 60);
    const catalog = await loadPublicCatalog();
    const response = commerceJson(catalog, 200, origin, METHODS);
    response.headers.set("Cache-Control", PUBLIC_CACHE);
    return response;
  } catch (error) {
    return errorResponse(error, origin);
  }
}

export const OPTIONS = withObservation("/api/commerce/catalog", observedOPTIONS);
export const GET = withObservation("/api/commerce/catalog", observedGET);
