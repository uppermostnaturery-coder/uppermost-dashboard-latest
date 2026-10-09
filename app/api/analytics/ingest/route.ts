import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { parseAnalyticsBatch } from "@/lib/analytics/schema";
import { assertCommerceOrigin, commerceCorsHeaders, commerceJson, errorResponse, readJsonBody, enforceRateLimit, CommerceError } from "@/lib/commerce/http";
export const runtime = "nodejs";
export async function OPTIONS(request: Request) { return new Response(null, { status: 204, headers: commerceCorsHeaders(request.headers.get("origin")) }); }
export async function POST(request: Request) {
  let origin: string | null = null;
  try {
    if (!request.headers.get("origin")) throw new CommerceError("ORIGIN_REQUIRED", "Browser origin required.", 403);
    origin = assertCommerceOrigin(request);
    enforceRateLimit(request, "analytics-ingest", 120);
    const text = await readJsonBody(request);
    if (Buffer.byteLength(JSON.stringify(text),'utf8') > 32768) throw new CommerceError("BATCH_TOO_LARGE", "Telemetry batch too large.", 413);
    const batch = parseAnalyticsBatch(text);
    const { error } = await supabaseAdmin.rpc("ingest_analytics_batch", { p_batch: batch });
    if (error) throw new CommerceError("INGEST_UNAVAILABLE", "Telemetry unavailable.", 503);
    return commerceJson({ ok: true }, 202, origin);
  } catch (error) { return errorResponse(error, origin); }
}
