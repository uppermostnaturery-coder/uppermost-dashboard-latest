import { commerceJson, errorResponse } from "@/lib/commerce/http";
import { runRenewals } from "@/lib/commerce/renewals";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const secret = process.env.COMMERCE_CRON_SECRET;
    const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    if (!secret || supplied !== secret) {
      return commerceJson({ ok: false, error: { code: "UNAUTHORIZED", message: "Unauthorized." } }, 401, null);
    }
    const result = await runRenewals(20);
    return commerceJson({ ok: true, ...result }, 200, null);
  } catch (error) {
    return errorResponse(error, null);
  }
}
