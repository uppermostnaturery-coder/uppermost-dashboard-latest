import { handleRenewalCron } from "@/lib/commerce/cron";
import { errorResponse } from "@/lib/commerce/http";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    return await handleRenewalCron(request);
  } catch (error) {
    return errorResponse(error, null);
  }
}
