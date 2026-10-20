import { supabase } from "@/lib/supabase";
import { supabaseAdmin as admin } from "@/lib/supabaseAdmin";
import { analyticsRows, analyticsBatches } from "./read";
import { dashboardWindow } from "./summary";
import { journeyTimeline, legacyVisitorLinks, productionJourneyToken, publicOrder, type JourneyOrder, type JourneyCustomer, type JourneyItem, type JourneyEvent } from "./journeys";
type Link = {
    customer_id: string;
    visitor_id: string;
    checkout_session_id: string;
};
type Visitor = {
    visitor_id: string;
    first_seen_at: string | null;
    last_seen_at: string | null;
    device_type: string | null;
    browser: string | null;
};
type Session = {
    session_id: string;
    visitor_id: string;
};
const orderColumns = "id,order_number,customer_id,checkout_session_id,paid_at,total_paise,subtotal_paise,discount_paise,shipping_paise,tax_paise,order_kind,address_snapshot,created_at";
async function check<T>(result: {
    data: T | null;
    error: unknown;
}, label: string): Promise<T> { if (result.error || result.data === null)
    throw new Error(`${label} unavailable`); return result.data; }
async function confirmedOrders(customerIds?: string[], allHistory = false) {
    if (customerIds?.length === 0)
        return [];
    const query = () => { let base = admin.from("orders").select(orderColumns).eq("status", "CONFIRMED").not("paid_at", "is", null); if (customerIds)
        base = base.in("customer_id", customerIds); return base.order("paid_at", { ascending: false }).order("id", { ascending: false }); };
    return allHistory ? analyticsRows<JourneyOrder>((from, to) => query().range(from, to), "Associated order history") : await check(await query().limit(50), "Orders") as unknown as JourneyOrder[];
}
async function sessionsFor(ids: string[]) { return analyticsBatches<Session>(ids, (batch, from, to) => supabase.from("analytics_sessions").select("session_id,visitor_id").in("visitor_id", batch).order("session_id").range(from, to), "Recorded visits"); }
async function projectOrders(orders: JourneyOrder[]) {
    if (!orders.length)
        return [];
    const customerIds = [...new Set(orders.map(o => o.customer_id))], orderIds = orders.map(o => o.id), checkoutIds = orders.map(o => o.checkout_session_id).filter((id): id is string => !!id);
    const [customers, items, checkouts, links] = await Promise.all([
        analyticsBatches<JourneyCustomer & {
            id: string;
        }>(customerIds, (ids, from, to) => admin.from("customers").select("id,name,email,phone").in("id", ids).order("id").range(from, to), "Customer projection"),
        analyticsBatches<JourneyItem>(orderIds, (ids, from, to) => admin.from("order_items").select("id,order_id,product_name,variant_name,quantity,purchase_mode,line_total_paise").in("order_id", ids).order("id").range(from, to), "Order items"),
        analyticsBatches<{
            id: string;
            experience_token: string | null;
        }>(checkoutIds, (ids, from, to) => admin.from("checkout_sessions").select("id,experience_token").in("id", ids).order("id").range(from, to), "Order attribution"),
        analyticsBatches<Link>(customerIds, (ids, from, to) => admin.from("analytics_customer_links").select("customer_id,visitor_id,checkout_session_id").in("customer_id", ids).order("checkout_session_id").range(from, to), "Browser links"),
    ]);
    const views: JourneyEvent[] = [];
    // Narrow at the database boundary; exact token parsing below rejects wildcard/prefix hits.
    const tokens = checkouts.map(c => c.experience_token).filter((token): token is string => !!token && /^[A-Za-z0-9_-]{4,200}$/.test(token));
    for (let start = 0; start < tokens.length; start += 20) {
        const batch = tokens.slice(start, start + 20), filter = batch.flatMap(token => [`page_url.like.*t=${token}*`, `page_path.like.*t=${token}*`]).join(",");
        views.push(...await analyticsRows<JourneyEvent>((from, to) => supabase.from("analytics_events").select("id,visitor_id,session_id,event_name,page_path,page_url,created_at").eq("event_name", "page_view").like("page_path", "/experience%").or(filter).order("created_at").order("id").range(from, to), "Historical order views"));
    }
    const legacy = legacyVisitorLinks(views, checkouts), customersById = new Map(customers.map(c => [c.id, c]));
    const results = orders.map(o => {
        const direct = links.filter(l => l.checkout_session_id === o.checkout_session_id).map(l => l.visitor_id), observed = legacy.get(o.checkout_session_id || "") || [];
        return { ...publicOrder(o, customersById.get(o.customer_id), items, [...direct, ...observed]), attribution: direct.length ? "Checkout browser association" : observed.length ? "Observed order-journey browser" : "No browser link recorded" };
    });
    const sessions = await sessionsFor([...new Set(results.flatMap(o => o.visitor_ids))]);
    return results.map(o => ({ ...o, recorded_visits: o.visitor_ids.length ? new Set(sessions.filter(s => o.visitor_ids.includes(s.visitor_id)).map(s => s.session_id)).size : null }));
}
export async function orderOverview() {
    const [countResult, orders] = await Promise.all([admin.from("orders").select("id", { count: "exact", head: true }).eq("status", "CONFIRMED").not("paid_at", "is", null), confirmedOrders()]);
    if (countResult.error)
        throw new Error("Confirmed order count unavailable");
    try {
        return { confirmed_orders: countResult.count ?? 0, scope: "All time", list_limit: 50, orders: await projectOrders(orders), orders_error: null as string | null };
    }
    catch (error) {
        console.error("Order detail projection unavailable:", error instanceof Error ? error.message : "Unknown error");
        return { confirmed_orders: countResult.count ?? 0, scope: "All time", list_limit: 50, orders: [], orders_error: "Order details are temporarily unavailable; the confirmed count remains valid." };
    }
}
export async function visitorOverview(days: number) {
    const window = dashboardWindow(days);
    const result = await supabase.from("analytics_visitors").select("visitor_id,first_seen_at,last_seen_at,device_type,browser", { count: "exact" }).gte("last_seen_at", window.since).lte("last_seen_at", window.until).order("last_seen_at", { ascending: false }).order("visitor_id").limit(100);
    const visitors = await check(result, "Visitors") as Visitor[], sessions = await sessionsFor(visitors.map(v => v.visitor_id));
    return { window, total: result.count ?? visitors.length, list_limit: 100, visitors: visitors.map(v => ({ ...v, recorded_visits: sessions.filter(s => s.visitor_id === v.visitor_id).length })) };
}
export async function visitorJourney(visitorId: string, history: string, offset: number) {
    const now = new Date(), window = history === "all" ? { since: "1970-01-01T00:00:00.000Z", until: now.toISOString() } : dashboardWindow(Number(history), now);
    const [visitorResult, events, sessions, links, views] = await Promise.all([
        supabase.from("analytics_visitors").select("visitor_id,first_seen_at,last_seen_at,device_type,browser").eq("visitor_id", visitorId).maybeSingle(),
        analyticsRows<JourneyEvent>((from, to) => supabase.from("analytics_events").select("id,event_name,visitor_id,session_id,page_path,created_at,metadata").eq("visitor_id", visitorId).gte("created_at", window.since).lte("created_at", window.until).order("created_at").order("id").range(from, to), "Visitor history"),
        sessionsFor([visitorId]),
        analyticsRows<Link>((from, to) => admin.from("analytics_customer_links").select("customer_id,visitor_id,checkout_session_id").eq("visitor_id", visitorId).order("checkout_session_id").range(from, to), "Visitor links"),
        analyticsRows<JourneyEvent>((from, to) => supabase.from("analytics_events").select("id,event_name,visitor_id,session_id,page_path,page_url,created_at").eq("visitor_id", visitorId).eq("event_name", "page_view").like("page_path", "/experience%").order("created_at").order("id").range(from, to), "Observed order views"),
    ]);
    if (visitorResult.error)
        throw new Error("Visitor unavailable");
    if (!visitorResult.data)
        return null;
    const tokens = [...new Set(views.map(productionJourneyToken).filter((token): token is string => !!token))];
    const checkouts = await analyticsBatches<{
        customer_id: string;
        id: string;
    }>(tokens, (ids, from, to) => admin.from("checkout_sessions").select("id,customer_id").in("experience_token", ids).order("id").range(from, to), "Historical checkout associations");
    const customerIds = [...new Set([...links.map(l => l.customer_id), ...checkouts.map(c => c.customer_id)])];
    const orders = await projectOrders(await confirmedOrders(customerIds, true));
    const associatedOrders = orders.filter(o => o.visitor_ids.includes(visitorId));
    const timeline = [...journeyTimeline(events), ...associatedOrders.filter(o => Date.parse(o.paid_at) >= Date.parse(window.since) && Date.parse(o.paid_at) <= Date.parse(window.until)).map(o => ({ id: `order:${o.reference}`, at: o.paid_at, session_id: null, page: "/experience", event: "order_confirmed", label: `Confirmed order ${o.reference} (associated browser)` }))].sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || a.id.localeCompare(b.id));
    return { visitor: visitorResult.data, recorded_visits: new Set(sessions.map(s => s.session_id)).size, window, history, orders: associatedOrders.slice(0, 50), order_count: associatedOrders.length, orders_limit: 50, timeline: timeline.slice(offset, offset + 200), timeline_total: timeline.length, next_offset: offset + 200 < timeline.length ? offset + 200 : null, identity_note: "Browser associations are analytics evidence, not verified customer identity. Shared links or devices may associate several browsers or customers. Visits are retained tracker sessions; activity can be incomplete." };
}
export type OrdersOverview = Awaited<ReturnType<typeof orderOverview>>;
export type VisitorsOverview = Awaited<ReturnType<typeof visitorOverview>>;
export type VisitorJourney = NonNullable<Awaited<ReturnType<typeof visitorJourney>>>;
