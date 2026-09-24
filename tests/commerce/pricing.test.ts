import { describe, expect, it } from "vitest";
import { calculateCartQuote, calculateMandateMaxAmount } from "../../lib/commerce/pricing/calculateCartQuote";
import type { CartLineInput, CatalogVariant, PromotionDefinition } from "../../lib/commerce/types";

const catalog: CatalogVariant[] = [
  { id: "gir-v", product_id: "gir-p", product_code: "GIR_GHEE", product_name: "Gir Cow Ghee", product_family: "GIR", sku: "GIR-1000", variant_name: "1 L", size_label: "1 L", price_paise: 750_000, currency: "INR", weight_grams: 1200, length_cm: 14, breadth_cm: 14, height_cm: 18, inventory_policy: "SUPABASE", inventory_quantity: 20, is_active: true },
  { id: "murrah-v", product_id: "murrah-p", product_code: "MURRAH_GHEE", product_name: "Murrah Buffalo Ghee", product_family: "MURRAH", sku: "MURRAH-1000", variant_name: "1 L", size_label: "1 L", price_paise: 550_000, currency: "INR", weight_grams: 1200, length_cm: 14, breadth_cm: 14, height_cm: 18, inventory_policy: "SUPABASE", inventory_quantity: 20, is_active: true },
];

const promotion = (overrides: Partial<PromotionDefinition> & Pick<PromotionDefinition, "id" | "code" | "label">): PromotionDefinition => ({
  status: "ACTIVE", valid_from: "2026-01-01T00:00:00.000Z", valid_until: null,
  conditions: {}, actions: [], priority: 0, stackable: true, stacking_group: null,
  usage_limit: null, usage_count: 0, version: 1, ...overrides,
});

const pair = promotion({
  id: "pair", code: "THE_PAIR", label: "The Pair", valid_until: "2027-09-24T00:00:00.000Z",
  conditions: { required_product_codes: ["GIR_GHEE", "MURRAH_GHEE"], lifecycle: ["INITIAL", "RENEWAL"] },
  actions: [{ type: "AMOUNT_OFF", amount_paise: 50_000, scope: "CART" }],
});
const subscriber = promotion({
  id: "subscriber", code: "SUBSCRIBER_CYCLE_2", label: "Subscriber benefit",
  conditions: { purchase_modes: ["SUBSCRIPTION"], lifecycle: ["RENEWAL"], minimum_subscription_cycle: 2 },
  actions: [{ type: "AMOUNT_OFF", amount_paise: 50_000, scope: "CART" }],
});

function line(sku: "GIR-1000" | "MURRAH-1000", purchase_mode: "BUY_ONCE" | "SUBSCRIPTION"): CartLineInput {
  return { line_id: `${sku}-${purchase_mode}`, sku, qty: 1, purchase_mode, ...(purchase_mode === "SUBSCRIPTION" ? { interval_days: 30 as const } : {}) };
}
function quote(args: { items: CartLineInput[]; promotions?: PromotionDefinition[]; stage?: "INITIAL" | "RENEWAL"; cycle?: number; now?: string; isNew?: boolean }) {
  return calculateCartQuote({
    items: args.items, catalog, promotions: args.promotions ?? [],
    context: { stage: args.stage ?? "INITIAL", cycle_number: args.cycle ?? 1, now: args.now ?? "2026-09-25T00:00:00.000Z", is_new_subscriber: args.isNew ?? true, is_first_order: (args.stage ?? "INITIAL") === "INITIAL", shipping_country: "IN" },
  });
}

