import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { dashboardWindow, summarizeDashboard, type AnalyticsEvent, type CheckoutFact, type OrderFact, type VisitorFact, type SessionFact, type GraphGroup } from "@/lib/analytics/summary";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Read-only dashboard projection. No customer details, tokens, provider payloads,
// or order identifiers are sent to the browser, and no commerce row is changed.
async function readAll<T>(table: string, columns: string, dateColumn: string, since: string, until: string): Promise<T[]> {
    const result: T[] = [];
    for (let offset = 0; offset < 100000; offset += 1000) {
        const { data, error } = await supabaseAdmin.from(table).select(columns).gte(dateColumn, since).lte(dateColumn, until).order(dateColumn, { ascending: true }).order("id", { ascending: true }).range(offset, offset + 999);
        if (error)
            throw new Error(`Dashboard ${table} read failed`);
        result.push(...(data || []) as unknown as T[]);
        if (!data || data.length < 1000)
            return result;
    }
    throw new Error("Dashboard range exceeds the safe read limit; select a shorter range");
}
export async function GET(request: Request) {
    const url = new URL(request.url), days = Number(url.searchParams.get("days") || 7), group = url.searchParams.get("group");
    if (![1, 2, 7, 30, 90].includes(days) || (group && !['hour', 'day', 'week', 'month'].includes(group)))
        return NextResponse.json({ error: "Invalid dashboard range or grouping" }, { status: 400 });
    const now = new Date(), window = dashboardWindow(days, now);
    try {
        const [events, checkouts, orders] = await Promise.all([
            readAll<AnalyticsEvent>("analytics_events", "id,event_name,page_path,visitor_id,session_id,metadata,created_at", "created_at", window.since, window.until),
            readAll<CheckoutFact>("checkout_sessions", "id,created_at", "created_at", window.since, window.until),
            readAll<OrderFact>("orders", "id,status,paid_at,total_paise,order_kind", "paid_at", window.since, window.until),
        ]);
        const visitorIds = [...new Set(events.map(e => e.visitor_id).filter((v): v is string => !!v))];
        const visitors: VisitorFact[] = [];
        for (let from = 0; from < visitorIds.length; from += 100) {
            const { data, error } = await supabaseAdmin.from("analytics_visitors").select("visitor_id,first_seen_at").in("visitor_id", visitorIds.slice(from, from + 100));
            if (error)
                throw new Error("Dashboard visitor read failed");
            visitors.push(...(data || []));
        }
        const sessionIds = [...new Set(events.map(e => e.session_id).filter((v): v is string => !!v))];
        const sessions: SessionFact[] = [];
        for (let from = 0; from < sessionIds.length; from += 100) {
            const { data, error } = await supabaseAdmin.from("analytics_sessions").select("session_id,device_type,browser,os,utm_source,utm_medium,utm_campaign,referrer").in("session_id", sessionIds.slice(from, from + 100));
            if (error)
                throw new Error("Dashboard session read failed");
            sessions.push(...(data || []));
        }
        return NextResponse.json(summarizeDashboard({ events, visitors, sessions, checkouts, orders, days, now, group: (group as GraphGroup | null) || undefined }), { headers: { "Cache-Control": "no-store" } });
    }
    catch (error) {
        console.error("Dashboard summary unavailable:", error instanceof Error ? error.message : "Unknown error");
        return NextResponse.json({ error: "Analytics could not be loaded. Please retry or select a shorter range." }, { status: 503, headers: { "Cache-Control": "no-store" } });
    }
}
