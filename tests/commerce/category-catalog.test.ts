import { beforeAll, describe, expect, it } from "vitest";
import type { CatalogVariant } from "../../lib/commerce/types";

let catalog: typeof import("../../lib/commerce/publicCatalog");
beforeAll(async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-key";
  catalog = await import("../../lib/commerce/publicCatalog");
});

const products = [
  { id: "gir", code: "GIR_GHEE", name: "Gir Cow Ghee", product_family: "GIR", is_active: true },
  { id: "community", code: "COMMUNITY_COW_GHEE", name: "A2 Desi Cow Ghee", product_family: "COMMUNITY_COW", is_active: true,
    description: "From partner farms we know by name.", metadata: { listing: { category_id: "ghee", tags: ["A2 Tested", "Bilona"], images: [{ url: "https://example.com/cow.webp", alt: "Desi cow", kind: "photograph" }], max_cart_quantity: 2, display_order: 3 }, private_supplier: "must not leak" } },
  { id: "oil", code: "COOKING_MUSTARD_OIL", name: "Cooking Mustard Oil", product_family: "COOKING_MUSTARD", is_active: false,
    metadata: { listing: { category_id: "mustard-oil", tags: ["Wood Kohlu"] } } },
];
const variants: CatalogVariant[] = [{ id: "community-1l", product_id: "community", product_code: "COMMUNITY_COW_GHEE", product_name: "A2 Desi Cow Ghee", product_family: "COMMUNITY_COW", sku: "COMMUNITY-COW-1000", variant_name: "1 L", size_label: "1 L", price_paise: 410000, currency: "INR", weight_grams: 1200, length_cm: 14, breadth_cm: 14, height_cm: 18, inventory_policy: "SUPABASE", inventory_quantity: 1, is_active: true }];

describe("category catalog", () => {
  it("allowlists integer per-litre display metadata without changing checkout prices or the unfiltered contract", () => {
    const oil = { ...products[2], metadata: { listing: { category_id: "mustard-oil", unit_price_per_litre_paise: { "MUSTARD-COOKING-5000": 85000, bad: -1, "private note": 100, FRACTION: 1.5, STRING: "100", INFINITE: Infinity } } } };
    const response = catalog.buildPublicCatalogResponse({ products: [oil], variants: [], releases: [], promotions: [], categoryId: "mustard-oil" });
    expect(response.products[0].listing?.unit_price_per_litre_paise).toEqual({ "MUSTARD-COOKING-5000": 85000 });
    const legacy = catalog.buildPublicCatalogResponse({ products: [oil], variants: [], releases: [], promotions: [] });
    expect(JSON.stringify(legacy)).not.toContain("unit_price_per_litre_paise");
  });
  it("returns both ghee tiers with card data, stock-aware limits and no private metadata", () => {
    const response = catalog.buildPublicCatalogResponse({ products, variants, releases: [], promotions: [], categoryId: "ghee" });
    expect(response.category_id).toBe("ghee");
    expect(response.products.map(p => p.name)).toEqual(["Gir Cow Ghee", "A2 Desi Cow Ghee"]);
    const community = response.products[1];
    expect(community.listing).toMatchObject({ category_id: "ghee", description: "From partner farms we know by name.", tags: ["A2 Tested", "Bilona"], max_cart_quantity: 2 });
    expect(community.variants[0]).toMatchObject({ max_cart_quantity: 1, pricing: { current_display_price_paise: 410000 }, sellable: true });
    expect(JSON.stringify(response)).not.toContain("private_supplier");
    expect(response.products[0].listing?.badge).toBe("~30 jars a week");
    expect(response.products[0].listing?.images[0].url).toContain("framerusercontent.com");
  });
  it("keeps the unfiltered Buybox response free of listing-only fields", () => {
    const response = catalog.buildPublicCatalogResponse({ products, variants, releases: [], promotions: [] });
    expect(response).not.toHaveProperty("category_id");
    for (const product of response.products) {
      expect(product).not.toHaveProperty("listing");
      expect(product).not.toHaveProperty("product_id");
      for (const variant of product.variants) expect(variant).not.toHaveProperty("max_cart_quantity");
    }
  });
  it("returns an empty category without falling back to another category", () => {
    expect(catalog.buildPublicCatalogResponse({ products, variants, releases: [], promotions: [], categoryId: "pickles" }).products).toEqual([]);
  });
  it("does not expose unsafe URLs or private fields from listing metadata", () => {
    const product = { ...products[1], metadata: { listing: { category_id: "ghee", images: [{ url: "javascript:alert(1)" }, { url: "https://user:secret@example.com/image" }], detail_url: "//untrusted.example", max_cart_quantity: -3 }, secret: "hidden" } };
    const result = catalog.buildPublicCatalogResponse({ products: [product], variants, releases: [], promotions: [], categoryId: "ghee" });
    expect(result.products[0].listing).toMatchObject({ images: [], detail_url: null, max_cart_quantity: 20 });
    expect(JSON.stringify(result)).not.toContain("secret");
  });
});
