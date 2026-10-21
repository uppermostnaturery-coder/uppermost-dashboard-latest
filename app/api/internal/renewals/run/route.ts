import {withObservation} from "@/lib/observability/server";
import { handleRenewalCron } from "@/lib/commerce/cron";
import { errorResponse } from "@/lib/commerce/http";

export const runtime = "nodejs";
export const maxDuration = 60;

async function observedPOST(request: Request) {
  try {
    return await handleRenewalCron(request);
  } catch (error) {
    return errorResponse(error, null);
  }
}

export const POST = withObservation("/api/internal/renewals/run", observedPOST);
