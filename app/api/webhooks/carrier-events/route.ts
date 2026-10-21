import {withObservation} from "@/lib/observability/server";
import { POST as handleShiprocketWebhook } from "../shiprocket/route";

export const runtime = "nodejs";

export const POST = withObservation("/api/webhooks/carrier-events", handleShiprocketWebhook);
