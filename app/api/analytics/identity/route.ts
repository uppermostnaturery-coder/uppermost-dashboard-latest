import {withObservation} from "@/lib/observability/server";
import { z } from "zod";
import { supabase } from "@/lib/supabase";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { assertCommerceOrigin, commerceCorsHeaders, commerceJson, enforceRateLimit, errorResponse, readJsonBody, CommerceError } from "@/lib/commerce/http";
export const runtime = "nodejs";
const trackedId = z.string().regex(/^[A-Za-z0-9_-]{8,200}$/);
const schema = z.object({ checkout_session_id: z.string().uuid(), guest_session_id: trackedId, visitor_id: trackedId, session_id: trackedId });
async function observedOPTIONS(request: Request) { return new Response(null, { status: 204, headers: commerceCorsHeaders(request.headers.get("origin")) }); }
async function observedPOST(request: Request) {
    let origin: string | null = null;
    try {
        origin = assertCommerceOrigin(request);
        enforceRateLimit(request, "analytics-identity", 30);
        const input = schema.parse(await readJsonBody(request));
        const { data: checkout, error: checkoutError } = await supabaseAdmin.from("checkout_sessions").select("id,customer_id").eq("id", input.checkout_session_id).eq("guest_session_id", input.guest_session_id).maybeSingle();
        if (checkoutError)
            throw new Error("Checkout attribution read failed");
        if (!checkout)
            throw new CommerceError("ATTRIBUTION_NOT_FOUND", "Checkout could not be linked.", 404);
        const { data: session, error: sessionError } = await supabase.from("analytics_sessions").select("session_id").eq("session_id", input.session_id).eq("visitor_id", input.visitor_id).maybeSingle();
        if (sessionError)
            throw new Error("Analytics session read failed");
        if (!session)
            throw new CommerceError("ATTRIBUTION_NOT_FOUND", "Tracked session could not be linked.", 404);
        // No update privilege is granted: the first association wins and retries do nothing.
        const { error } = await supabaseAdmin.from("analytics_customer_links").upsert({ checkout_session_id: checkout.id, customer_id: checkout.customer_id, visitor_id: input.visitor_id, session_id: input.session_id }, { onConflict: "checkout_session_id", ignoreDuplicates: true });
        if (error)
            throw new Error("Checkout attribution write failed");
        return commerceJson({ ok: true }, 200, origin);
    }
    catch (error) {
        return errorResponse(error, origin);
    }
}

export const OPTIONS = withObservation("/api/analytics/identity", observedOPTIONS);
export const POST = withObservation("/api/analytics/identity", observedPOST);
