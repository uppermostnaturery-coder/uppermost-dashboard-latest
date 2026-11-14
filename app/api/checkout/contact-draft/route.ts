import { withObservation } from "@/lib/observability/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { contactDraftSchema, contactDraftBinding, projectContactDraft } from "@/lib/commerce/contactDrafts";
import { assertCommerceOrigin, commerceCorsHeaders, commerceJson, enforceRateLimit, errorResponse, readJsonBody } from "@/lib/commerce/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function observedOPTIONS(request: Request) {
  return new Response(null, { status: 204, headers: commerceCorsHeaders(request.headers.get("origin"), "POST, OPTIONS") });
}
async function observedPOST(request: Request) {
  let origin: string | null = null;
  try {
    origin = assertCommerceOrigin(request);
    enforceRateLimit(request, "checkout-contact-draft", 90);
    const input = contactDraftSchema.parse(await readJsonBody(request));
    const pepper = process.env.COMMERCE_TOKEN_PEPPER;
    if (!pepper) throw new Error("Contact draft binding is not configured.");
    const binding = contactDraftBinding(input.guest_session_id, input.draft_token, input.phone, pepper);
    if (input.action === "read") {
      const result = await supabaseAdmin.from("checkout_contact_drafts").select("customer,shipping_address,updated_at")
        .eq("browser_hash", binding.browser_hash).eq("phone_hash", binding.phone_hash).gt("expires_at", new Date().toISOString()).maybeSingle();
      if (result.error) throw new Error("Contact draft is temporarily unavailable.");
      return commerceJson({ ok: true, source: "RETARGETING_DRAFT", draft: result.data ? projectContactDraft(result.data) : null }, 200, origin, "POST, OPTIONS");
    }
    // Canonical lookup phone and saved contact must refer to the same unverified draft.
    if (contactDraftBinding(input.guest_session_id, input.draft_token, input.customer.phone, pepper).phone_hash !== binding.phone_hash) {
      return commerceJson({ ok: false, error: { code: "DRAFT_PHONE_MISMATCH", message: "The draft phone number changed. Please try again." } }, 400, origin);
    }
    const result = await supabaseAdmin.rpc("save_checkout_contact_draft", {
      p_browser_hash: binding.browser_hash, p_phone_hash: binding.phone_hash,
      p_customer: input.customer, p_address: input.shipping_address, p_revision: input.revision,
    });
    if (result.error) throw new Error("Contact draft could not be saved.");
    return commerceJson({ ok: true, saved: true }, 200, origin, "POST, OPTIONS");
  } catch (error) { return errorResponse(error, origin); }
}
export const OPTIONS = withObservation("/api/checkout/contact-draft", observedOPTIONS);
export const POST = withObservation("/api/checkout/contact-draft", observedPOST);