describe("commerce pricing", () => {
  it("prices one Gir BUY_ONCE", () => expect(quote({ items: [line("GIR-1000", "BUY_ONCE")] }).total_paise).toBe(750_000));
  it("prices one Gir SUBSCRIPTION", () => expect(quote({ items: [line("GIR-1000", "SUBSCRIPTION")] }).items[0].interval_days).toBe(30));
  it("applies Pair to initial Gir subscription + Murrah one-time", () => {
    const result = quote({ items: [line("GIR-1000", "SUBSCRIPTION"), line("MURRAH-1000", "BUY_ONCE")], promotions: [pair] });
    expect(result.discount_paise).toBe(50_000); expect(result.total_paise).toBe(1_250_000);
  });
  it("does not carry Pair into Gir-only renewal", () => {
    const result = quote({ items: [line("GIR-1000", "SUBSCRIPTION"), line("MURRAH-1000", "BUY_ONCE")], promotions: [pair], stage: "RENEWAL", cycle: 2 });
    expect(result.items).toHaveLength(1); expect(result.discount_paise).toBe(0);
  });
  it("keeps Pair when Gir and Murrah both renew", () => {
    expect(quote({ items: [line("GIR-1000", "SUBSCRIPTION"), line("MURRAH-1000", "SUBSCRIPTION")], promotions: [pair], stage: "RENEWAL", cycle: 2 }).discount_paise).toBe(50_000);
  });
  it("expires Pair after the configured one-year window", () => {
    const result = quote({ items: [line("GIR-1000", "BUY_ONCE"), line("MURRAH-1000", "BUY_ONCE")], promotions: [pair], now: pair.valid_until! });
    expect(result.discount_paise).toBe(0); expect(result.promotions_rejected[0].reason).toBe("EXPIRED");
  });
  it("expires Early Bird at its exclusive boundary", () => {
    const early = promotion({ id: "early", code: "GIR_EARLY", label: "Early Bird", valid_until: "2026-10-04T18:30:00.000Z", conditions: { skus: ["GIR-1000"], lifecycle: ["INITIAL"] }, actions: [{ type: "AMOUNT_OFF", amount_paise: 50_000, scope: "MATCHING_LINES" }] });
    expect(quote({ items: [line("GIR-1000", "BUY_ONCE")], promotions: [early], now: early.valid_until! }).discount_paise).toBe(0);
  });
  it("starts the subscriber ₹500 benefit at cycle 2", () => {
    const items = [line("GIR-1000", "SUBSCRIPTION")];
    expect(quote({ items, promotions: [subscriber], stage: "INITIAL", cycle: 1 }).discount_paise).toBe(0);
    expect(quote({ items, promotions: [subscriber], stage: "RENEWAL", cycle: 2, isNew: false }).discount_paise).toBe(50_000);
  });
  it("does not leak a new-subscriber future promo to an existing subscriber", () => {
    const future = promotion({ id: "future", code: "FUTURE_NEW_ONLY", label: "New subscriber", conditions: { audience: "NEW_SUBSCRIBERS", lifecycle: ["RENEWAL"] }, actions: [{ type: "AMOUNT_OFF", amount_paise: 60_000 }] });
    expect(quote({ items: [line("GIR-1000", "SUBSCRIPTION")], promotions: [future], stage: "RENEWAL", cycle: 4, isNew: false }).discount_paise).toBe(0);
  });
  it("supports a minimum-cart promotion", () => {
    const minimum = promotion({ id: "minimum", code: "MINIMUM", label: "Minimum cart", conditions: { minimum_cart_value_paise: 1_000_000 }, actions: [{ type: "AMOUNT_OFF", amount_paise: 10_000 }] });
    expect(quote({ items: [line("GIR-1000", "BUY_ONCE")], promotions: [minimum] }).discount_paise).toBe(0);
    expect(quote({ items: [line("GIR-1000", "BUY_ONCE"), line("MURRAH-1000", "BUY_ONCE")], promotions: [minimum] }).discount_paise).toBe(10_000);
  });
  it("records free gift wrap as a non-monetary benefit", () => {
    const wrap = promotion({ id: "wrap", code: "FATHERS_DAY_WRAP", label: "Complimentary gift wrap", conditions: { minimum_cart_value_paise: 500_000 }, actions: [{ type: "FREE_GIFT_WRAP", label: "Gift wrapping" }] });
    const result = quote({ items: [line("GIR-1000", "BUY_ONCE")], promotions: [wrap] });
    expect(result.adjustments).toHaveLength(0); expect(result.benefits[0].benefit_type).toBe("FREE_GIFT_WRAP");
  });
  it("calculates a bounded mandate max", () => {
    expect(calculateMandateMaxAmount(1_250_000, 700_000, 250_000)).toBe(1_250_000);
    expect(calculateMandateMaxAmount(700_000, 800_000, 250_000)).toBe(1_050_000);
  });
});
