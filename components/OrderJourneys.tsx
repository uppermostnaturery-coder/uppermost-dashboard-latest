"use client";
import { useEffect, useState, useRef } from "react";
import type { OrdersOverview, VisitorsOverview, VisitorJourney } from "@/lib/analytics/journeyData";
type ReadState<T> = {
    url: string | null;
    data: T | null;
    error: string | null;
    loading: boolean;
};
function useRead<T>(url: string | null, poll = true) {
    const [state, setState] = useState<ReadState<T>>({ url: null, data: null, error: null, loading: true });
    useEffect(() => {
        if (!url)
            return;
        let active = true, controller: AbortController | null = null;
        setState({ url, data: null, error: null, loading: true });
        const load = async () => { controller?.abort(); const current = new AbortController(); controller = current; try {
            const response = await fetch(url, { cache: "no-store", signal: current.signal });
            if (!response.ok)
                throw new Error("This view could not be loaded. Please retry.");
            const data: T = await response.json();
            if (active && controller === current)
                setState({ url, data, error: null, loading: false });
        }
        catch (error) {
            if (active && controller === current && !current.signal.aborted)
                setState(previous => ({ ...previous, url, error: error instanceof Error ? error.message : "Unavailable", loading: false }));
        } };
        load();
        const timer = poll ? setInterval(load, 30000) : null;
        return () => { active = false; controller?.abort(); if (timer)
            clearInterval(timer); };
    }, [url, poll]);
    return state.url === url ? state : { url, data: null, error: null, loading: !!url };
}
const money = (paise: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(paise / 100);
const time = (value: string | null) => value ? new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value)) + " IST" : "Not recorded";
const alias = (id: string) => `Browser ${id.slice(-8)}`;
const button: React.CSSProperties = { background: "var(--bg3)", color: "var(--text)", border: "1px solid var(--border2)", borderRadius: 8, padding: "10px 14px", minHeight: 44, cursor: "pointer", fontSize: 12 };
const box: React.CSSProperties = { border: "1px solid var(--border)", background: "var(--card)", borderRadius: 12, padding: 18, minWidth: 0 };
function Notice({ text, error = false }: {
    text: string;
    error?: boolean;
}) { return <p role={error ? "alert" : "status"} style={{ fontSize: 13, lineHeight: 1.6, color: error ? "var(--red)" : "var(--muted)" }}>{text}</p>; }
export function OrderHighlights({ onOpen }: {
    onOpen: () => void;
}) {
    const { data, error, loading } = useRead<OrdersOverview>("/api/analytics/journeys?view=orders");
    return <section aria-label="Confirmed order highlights" data-order-highlights style={{ ...box, borderColor: "var(--accent)", display: "flex", gap: 18, justifyContent: "space-between", alignItems: "center", flexWrap: "wrap" }}>
  <div><div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".1em", color: "var(--muted)" }}>Confirmed orders · All time</div>
   <div style={{ fontSize: 30, fontWeight: 750, margin: "6px 0", color: "var(--green)" }}>{error ? "Unavailable" : loading ? "Loading…" : `${data?.confirmed_orders ?? 0} confirmed ${(data?.confirmed_orders ?? 0) === 1 ? "order" : "orders"}`}</div>
   {error ? <Notice text={error} error/> : data?.orders_error ? <Notice text={data.orders_error} error/> : data?.orders[0] ? <div style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.7 }}>Latest: <strong style={{ color: "var(--text)" }}>{data.orders[0].reference} · {money(data.orders[0].total_paise)}</strong><br />{time(data.orders[0].paid_at)}</div> : !loading ? <Notice text="No confirmed paid orders are recorded yet."/> : null}
  </div><button style={button} onClick={onOpen}>View orders &amp; visitor journeys →</button>
 </section>;
}
function OrderCard({ order, onVisitor }: {
    order: OrdersOverview["orders"][number];
    onVisitor?: (id: string) => void;
}) {
    return <article style={box} data-confirmed-order>
  <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}><div><strong>{order.reference}</strong><div style={{ fontSize: 11, color: "var(--green)", marginTop: 6 }}>Payment confirmed · {order.kind === "RENEWAL" ? "Renewal" : "Initial order"}</div></div><strong style={{ fontSize: 23 }}>{money(order.total_paise)}</strong></div>
  <p style={{ fontSize: 12, color: "var(--muted)" }}>Paid {time(order.paid_at)}</p>
  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,220px),1fr))", gap: 16 }}>
   <div style={{ fontSize: 12, lineHeight: 1.9 }}><strong>Customer details (masked)</strong><div>{order.customer.name}</div><div>{order.customer.email || "Email not recorded"}</div><div>{order.customer.phone || "Phone not recorded"}</div><div>{[order.customer.city, order.customer.state].filter(Boolean).join(", ") || "Location not recorded"}</div></div>
   <div style={{ fontSize: 12, lineHeight: 1.9 }}><strong>Purchased items</strong><div style={{color:"var(--muted)",fontSize:11}}>Item snapshots before order-level adjustments</div>{order.items.map((item, i) => <div key={i}>{item.quantity} × {item.product} · {item.variant}<br /><span style={{ color: "var(--muted)" }}>{item.purchase_mode === "SUBSCRIPTION" ? "Subscription" : "Buy once"} · {money(item.total_paise)}</span></div>)}</div>
   {order.pricing && <div style={{fontSize:12,lineHeight:1.9}}><strong>Stored order totals</strong><div>Subtotal {money(order.pricing.subtotal_paise)}</div><div>Discount −{money(order.pricing.discount_paise)}</div><div>Shipping {money(order.pricing.shipping_paise)}</div><div>Tax {money(order.pricing.tax_paise)}</div><strong>Paid {money(order.total_paise)}</strong></div>}
  </div>
  <div style={{ borderTop: "1px solid var(--border)", marginTop: 14, paddingTop: 14, fontSize: 12, color: "var(--muted)", lineHeight: 1.7 }}>{order.attribution} · {order.recorded_visits === null ? "Visit history unlinked" : `${order.recorded_visits} recorded visits across ${order.visitor_ids.length} associated browser(s)`}
   <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>{onVisitor && order.visitor_ids.map(id => <button key={id} style={button} onClick={() => onVisitor(id)}>View {alias(id)} journey →</button>)}</div>
  </div>
 </article>;
}
function Journey({ visitorId, onBack }: {
    visitorId: string;
    onBack: () => void;
}) {
    const [history, setHistory] = useState("all"), [extra, setExtra] = useState<VisitorJourney["timeline"]>([]), [next, setNext] = useState<number | null | undefined>(undefined), [moreError, setMoreError] = useState<string | null>(null), [moreLoading, setMoreLoading] = useState(false);
    const url = `/api/analytics/journeys?visitor_id=${encodeURIComponent(visitorId)}&history=${history}`;
    const { data, error, loading } = useRead<VisitorJourney>(url, false);
    const requestVersion = useRef(0);
    useEffect(() => { requestVersion.current++; setExtra([]); setNext(undefined); setMoreError(null); setMoreLoading(false); return () => { requestVersion.current++; }; }, [url]);
    const loadMore = async () => { if (!data)
        return; const offset = next === undefined ? data.next_offset : next; if (offset === null)
        return; const version = requestVersion.current; setMoreLoading(true); setMoreError(null); try {
        const response = await fetch(`${url}&offset=${offset}`, { cache: "no-store" });
        if (!response.ok)
            throw new Error("More history could not be loaded.");
        const result: VisitorJourney = await response.json();
        if (version !== requestVersion.current)
            return;
        setExtra(previous => [...previous, ...result.timeline]);
        setNext(result.next_offset);
    }
    catch (error) {
        if (version === requestVersion.current)
            setMoreError(error instanceof Error ? error.message : "History unavailable");
    }
    finally {
        if (version === requestVersion.current)
            setMoreLoading(false);
    } };
    return <section style={{ display: "grid", gap: 16, minWidth: 0 }}>
  <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}><button style={button} onClick={onBack}>← Orders &amp; visitors</button><label style={{ fontSize: 12, color: "var(--muted)" }}>Journey history <select style={{ ...button, marginLeft: 8 }} value={history} onChange={e => setHistory(e.target.value)}><option value="all">All retained history</option><option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option></select></label></div>
  {error ? <Notice text={error} error/> : loading ? <Notice text="Loading recorded visitor history…"/> : data ? <>
   <div style={box}><h2 style={{ fontSize: 20, margin: "0 0 10px" }}>{alias(visitorId)}</h2><strong style={{ color: "var(--accent)" }}>{data.recorded_visits} recorded visits (tracker sessions)</strong><p style={{ fontSize: 12, lineHeight: 1.8, color: "var(--muted)" }}>First seen: {time(data.visitor.first_seen_at)}<br />Last seen: {time(data.visitor.last_seen_at)}<br />{data.visitor.device_type || "Unknown device"} · {data.visitor.browser || "Unknown browser"}</p><Notice text={data.identity_note}/></div>
   <Notice text={`Showing the latest ${data.orders.length} of ${data.order_count} associated confirmed orders. All associated confirmation timestamps remain in the flow history.`}/>
   {data.orders.map(order => <OrderCard key={order.reference} order={order}/>)}
   <div style={box}><h3 style={{ fontSize: 15, marginTop: 0 }}>Observed website flow</h3><p style={{ fontSize: 12, color: "var(--muted)" }}>Old anonymous events remain attached to this browser. Heartbeats and repeated tracker records are omitted from this reading view. Order confirmation timestamps come from commerce records.</p>
    {data.timeline_total === 0 ? <Notice text="No navigation or action events were recorded in this history window."/> : <ol style={{ listStyle: "none", margin: 0, padding: 0 }}>{[...data.timeline, ...extra].map((event, i) => <li key={`${event.id}-${i}`} style={{ borderLeft: "2px solid var(--border2)", padding: "0 0 22px 16px", overflowWrap: "anywhere" }}><div style={{ fontSize: 11, color: "var(--muted)" }}>{time(event.at)} · {event.session_id ? `Session ${event.session_id.slice(-8)}` : "Commerce record"}</div><div style={{ fontSize: 13, fontWeight: event.event === "order_confirmed" ? 750 : 500, color: event.event === "order_confirmed" ? "var(--green)" : "var(--text)", marginTop: 5 }}>{event.label}</div><div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>{event.page}</div></li>)}</ol>}
    <div style={{ fontSize: 12, color: "var(--muted)" }}>Showing {data.timeline.length + extra.length} of {data.timeline_total} recorded flow events</div>
    {(next === undefined ? data.next_offset : next) !== null && <button style={{ ...button, marginTop: 12 }} disabled={moreLoading} onClick={loadMore}>{moreLoading ? "Loading…" : "Load more events"}</button>}{moreError && <Notice text={moreError} error/>}
   </div>
  </> : null}
 </section>;
}
export default function OrderJourneys({ days }: {
    days: number;
}) {
    const [tab, setTab] = useState<"orders" | "visitors">("orders"), [visitorId, setVisitorId] = useState<string | null>(null);
    const orders = useRead<OrdersOverview>("/api/analytics/journeys?view=orders");
    const visitors = useRead<VisitorsOverview>(tab === "visitors" && !visitorId ? `/api/analytics/journeys?view=visitors&days=${days}` : null);
    if (visitorId)
        return <Journey key={visitorId} visitorId={visitorId} onBack={() => setVisitorId(null)}/>;
    return <section style={{ display: "grid", gap: 16, minWidth: 0 }}><div><h1 style={{ fontSize: 23, margin: "0 0 8px" }}>Orders &amp; visitor journeys</h1><p style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.7 }}>Confirmed orders are authoritative payment records. Browser activity is observed analytics. Contact details are masked because this dashboard is public.</p></div>
  <div style={{ display: "flex", gap: 8 }}><button style={{ ...button, borderColor: tab === "orders" ? "var(--accent)" : "var(--border)" }} onClick={() => setTab("orders")}>Confirmed orders ({orders.data?.confirmed_orders ?? "—"})</button><button style={{ ...button, borderColor: tab === "visitors" ? "var(--accent)" : "var(--border)" }} onClick={() => setTab("visitors")}>Visitor journeys</button></div>
  {tab === "orders" ? (orders.error ? <Notice text={orders.error} error/> : orders.loading ? <Notice text="Loading confirmed orders…"/> : orders.data ? <><Notice text={`${orders.data.confirmed_orders} confirmed order(s) across all time. Showing the latest ${orders.data.orders.length}, up to ${orders.data.list_limit}. This list is independent of the dashboard's activity date filter.`}/>{orders.data.orders_error && <Notice text={orders.data.orders_error} error/>}{orders.data.orders.length ? orders.data.orders.map(order => <OrderCard key={order.reference} order={order} onVisitor={setVisitorId}/>) : !orders.data.orders_error ? <Notice text="No confirmed paid orders are recorded yet."/> : null}</> : null) : (visitors.error ? <Notice text={visitors.error} error/> : visitors.loading ? <Notice text="Loading recently active visitors…"/> : visitors.data ? <><Notice text={`Showing ${visitors.data.visitors.length} of ${visitors.data.total} recently active browsers in the selected activity range. Visit counts cover retained session history. Open a browser to see its chronological flow.`}/><div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,260px),1fr))", gap: 12 }}>{visitors.data.visitors.map(visitor => <button key={visitor.visitor_id} style={{ ...box, textAlign: "left", cursor: "pointer", color: "var(--text)" }} onClick={() => setVisitorId(visitor.visitor_id)}><strong>{alias(visitor.visitor_id)}</strong><div style={{ fontSize: 12, lineHeight: 1.9, color: "var(--muted)", marginTop: 7 }}>{visitor.recorded_visits} recorded visits<br />{visitor.device_type || "Unknown device"} · {visitor.browser || "Unknown browser"}<br />Last seen {time(visitor.last_seen_at)}</div><div style={{ fontSize: 12, color: "var(--accent)", marginTop: 8 }}>Open journey →</div></button>)}</div></> : null)}
 </section>;
}
