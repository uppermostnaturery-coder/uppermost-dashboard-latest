export type AnalyticsEvent = {
    id: number | string;
    event_name: string;
    visitor_id: string | null;
    session_id: string | null;
    page_path: string | null;
    created_at: string;
    metadata?: {
        text?: string | null;
        source?: string | null;
        action_type?: string | null;
    } | null;
};
export type VisitorFact = {
    visitor_id: string;
    first_seen_at: string | null;
};
export type CheckoutFact = {
    id: string;
    created_at: string;
};
export type OrderFact = {
    id: string;
    status: string;
    paid_at: string | null;
    total_paise: number;
    order_kind: string;
};
export type SessionFact = {
    session_id: string;
    device_type: string | null;
    browser: string | null;
    os: string | null;
    utm_source: string | null;
    utm_medium: string | null;
    utm_campaign: string | null;
    referrer: string | null;
};
export type GraphGroup = "hour" | "day" | "week" | "month";
const HOUR = 3600000, DAY = HOUR * 24, IST = HOUR * 5.5;
export const FUNNEL_NOTE = "Unique visitors progressing in order within the selected range: site activity → product → order intent → payment intent → order journey. Clicks indicate intent, not a successful checkout or payment. Journey views are not purchases; confirmed sales are counted separately from paid commerce orders.";
export function dashboardWindow(days: number, now = new Date()) {
    if (![1, 2, 7, 30, 90].includes(days))
        throw new Error("Unsupported dashboard range");
    const midnight = Math.floor((now.getTime() + IST) / DAY) * DAY - IST;
    return { since: new Date(days === 2 ? now.getTime() - 2 * DAY : midnight - (days - 1) * DAY).toISOString(), until: now.toISOString() };
}
export function safePath(path: string | null) { return (path || "/").split(/[?#]/)[0]; }
function label(event: AnalyticsEvent) { return (event.metadata?.text || "").replace(/\s+/g, " ").trim().toLowerCase(); }
function identity(event: AnalyticsEvent) { return event.visitor_id || (event.session_id ? `session:${event.session_id}` : `event:${event.id}`); }
/** Only paired, different trackers are merged. Rapid repeated same-tracker actions survive. */
export function deduplicateEvents(events: AnalyticsEvent[]) {
    const groups = new Map<string, Array<{
        at: number;
        sources: Set<string>;
    }>>();
    const result: AnalyticsEvent[] = [];
    for (const event of [...events].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))) {
        const key = JSON.stringify([identity(event), event.event_name, safePath(event.page_path), label(event)]);
        const source = event.metadata?.source || event.metadata?.action_type || "legacy";
        const at = Date.parse(event.created_at);
        const recent = (groups.get(key) || []).filter(group => at - group.at <= 1000);
        const pair = recent.find(group => !group.sources.has(source));
        if (pair)
            pair.sources.add(source);
        else {
            recent.push({ at, sources: new Set([source]) });
            result.push(event);
        }
        groups.set(key, recent);
    }
    return result;
}
export function isProductView(event: AnalyticsEvent) {
    return event.event_name === "product_view" || (event.event_name === "page_view" && /^\/(ghee|productnew|products?)(\/[^/]+)?\/?$/.test(safePath(event.page_path)) && !/^\/ghee\//.test(safePath(event.page_path)));
}
export function isOrderIntent(event: AnalyticsEvent) {
    const text = label(event);
    if (/^(buy once|subscribe|subscribe & save)/.test(text) || /remove/.test(text))
        return false;
    if (event.event_name === "add_to_cart")
        return true;
    return ["button_click", "buy_now_click"].includes(event.event_name) && /^(pre[- ]?order|buy|buy now|add to (order|cart)|(?:\d+ )?your order)$/.test(text);
}
export function isPaymentIntent(event: AnalyticsEvent) {
    return ["checkout_started", "checkout_open"].includes(event.event_name) || (event.event_name === "button_click" && /^pay(?: ₹[\d,.]+)? securely$/.test(label(event)));
}
// A product page view and its explicit product event describe the same visit.
// Likewise, legacy Buy events accompany a generic button event for the same click.
function semanticActions(events: AnalyticsEvent[], predicate: (event: AnalyticsEvent) => boolean) {
    const normalized = events.filter(predicate).map(e => ({ ...e, event_name: "action", metadata: { ...e.metadata, source: `${e.event_name}:${e.metadata?.source || e.metadata?.action_type || "legacy"}`, text: predicate === isProductView ? "" : label(e) } }));
    return deduplicateEvents(normalized);
}
function bucketKey(at: number, group: GraphGroup, start: number) {
    if (group === "hour")
        return Math.floor((at - start) / HOUR);
    if (group === "day")
        return Math.floor((at + IST) / DAY);
    if (group === "week")
        return Math.floor((at - start) / (7 * DAY));
    const d = new Date(at + IST);
    return d.getUTCFullYear() * 12 + d.getUTCMonth();
}
function series(records: Array<{
    created_at: string;
}>, window: ReturnType<typeof dashboardWindow>, group: GraphGroup) {
    const start = Date.parse(window.since), end = Date.parse(window.until);
    const buckets = new Map<number, {
        label: string;
        count: number;
    }>();
    const format = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", ...(group === "hour" ? { hour: "2-digit", minute: "2-digit", hour12: false } : {}) });
    for (let at = start; at <= end; at += group === "hour" ? HOUR : DAY) {
        const key = bucketKey(at, group, start);
        if (!buckets.has(key))
            buckets.set(key, { label: group === "month" ? new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", month: "short", year: "numeric" }).format(new Date(at)) : format.format(new Date(at)), count: 0 });
    }
    for (const record of records) {
        const at = Date.parse(record.created_at);
        if (at < start || at > end)
            continue;
        const bucket = buckets.get(bucketKey(at, group, start));
        if (bucket)
            bucket.count++;
    }
    return { labels: [...buckets.values()].map(b => b.label), values: [...buckets.values()].map(b => b.count) };
}
export function summarizeDashboard(args: {
    events: AnalyticsEvent[];
    sessions?: SessionFact[];
    visitors: VisitorFact[];
    checkouts: CheckoutFact[];
    orders: OrderFact[];
    days: number;
    now?: Date;
    group?: GraphGroup;
}) {
    const window = dashboardWindow(args.days, args.now), start = Date.parse(window.since), end = Date.parse(window.until);
    const within = (value: string) => Date.parse(value) >= start && Date.parse(value) <= end;
    const raw = args.events.filter(e => within(e.created_at));
    const events = deduplicateEvents(raw);
    const people = new Set(events.map(e => e.visitor_id).filter((id): id is string => !!id));
    const firstSeen = new Map(args.visitors.map(v => [v.visitor_id, v.first_seen_at]));
    let newVisitors = 0, returningUniqueVisitors = 0;
    for (const visitor of people) {
        const first = firstSeen.get(visitor);
        if (first && Date.parse(first) < start)
            returningUniqueVisitors++;
        else if (first && within(first))
            newVisitors++;
    }
    const product = semanticActions(events, isProductView), intent = semanticActions(events, isOrderIntent);
    const checkouts = [...new Map(args.checkouts.filter(c => within(c.created_at)).map(c => [c.id, c])).values()];
    const orders = [...new Map(args.orders.filter(o => o.status === "CONFIRMED" && o.paid_at && within(o.paid_at)).map(o => [o.id, o])).values()];
    const visitorStage = new Map<string, number>();
    const counts = [0, 0, 0, 0, 0];
    for (const event of events) {
        if (!event.visitor_id)
            continue;
        let stage = visitorStage.get(event.visitor_id);
        if (stage === undefined) {
            stage = 0;
            counts[0]++;
        }
        if (stage === 0 && isProductView(event)) {
            stage = 1;
            counts[1]++;
        }
        else if (stage === 1 && isOrderIntent(event)) {
            stage = 2;
            counts[2]++;
        }
        else if (stage === 2 && isPaymentIntent(event)) {
            stage = 3;
            counts[3]++;
        }
        else if (stage === 3 && event.event_name === "page_view" && safePath(event.page_path) === "/experience") {
            stage = 4;
            counts[4]++;
        }
        visitorStage.set(event.visitor_id, stage);
    }
    const names = ["Visitors", "Product viewed", "Order intent", "Payment intent", "Order journey"];
    const colors = ["#c98a4b", "#8fae6b", "#8aa6a3", "#d9a441", "#c4633f"];
    const group = args.group || (args.days <= 2 ? "hour" : "day");
    const chart = (records: Array<{
        created_at: string;
    }>) => series(records, window, group);
    const pages = new Map<string, {
        path: string;
        views: number;
        events: number;
        visitors: Set<string>;
    }>();
    for (const e of events) {
        const path = safePath(e.page_path);
        const p = pages.get(path) || { path, views: 0, events: 0, visitors: new Set<string>() };
        p.events++;
        if (e.event_name === "page_view")
            p.views++;
        if (e.visitor_id)
            p.visitors.add(e.visitor_id);
        pages.set(path, p);
    }
    const activeSessionIds = new Set(events.map(e => e.session_id));
    const sessions = (args.sessions || []).filter(s => activeSessionIds.has(s.session_id));
    const dimension = (key: keyof SessionFact) => {
        const counts = new Map<string, number>();
        for (const session of sessions) {
            let value = session[key] || "Unknown";
            if (key === "referrer" && value !== "Unknown") {
                try {
                    value = new URL(value).hostname;
                }
                catch {
                    value = "Unknown";
                }
            }
            counts.set(value, (counts.get(value) || 0) + 1);
        }
        return [...counts].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count).slice(0, 8);
    };
    return {
        dimensions: { devices: dimension("device_type"), browsers: dimension("browser"), os: dimension("os"), sources: dimension("utm_source"), mediums: dimension("utm_medium"), campaigns: dimension("utm_campaign"), referrers: dimension("referrer") },
        window, group,
        metrics: { visitors: people.size, newVisitors, returningUniqueVisitors, unknownVisitors: people.size - newVisitors - returningUniqueVisitors, sessions: new Set(events.map(e => e.session_id).filter(Boolean)).size, pageviews: events.filter(e => e.event_name === "page_view").length, events: events.length, atc: intent.length, checkouts: checkouts.length, purchases: orders.length },
        productViews: product.length,
        commerce: { revenue_paise: orders.reduce((sum, o) => sum + Number(o.total_paise), 0), initial_orders: orders.filter(o => o.order_kind === "INITIAL").length, renewal_orders: orders.filter(o => o.order_kind === "RENEWAL").length },
        funnel: names.map((name, i) => ({ name, count: counts[i], color: colors[i] })), funnelNote: FUNNEL_NOTE,
        quality: { raw_events: raw.length, duplicate_events: raw.length - events.length, purchase_events: events.filter(e => e.event_name.startsWith("purchase")).length },
        pages: [...pages.values()].map(p => ({ path: p.path, views: p.views, events: p.events, visitors: p.visitors.size })).sort((a, b) => b.views - a.views),
        charts: { pageviews: chart(events.filter(e => e.event_name === "page_view")), productViews: chart(product), atc: chart(intent), checkouts: chart(checkouts), purchases: chart(orders.map(o => ({ created_at: o.paid_at! }))), buttonClicks: chart(events.filter(e => e.event_name === "button_click")), events: chart(events), buyNow: chart(events.filter(e => e.event_name === "buy_now_click" && isOrderIntent(e))), scroll25: chart(events.filter(e => e.event_name === "scroll_depth_25")), scroll50: chart(events.filter(e => e.event_name === "scroll_depth_50")), scroll75: chart(events.filter(e => e.event_name === "scroll_depth_75")), scroll100: chart(events.filter(e => e.event_name === "scroll_depth_100")) },
        scrollDepth: [25, 50, 75, 100].map(pct => ({ pct: `${pct}%`, count: events.filter(e => e.event_name === `scroll_depth_${pct}`).length })),
    };
}
export type DashboardSummary = ReturnType<typeof summarizeDashboard>;
