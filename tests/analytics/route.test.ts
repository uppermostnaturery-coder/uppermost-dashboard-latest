import { beforeEach, describe, expect, it, vi } from "vitest";
const { db, client } = vi.hoisted(() => {
    const db = { tables: {} as Record<string, any[]>, reads: [] as Array<{
            table: string;
            from: number;
            role: string;
        }>, fail: "" };
    const client = (role: "anon" | "service_role") => ({ from: (table: string) => {
            const query: any = { offset: 0, end: 999 };
            for (const method of ["select", "gte", "lte", "order", "in"])
                query[method] = () => query;
            query.range = (from: number, to: number) => { query.offset = from; query.end = to; return query; };
            query.then = (resolve: any) => {
                db.reads.push({ table, from: query.offset, role });
                // Match production grants: analytics belongs to anon; commerce to service_role.
                const denied = table.startsWith("analytics_") ? role !== "anon" : role !== "service_role";
                return Promise.resolve({ data: (db.tables[table] || []).slice(query.offset, query.end + 1), error: denied || db.fail === table ? { message: "private db error" } : null }).then(resolve);
            };
            return query;
        } });
    return { db, client };
});
vi.mock("@/lib/supabaseAdmin", () => ({ supabaseAdmin: client("service_role") }));
vi.mock("@/lib/supabase", () => ({ supabase: client("anon") }));
import { GET } from "../../app/api/analytics/dashboard/route";
describe("read-only dashboard projection", () => {
    beforeEach(() => { db.tables = {}; db.reads = []; db.fail = ""; });
    it("reads beyond the first database page and only returns aggregate facts", async () => {
        const time = new Date().toISOString();
        db.tables.analytics_events = Array.from({ length: 1001 }, (_, id) => ({ id, event_name: "page_view", visitor_id: "visitor-a", session_id: "session-a", page_path: "/experience?t=secret", metadata: {}, created_at: time }));
        db.tables.orders = [{ id: "private-order", status: "CONFIRMED", paid_at: time, total_paise: 700000, order_kind: "INITIAL" }];
        const response = await GET(new Request("https://dashboard.test/api/analytics/dashboard?days=1"));
        const result = await response.json();
        expect(response.status).toBe(200);
        expect(result.metrics.pageviews).toBe(1001);
        expect(result.metrics.purchases).toBe(1);
        expect(db.reads).toContainEqual({ table: "orders", from: 0, role: "service_role" });
        expect(db.reads).toContainEqual({ table: "analytics_visitors", from: 0, role: "anon" });
        expect(db.reads).toContainEqual({ table: "analytics_sessions", from: 0, role: "anon" });
        expect(db.reads).toContainEqual({ table: "analytics_events", from: 1000, role: "anon" });
        expect(JSON.stringify(result)).not.toContain("secret");
        expect(JSON.stringify(result)).not.toContain("private-order");
    });
    it("returns an explicit failure rather than misleading zeroes when a read fails", async () => {
        db.fail = "orders";
        const response = await GET(new Request("https://dashboard.test/api/analytics/dashboard?days=7"));
        expect(response.status).toBe(503);
        expect(JSON.stringify(await response.json())).not.toContain("private db error");
    });
    it("rejects unsupported ranges before querying", async () => {
        expect((await GET(new Request("https://dashboard.test/api/analytics/dashboard?days=365"))).status).toBe(400);
        expect(db.reads).toHaveLength(0);
    });
});
