import { beforeEach, describe, expect, it, vi } from "vitest";
const { db, client } = vi.hoisted(() => {
    const db = { tables: {} as Record<string, any[]>, writes: [] as any[], fail: "" };
    const client = (role: string) => ({ from: (table: string) => {
            let filters: Array<(row: any) => boolean> = [], start = 0, end = 999, head = false, one = false, values: any = null, sorting: Array<[
                string,
                boolean
            ]> = [];
            const query: any = { select(_columns: string, options?: any) { head = !!options?.head; return query; }, eq(key: string, value: any) { filters.push(r => r[key] === value); return query; }, in(key: string, values: any[]) { filters.push(r => values.includes(r[key])); return query; }, gte(key: string, value: string) { filters.push(r => r[key] >= value); return query; }, lte(key: string, value: string) { filters.push(r => r[key] <= value); return query; }, or(value: string) { const tokens = [...value.matchAll(/t=([A-Za-z0-9_-]+)\*/g)].map(m => m[1]); filters.push(r => tokens.some(t => String(r.page_url || r.page_path || "").includes("t=" + t))); return query; }, like(key: string, value: string) { filters.push(r => String(r[key] || "").startsWith(value.replace(/%$/, ""))); return query; }, not(key: string, _op: string, value: any) { filters.push(r => r[key] !== value); return query; }, order(key: string, options?: any) { sorting.push([key, options?.ascending !== false]); return query; }, range(from: number, to: number) { start = from; end = to; return query; }, limit(limit: number) { end = limit - 1; return query; }, maybeSingle() { one = true; return query; }, upsert(data: any, options: any) { values = { data, options }; return query; }, then(resolve: any, reject: any) {
                    const publicTables = ["analytics_events", "analytics_visitors", "analytics_sessions"];
                    const denied = publicTables.includes(table) ? role !== "anon" : role !== "service_role";
                    if (denied || db.fail === table)
                        return Promise.resolve({ data: null, error: { message: "private failure" } }).then(resolve, reject);
                    if (values) {
                        db.writes.push(values);
                        const rows = db.tables[table] ??= [];
                        if (!rows.some(r => r.checkout_session_id === values.data.checkout_session_id))
                            rows.push(values.data);
                    }
                    const rows = (db.tables[table] || []).filter(r => filters.every(f => f(r))).sort((a, b) => { for (const [key, ascending] of sorting) {
                        const result = String(a[key]).localeCompare(String(b[key]));
                        if (result)
                            return ascending ? result : -result;
                    } return 0; });
                    return Promise.resolve({ data: head ? null : one ? rows[0] || null : rows.slice(start, end + 1), count: rows.length, error: null }).then(resolve, reject);
                } };
            return query;
        } });
    return { db, client };
});
vi.mock("@/lib/supabase", () => ({ supabase: client("anon") }));
vi.mock("@/lib/supabaseAdmin", () => ({ supabaseAdmin: client("service_role") }));
import { GET } from "../../app/api/analytics/journeys/route";
import { POST } from "../../app/api/analytics/identity/route";
const checkout = "11111111-1111-4111-8111-111111111111", visitor = "v_historical_123", session = "s_historical_123";
const post = (body: any) => new Request("https://dashboard.test/api/analytics/identity", { method: "POST", headers: { "Content-Type": "application/json", Origin: "https://www.uppermost.store" }, body: JSON.stringify(body) });
beforeEach(() => {
    db.fail = "";
    db.writes = [];
    db.tables = {
        orders: [{ id: "order-private", order_number: "UPM-001", customer_id: "customer-private", checkout_session_id: checkout, status: "CONFIRMED", order_kind: "INITIAL", paid_at: "2026-10-19T15:00:00Z", created_at: "2026-10-19T14:58:00Z", total_paise: 700000, subtotal_paise:750000,discount_paise:50000,shipping_paise:0,tax_paise:0,address_snapshot: { line1: "579D Secret Street", postal_code: "122001", city: "Gurgaon", state: "Haryana" } }],
        customers: [{ id: "customer-private", name: "Ankur Secret", email: "ankur.secret@example.com", phone: "+919999996461" }],
        checkout_sessions: [{ id: checkout, guest_session_id: "gs_expected_123", customer_id: "customer-private", experience_token: "exp_private" }],
        order_items: [{ id: "item-private", order_id: "order-private", product_name: "Gir Ghee", variant_name: "1 L", quantity: 1, purchase_mode: "BUY_ONCE", line_total_paise: 700000 }],
        analytics_customer_links: [], analytics_visitors: [{ visitor_id: visitor, first_seen_at: "2026-10-01T00:00:00Z", last_seen_at: "2026-10-19T15:01:00Z", device_type: "mobile", browser: "Safari" }],
        analytics_sessions: [{ session_id: session, visitor_id: visitor }, { session_id: "s_old_visit", visitor_id: visitor }],
        analytics_events: [{ id: 1, event_name: "page_view", visitor_id: visitor, session_id: "s_old_visit", page_path: "/ghee", created_at: "2026-10-01T01:00:00Z", metadata: {} }, { id: 2, event_name: "page_view", visitor_id: visitor, session_id: session, page_path: "/experience", page_url: "https://www.uppermost.store/experience?t=exp_private", created_at: "2026-10-19T15:01:00Z", metadata: {} }],
    };
});
describe("public order and journey API boundaries", () => {
    it("highlights the all-time confirmed order even outside today's date range, with masked fields only", async () => {
        const response = await GET(new Request("https://dashboard.test/api/analytics/journeys?view=orders&days=1")), body = await response.json();
        expect(response.status).toBe(200);
        expect(body.confirmed_orders).toBe(1);
        expect(body.orders[0].reference).toBe("UPM-001");
        expect(body.orders[0].visitor_ids).toEqual([visitor]);
        expect(body.orders[0].recorded_visits).toBe(2);
        expect(body.orders[0].pricing).toEqual({subtotal_paise:750000,discount_paise:50000,shipping_paise:0,tax_paise:0});
        const text = JSON.stringify(body);
        for (const secret of ["Ankur Secret", "ankur.secret@example.com", "+919999996461", "579D Secret Street", "122001", checkout, "exp_private", "customer-private", "order-private"])
            expect(text).not.toContain(secret);
    });
    it("maps the previous anonymous visits and authoritative order timestamp without exposing journey tokens", async () => {
        const response = await GET(new Request(`https://dashboard.test/api/analytics/journeys?visitor_id=${visitor}&history=all`)), body = await response.json();
        expect(response.status).toBe(200);
        expect(body.recorded_visits).toBe(2);
        expect(body.timeline.map((e: any) => e.event)).toEqual(["page_view", "order_confirmed", "page_view"]);
        expect(body.timeline[0].at).toBe("2026-10-01T01:00:00Z");
        expect(JSON.stringify(body)).not.toContain("exp_private");
    });
    it("paginates flow history beyond the first database page", async () => {
        db.tables.analytics_events.push(...Array.from({ length: 1001 }, (_, i) => ({ id: i + 10, event_name: "page_view", visitor_id: visitor, session_id: session, page_path: "/ghee", created_at: "2026-10-19T14:00:00Z", metadata: {} })));
        const body = await (await GET(new Request(`https://dashboard.test/api/analytics/journeys?visitor_id=${visitor}&offset=1000`))).json();
        expect(body.timeline_total).toBe(1004);
        expect(body.timeline).toHaveLength(4);
        expect(body.next_offset).toBe(null);
    });
    it("does not attach an abandoned checkout browser to another paid order for the same customer", async () => {
        db.tables.analytics_customer_links.push({ checkout_session_id: "unpaid-other-checkout", customer_id: "customer-private", visitor_id: visitor, session_id: session });
        db.tables.analytics_events = db.tables.analytics_events.filter(e => e.id !== 2);
        const body = await (await GET(new Request(`https://dashboard.test/api/analytics/journeys?visitor_id=${visitor}`))).json();
        expect(body.orders).toEqual([]);
        expect(body.timeline.every((e: any) => e.event !== "order_confirmed")).toBe(true);
    });
    it("retains older associated confirmations beyond the latest-50 order card limit", async () => {
        const base = db.tables.orders[0];
        db.tables.orders = Array.from({ length: 51 }, (_, i) => ({ ...base, id: `order-${i}`, order_number: `UPM-${i}` }));
        const body = await (await GET(new Request(`https://dashboard.test/api/analytics/journeys?visitor_id=${visitor}`))).json();
        expect(body.order_count).toBe(51);
        expect(body.orders).toHaveLength(50);
        expect(body.timeline.filter((e: any) => e.event === "order_confirmed")).toHaveLength(51);
    });
    it("keeps the authoritative all-time count visible if attribution details fail", async () => {
        db.fail = "analytics_customer_links";
        const body = await (await GET(new Request("https://dashboard.test/api/analytics/journeys"))).json();
        expect(body.confirmed_orders).toBe(1);
        expect(body.orders_error).toBeTruthy();
    });
    it("does not fabricate orders when an anonymous browser has no association", async () => {
        db.tables.analytics_events = db.tables.analytics_events.filter(e => e.id !== 2);
        const body = await (await GET(new Request(`https://dashboard.test/api/analytics/journeys?visitor_id=${visitor}`))).json();
        expect(body.orders).toEqual([]);
        expect(body.timeline.every((e: any) => e.event !== "order_confirmed")).toBe(true);
    });
    it("returns explicit query failures and rejects invalid filters", async () => {
        expect((await GET(new Request("https://dashboard.test/api/analytics/journeys?visitor_id=bad!"))).status).toBe(400);
        db.fail = "orders";
        expect((await GET(new Request("https://dashboard.test/api/analytics/journeys"))).status).toBe(503);
    });
});
describe("best-effort checkout attribution", () => {
    it("derives customer only from the verified checkout and preserves the first association on replay", async () => {
        const input = { checkout_session_id: checkout, guest_session_id: "gs_expected_123", visitor_id: visitor, session_id: session, customer_id: "forged-customer" };
        expect((await POST(post(input))).status).toBe(200);
        expect((await POST(post(input))).status).toBe(200);
        expect(db.tables.analytics_customer_links).toHaveLength(1);
        expect(db.tables.analytics_customer_links[0].customer_id).toBe("customer-private");
        expect(db.writes[0].options.ignoreDuplicates).toBe(true);
    });
    it("rejects a guest mismatch without writing or leaking checkout details", async () => {
        expect((await POST(post({ checkout_session_id: checkout, guest_session_id: "gs_wrong_123", visitor_id: visitor, session_id: session }))).status).toBe(404);
        expect(db.writes).toHaveLength(0);
    });
    it("rejects unrelated browser/session identifiers", async () => {
        expect((await POST(post({ checkout_session_id: checkout, guest_session_id: "gs_expected_123", visitor_id: "v_other_browser", session_id: session }))).status).toBe(404);
        expect(db.writes).toHaveLength(0);
    });
});
