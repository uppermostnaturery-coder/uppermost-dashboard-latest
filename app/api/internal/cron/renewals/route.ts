import {withObservation} from "@/lib/observability/server";
import { handleRenewalCron } from "@/lib/commerce/cron";
import { errorResponse } from "@/lib/commerce/http";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

async function observedGET(request: Request) {
  try {
    return await handleRenewalCron(request);
  } catch (error) {
    return errorResponse(error, null);
  }
}

export const GET = withObservation("/api/internal/cron/renewals", observedGET);
