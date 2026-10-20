import { describe, expect, it } from "vitest";
import { summarizeDashboard, dashboardWindow, deduplicateEvents, type AnalyticsEvent } from "../../lib/analytics/summary";
const now = new Date("2026-10-21T06:00:00Z");
const event = (id: number, visitor: string, name: string, at: string, text?: string, source?: string, path = "/ghee"): AnalyticsEvent => ({
    id, visitor_id: visitor, session_id: `session-${visitor}`, event_name: name, created_at: at,
    page_path: path, metadata: { text, source },
});
describe("dashboard analytics read model", () => {
    it("uses a rolling 48-hour window and explicit IST calendar days", () => {
        expect(dashboardWindow(2, now).since).toBe("2026-10-19T06:00:00.000Z");
        expect(dashboardWindow(1, now).since).toBe("2026-10-20T18:30:00.000Z");
        expect(dashboardWindow(7, now).since).toBe("2026-10-14T18:30:00.000Z");
    });
    it("merges paired trackers but preserves repeated actions from the same tracker", () => {
        const events = [
            event(1, "a", "button_click", "2026-10-21T05:00:00.000Z", "Pre-order"),
            event(2, "a", "button_click", "2026-10-21T05:00:00.100Z", "Pre-order", "auto_click_detection"),
            event(3, "a", "button_click", "2026-10-21T05:00:00.200Z", "Pre-order"),
        ];
        expect(deduplicateEvents(events)).toHaveLength(2);
    });
    it("does not mistake Buy once, a payment click, or an experience view for a sale", () => {
        const events = [
            event(1, "a", "page_view", "2026-10-21T05:00:00Z"),
            event(2, "a", "buy_now_click", "2026-10-21T05:00:01Z", "Buy once"),
            event(3, "a", "button_click", "2026-10-21T05:00:02Z", "Pay ₹7,000 securely"),
            event(4, "a", "page_view", "2026-10-21T05:00:03Z", undefined, undefined, "/experience?t=private"),
        ];
        const result = summarizeDashboard({ events, visitors: [{ visitor_id: "a", first_seen_at: "2026-10-01T00:00:00Z" }], checkouts: [], orders: [], days: 1, now });
        expect(result.metrics.atc).toBe(0);
        expect(result.metrics.purchases).toBe(0);
        expect(result.funnel.map(s => s.count)).toEqual([1, 1, 0, 0, 0]);
        expect(JSON.stringify(result)).not.toContain("private");
        expect(result.metrics.returningUniqueVisitors).toBe(1);
    });
    it("builds a chronological visitor funnel and keeps actual commerce totals separate", () => {
        const events = [
            event(1, "a", "page_view", "2026-10-21T05:00:00Z"),
            event(2, "a", "button_click", "2026-10-21T05:00:01Z", "Pre-order"),
            event(3, "a", "button_click", "2026-10-21T05:00:02Z", "Pay ₹7,000 securely"),
            event(4, "a", "page_view", "2026-10-21T05:00:03Z", undefined, undefined, "/experience"),
            event(5, "b", "button_click", "2026-10-21T05:00:04Z", "Pay securely"),
            event(6, "b", "page_view", "2026-10-21T05:00:05Z"),
        ];
        const result = summarizeDashboard({ events, visitors: [{ visitor_id: "a", first_seen_at: "2026-10-21T04:00:00Z" }, { visitor_id: "b", first_seen_at: "2026-10-01T00:00:00Z" }],
            checkouts: [{ id: "c1", created_at: "2026-10-21T05:00:00Z" }], orders: [
                { id: "o1", status: "CONFIRMED", paid_at: "2026-10-21T05:00:03Z", total_paise: 700000, order_kind: "INITIAL" },
                { id: "o1", status: "CONFIRMED", paid_at: "2026-10-21T05:00:03Z", total_paise: 700000, order_kind: "INITIAL" },
                { id: "o2", status: "PAYMENT_PENDING", paid_at: null, total_paise: 500000, order_kind: "INITIAL" },
            ], days: 1, now });
        expect(result.funnel.map(s => s.count)).toEqual([2, 2, 1, 1, 1]);
        expect(result.metrics.purchases).toBe(1);
        expect(result.metrics.checkouts).toBe(1);
        expect(result.commerce.revenue_paise).toBe(700000);
        expect(result.metrics.newVisitors).toBe(1);
        expect(result.metrics.returningUniqueVisitors).toBe(1);
        expect(result.charts.purchases.values.reduce((a, b) => a + b, 0)).toBe(1);
    });
    it("ignores out-of-window and future records rather than shifting graph totals", () => {
        const result = summarizeDashboard({ events: [event(1, "a", "page_view", "2026-10-20T18:29:59Z"), event(2, "b", "page_view", "2026-10-21T07:00:00Z")], visitors: [], checkouts: [], orders: [], days: 1, now });
        expect(result.metrics.visitors).toBe(0);
        expect(result.charts.pageviews.values.reduce((a, b) => a + b, 0)).toBe(0);
    });
    it("counts paired semantic product and buy events once while preserving genuine repeats", () => {
        const events = [
            event(1, "a", "page_view", "2026-10-21T05:00:00Z"),
            event(2, "a", "product_view", "2026-10-21T05:00:00.100Z"),
            event(3, "a", "button_click", "2026-10-21T05:00:02Z", "Buy"),
            event(4, "a", "buy_now_click", "2026-10-21T05:00:02.100Z", "Buy"),
            event(5, "a", "button_click", "2026-10-21T05:00:04Z", "Pre-order"),
        ];
        const result = summarizeDashboard({ events, visitors: [], checkouts: [], orders: [], days: 1, now });
        expect(result.productViews).toBe(1);
        expect(result.metrics.atc).toBe(2);
        for (const key of ["productViews", "atc"] as const)
            expect(result.charts[key].values.reduce((a, b) => a + b, 0)).toBe(key === "atc" ? 2 : 1);
    });
    it("keeps graph sums consistent for every grouping and strips referrer query secrets", () => {
        const events = [event(1, "a", "page_view", "2026-10-20T19:00:00Z"), event(2, "a", "page_view", "2026-10-21T06:00:00Z")];
        for (const group of ["hour", "day", "week", "month"] as const) {
            const result = summarizeDashboard({ events, visitors: [], sessions: [{ session_id: "session-a", device_type: "Mobile", browser: "Safari", os: "iOS", utm_source: null, utm_medium: null, utm_campaign: null, referrer: "https://example.com/a?t=private" }], checkouts: [], orders: [], days: 1, now, group });
            expect(result.charts.pageviews.values.reduce((a, b) => a + b, 0)).toBe(result.metrics.pageviews);
            expect(result.dimensions.devices).toEqual([{ label: "Mobile", count: 1 }]);
            expect(JSON.stringify(result)).not.toContain("private");
        }
    });
});
