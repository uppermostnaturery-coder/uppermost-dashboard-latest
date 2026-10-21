import {withObservation} from "@/lib/observability/server";
import { NextResponse } from "next/server";
import { orderOverview, visitorOverview, visitorJourney } from "@/lib/analytics/journeyData";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" };
async function observedGET(request: Request) {
    const url = new URL(request.url), view = url.searchParams.get("view") || "orders", visitorId = url.searchParams.get("visitor_id"), days = Number(url.searchParams.get("days") || 7), history = url.searchParams.get("history") || "all", offset = Number(url.searchParams.get("offset") || 0);
    if (!["orders", "visitors"].includes(view) || ![1, 2, 7, 30, 90].includes(days) || !["all", "7", "30", "90"].includes(history) || !Number.isInteger(offset) || offset < 0 || offset > 100000 || (visitorId && !/^[A-Za-z0-9_-]{8,200}$/.test(visitorId)))
        return NextResponse.json({ error: "Invalid journey filters" }, { status: 400, headers });
    try {
        const body = visitorId ? await visitorJourney(visitorId, history, offset) : view === "visitors" ? await visitorOverview(days) : await orderOverview();
        return NextResponse.json(body || { error: "Visitor not found" }, { status: body ? 200 : 404, headers });
    }
    catch (error) {
        console.error("Journey projection unavailable:", error instanceof Error ? error.message : "Unknown error");
        return NextResponse.json({ error: "Orders or visitor history could not be loaded. Please retry." }, { status: 503, headers });
    }
}

export const GET = withObservation("/api/analytics/journeys", observedGET);
