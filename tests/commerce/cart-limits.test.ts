import { describe, expect, it } from "vitest";
import { calculateCartQuote } from "../../lib/commerce/pricing/calculateCartQuote";
import type { CatalogVariant } from "../../lib/commerce/types";
const base: CatalogVariant = { id: "v", product_id: "p", product_code: "GIR_GHEE", product_name: "Gir Cow Ghee", product_family: "GIR", sku: "GIR-1000", variant_name: "1 L", size_label: "1 L", price_paise: 750000, currency: "INR", weight_grams: 1200, length_cm: 14, breadth_cm: 14, height_cm: 18, inventory_policy: "SUPABASE", is_active: true, product_max_cart_quantity: 1 };
function quote(skus: string[]) { return calculateCartQuote({ items: skus.map((sku, i) => ({ line_id: "line-" + i, sku, qty: 1, purchase_mode: "BUY_ONCE" as const })), catalog: [base, { ...base, id: "half", sku: "GIR-500", size_label: "500 ml" }], promotions: [], context: { stage: "INITIAL", cycle_number: 1, now: "2026-10-31T00:00:00.000Z", shipping_country: "IN" } }); }
describe("catalog cart limits", () => {
  it("rejects a product limit bypassed by choosing two sizes", () => { expect(() => quote(["GIR-1000", "GIR-500"])).toThrow(/quantity limit/i); });
  it("rejects a product limit bypassed by splitting the same SKU over lines", () => { expect(() => quote(["GIR-1000", "GIR-1000"])).toThrow(/quantity limit/i); });
  it("keeps the permitted single jar payable", () => { expect(quote(["GIR-1000"]).total_paise).toBe(750000); });
});
