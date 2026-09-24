import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireCustomer } from "@/lib/commerce/customerAuth";
import {
  assertCommerceOrigin,
  commerceCorsHeaders,
  commerceJson,
  enforceRateLimit,
  errorResponse,
  readJsonBody,
} from "@/lib/commerce/http";
import { addressCreateSchema } from "@/lib/commerce/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function OPTIONS(request: Request) {
  return new Response(null, { status: 204, headers: commerceCorsHeaders(request.headers.get("origin"), "GET, POST, OPTIONS") });
}

export async function GET(request: Request) {
  let origin: string | null = null;
  try {
    origin = assertCommerceOrigin(request);
    enforceRateLimit(request, "customer-addresses-get", 60);
    const { customerId } = await requireCustomer(request);
    const result = await supabaseAdmin.from("customer_addresses")
      .select("id, label, name, phone, line1, line2, landmark, city, state, postal_code, country, is_default, created_at")
      .eq("customer_id", customerId)
      .order("is_default", { ascending: false })
      .order("created_at", { ascending: false });
    if (result.error) throw new Error(`Address lookup failed: ${result.error.message}`);
    return commerceJson({ ok: true, addresses: result.data ?? [] }, 200, origin, "GET, POST, OPTIONS");
  } catch (error) {
    return errorResponse(error, origin);
  }
}

export async function POST(request: Request) {
  let origin: string | null = null;
  try {
    origin = assertCommerceOrigin(request);
    enforceRateLimit(request, "customer-addresses-post", 20);
    const { customerId } = await requireCustomer(request);
    const input = addressCreateSchema.parse(await readJsonBody(request));
    if (input.is_default) {
      await supabaseAdmin.from("customer_addresses").update({ is_default: false }).eq("customer_id", customerId);
    }
    const result = await supabaseAdmin.from("customer_addresses").insert({
      customer_id: customerId,
      ...input,
      is_default: input.is_default ?? false,
    }).select("id, label, name, phone, line1, line2, landmark, city, state, postal_code, country, is_default, created_at").single();
    if (result.error || !result.data) throw new Error(`Address creation failed: ${result.error?.message}`);
    return commerceJson({ ok: true, address: result.data }, 201, origin, "GET, POST, OPTIONS");
  } catch (error) {
    return errorResponse(error, origin);
  }
}
