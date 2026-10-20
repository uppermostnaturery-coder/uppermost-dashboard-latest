import { deduplicateEvents, safePath, isOrderIntent, isPaymentIntent, type AnalyticsEvent } from "./summary";
export type JourneyEvent = AnalyticsEvent & {
    page_url?: string | null;
};
export type JourneyOrder = {
    id: string;
    order_number: string;
    customer_id: string;
    checkout_session_id: string | null;
    paid_at: string;
    total_paise: number;
    subtotal_paise?: number;
    discount_paise?: number;
    shipping_paise?: number;
    tax_paise?: number;
    order_kind: string;
    address_snapshot: Record<string, unknown>;
};
export type JourneyCustomer = {
    name: string | null;
    email: string | null;
    phone: string | null;
};
export type JourneyItem = {
    order_id: string;
    product_name: string;
    variant_name: string;
    quantity: number;
    purchase_mode: string;
    line_total_paise: number;
};
export function productionJourneyToken(event: JourneyEvent) {
    const value = event.page_url || event.page_path;
    if (!value)
        return null;
    try {
        const url = new URL(value, "https://www.uppermost.store");
        return ["https://uppermost.store", "https://www.uppermost.store"].includes(url.origin) && url.pathname === "/experience" && url.searchParams.getAll("t").length === 1 ? url.searchParams.get("t") : null;
    }
    catch {
        return null;
    }
}
export function legacyVisitorLinks(events: JourneyEvent[], checkouts: Array<{
    id: string;
    experience_token: string | null;
}>) {
    const byToken = new Map(checkouts.filter(c => !!c.experience_token).map(c => [c.experience_token!, c.id]));
    const links = new Map<string, Set<string>>();
    for (const event of events) {
        if (!event.visitor_id)
            continue;
        const token = productionJourneyToken(event), id = token ? byToken.get(token) : null;
        if (id) {
            const visitors = links.get(id) || new Set<string>();
            visitors.add(event.visitor_id);
            links.set(id, visitors);
        }
    }
    return new Map([...links].map(([id, visitors]) => [id, [...visitors]]));
}
function clean(value: unknown) { return typeof value === "string" ? value.trim().slice(0, 100) : ""; }
export function publicOrder(order: JourneyOrder, customer: JourneyCustomer | undefined, items: JourneyItem[], visitorIds: string[]) {
    const email = clean(customer?.email), at = email.lastIndexOf("@"), digits = clean(customer?.phone).replace(/\D/g, "");
    return { reference: order.order_number, paid_at: order.paid_at, total_paise: Number(order.total_paise), kind: order.order_kind, pricing: order.subtotal_paise == null ? null : {subtotal_paise:Number(order.subtotal_paise),discount_paise:Number(order.discount_paise??0),shipping_paise:Number(order.shipping_paise??0),tax_paise:Number(order.tax_paise??0)},
        customer: { name: customer?.name ? `${customer.name.trim().charAt(0)}***` : "Customer", email: at > 0 ? `${email.charAt(0)}***${email.slice(at)}` : null, phone: digits.length >= 4 ? `••••${digits.slice(-4)}` : null, city: clean(order.address_snapshot?.city) || null, state: clean(order.address_snapshot?.state) || null },
        items: items.filter(i => i.order_id === order.id).map(i => ({ product: i.product_name, variant: i.variant_name, quantity: i.quantity, purchase_mode: i.purchase_mode, total_paise: Number(i.line_total_paise) })), visitor_ids: [...new Set(visitorIds)] };
}
export function journeyTimeline(events: JourneyEvent[]) {
    const allowed = new Set(["page_view", "product_view", "button_click", "buy_now_click", "add_to_cart", "checkout_started", "checkout_open", "purchase", "purchase_completed"]);
    return deduplicateEvents(events).filter(e => allowed.has(e.event_name)).map(e => ({ id: String(e.id), at: e.created_at, session_id: e.session_id, page: safePath(e.page_path), event: e.event_name, label: e.event_name === "page_view" ? "Page viewed" : e.event_name === "product_view" ? "Product viewed" : isPaymentIntent(e) ? "Payment intent" : isOrderIntent(e) ? "Order intent" : e.event_name.startsWith("purchase") ? "Browser purchase event (unverified)" : "Button clicked" }));
}
export type PublicOrder = ReturnType<typeof publicOrder>;
export type TimelineItem = ReturnType<typeof journeyTimeline>[number];
