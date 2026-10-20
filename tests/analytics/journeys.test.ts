import { describe, it, expect } from "vitest";
import { legacyVisitorLinks, publicOrder, journeyTimeline } from "../../lib/analytics/journeys";
const event = (id: number, visitor: string, at: string, path: string, url?: string) => ({ id, visitor_id: visitor, session_id: `s_${visitor}`, created_at: at, page_path: path, page_url: url, event_name: "page_view", metadata: {} });
describe("order and visitor journey projection", () => {
    it("links historical browsers by exact production journey token, never prefix or unrelated host", () => {
        const checkouts = [{ id: "checkout-private", experience_token: "exp_exact" }];
        const views = [event(1, "v_real", "2026-10-19T15:00:00Z", "/experience", "https://www.uppermost.store/experience?t=exp_exact"), event(2, "v_prefix", "2026-10-19T15:01:00Z", "/experience", "https://www.uppermost.store/experience?t=exp_exact_extra"), event(3, "v_other", "2026-10-19T15:02:00Z", "/experience?t=exp_exact", "https://example.com/experience?t=exp_exact")];
        expect(legacyVisitorLinks(views, checkouts).get("checkout-private")).toEqual(["v_real"]);
    });
    it("keeps old anonymous activity on the same visitor without rewriting events or exposing tokens", () => {
        const old = event(1, "v_real", "2026-10-01T01:00:00Z", "/ghee");
        const paid = event(2, "v_real", "2026-10-19T15:00:00Z", "/experience?t=exp_exact");
        const timeline = journeyTimeline([paid, old, { ...old, id: 3, event_name: "heartbeat" }]);
        expect(timeline.map(e => e.at)).toEqual([old.created_at, paid.created_at]);
        expect(JSON.stringify(timeline)).not.toContain("exp_exact");
    });
    it("projects a public order without full customer contact, address, checkout identifiers or tokens", () => {
        const result = publicOrder({ id: "order-private", order_number: "UPM-001", customer_id: "customer-private", checkout_session_id: "checkout-private", paid_at: "2026-10-19T15:00:00Z", total_paise: 700000, order_kind: "INITIAL", address_snapshot: { line1: "579D Secret Street", postal_code: "122001", city: "Gurgaon", state: "Haryana" } }, { name: "Ankur Secret", email: "ankur.secret@example.com", phone: "+919999996461" }, [], ["v_real"]);
        const text = JSON.stringify(result);
        for (const secret of ["Ankur Secret", "ankur.secret@example.com", "+919999996461", "579D Secret Street", "122001", "checkout-private", "customer-private", "order-private"])
            expect(text).not.toContain(secret);
        expect(result.reference).toBe("UPM-001");
        expect(result.total_paise).toBe(700000);
        expect(result.customer.city).toBe("Gurgaon");
        expect(result.visitor_ids).toEqual(["v_real"]);
    });
    it("tolerates malformed client text without leaking arbitrary metadata into the flow", () => {
        const bad = { ...event(9, "v_real", "2026-10-19T15:00:00Z", "/ghee"), event_name: "button_click", metadata: { text: { private: "secret" } } } as any;
        expect(journeyTimeline([bad])[0].label).toBe("Button clicked");
        expect(JSON.stringify(journeyTimeline([bad]))).not.toContain("secret");
    });
});
