import { beforeAll, describe, expect, it } from "vitest";
import type { CatalogVariant } from "../../lib/commerce/types";
import type {
  CatalogProductRow,
  CatalogReleaseRow,
  PublicCatalogResponse,
  PublicPromotionDefinition,
} from "../../lib/commerce/publicCatalog";

let buildPublicCatalogResponse: (args: {
  products: CatalogProductRow[];
  variants: CatalogVariant[];
  releases: CatalogReleaseRow[];
  promotions: PublicPromotionDefinition[];
  now?: string;
}) => PublicCatalogResponse;

const products: CatalogProductRow[] = [
  {
    id: "gir-product",
    code: "GIR_GHEE",
    name: "Gir Cow Ghee",
    product_family: "GIR",
    is_active: true,
  },
  {
    id: "murrah-product",
    code: "MURRAH_GHEE",
    name: "Murrah Buffalo Ghee",
    product_family: "MURRAH",
    is_active: true,
  },
];

function variant(args: {
  id: string;
  productId: string;
  productCode: string;
  productName: string;
  family: string;
  sku: string;
  size: string;
  price: number;
  active?: boolean;
}): CatalogVariant {
  return {
    id: args.id,
    product_id: args.productId,
    product_code: args.productCode,
    product_name: args.productName,
    product_family: args.family,
    sku: args.sku,
    variant_name: `${args.productName} ${args.size}`,
    size_label: args.size,
    price_paise: args.price,
    currency: "INR",
    weight_grams: 1_200,
    length_cm: 14,
    breadth_cm: 14,
    height_cm: 18,
    inventory_policy: "SUPABASE",
    inventory_quantity: null,
    is_active: args.active ?? true,
  };
}

const variants: CatalogVariant[] = [
  variant({
    id: "gir-1000",
    productId: "gir-product",
    productCode: "GIR_GHEE",
    productName: "Gir Cow Ghee",
    family: "GIR",
    sku: "GIR-1000",
    size: "1 L",
    price: 750_000,
  }),
  variant({
    id: "gir-500",
    productId: "gir-product",
    productCode: "GIR_GHEE",
    productName: "Gir Cow Ghee",
    family: "GIR",
    sku: "GIR-500",
    size: "500 ml",
    price: 380_000,
  }),
  variant({
    id: "gir-inactive",
    productId: "gir-product",
    productCode: "GIR_GHEE",
    productName: "Gir Cow Ghee",
    family: "GIR",
    sku: "GIR-TRIAL",
    size: "Trial",
    price: 100_000,
    active: false,
  }),
  variant({
    id: "murrah-1000",
    productId: "murrah-product",
    productCode: "MURRAH_GHEE",
    productName: "Murrah Buffalo Ghee",
    family: "MURRAH",
    sku: "MURRAH-1000",
    size: "1 L",
    price: 550_000,
  }),
  variant({
    id: "murrah-500",
    productId: "murrah-product",
    productCode: "MURRAH_GHEE",
    productName: "Murrah Buffalo Ghee",
    family: "MURRAH",
    sku: "MURRAH-500",
    size: "500 ml",
    price: 300_000,
  }),
];

function promotion(
  overrides: Partial<PublicPromotionDefinition> &
    Pick<PublicPromotionDefinition, "id" | "code" | "label">
): PublicPromotionDefinition {
  return {
    status: "ACTIVE",
    valid_from: "2026-09-24T00:00:00.000Z",
    valid_until: "2026-10-05T00:00:00.000Z",
    conditions: {},
    actions: [],
    priority: 100,
    stackable: true,
    stacking_group: null,
    usage_limit: null,
    usage_count: 0,
    version: 1,
    public_display_enabled: true,
    public_display_text: overrides.label,
    ...overrides,
  };
}

const promotions: PublicPromotionDefinition[] = [
  promotion({
    id: "gir-early",
    code: "GIR_1L_EARLY_BIRD",
    label: "Gir 1 L Early Bird",
    public_display_text: "Early-bird price until 4 October",
    conditions: { skus: ["GIR-1000"], lifecycle: ["INITIAL"] },
    actions: [{ type: "AMOUNT_OFF", amount_paise: 50_000, scope: "MATCHING_LINES" }],
  }),
  promotion({
    id: "murrah-early",
    code: "MURRAH_1L_EARLY_BIRD",
    label: "Murrah 1 L Early Bird",
    public_display_text: "Early-bird price until 4 October",
    conditions: { skus: ["MURRAH-1000"], lifecycle: ["INITIAL"] },
    actions: [{ type: "AMOUNT_OFF", amount_paise: 50_000, scope: "MATCHING_LINES" }],
  }),
  promotion({
    id: "expired",
    code: "EXPIRED_PUBLIC",
    label: "Expired",
    valid_until: "2026-09-20T00:00:00.000Z",
    actions: [{ type: "AMOUNT_OFF", amount_paise: 90_000 }],
  }),
  promotion({
    id: "future",
    code: "FUTURE_PUBLIC",
    label: "Future",
    valid_from: "2026-10-20T00:00:00.000Z",
    valid_until: null,
    actions: [{ type: "AMOUNT_OFF", amount_paise: 90_000 }],
  }),
  promotion({
    id: "private",
    code: "PRIVATE_VIP",
    label: "Private VIP",
    public_display_enabled: false,
    public_display_text: "Secret offer",
    conditions: { customer_cohorts: ["PRIVATE_COHORT"] },
    actions: [{ type: "AMOUNT_OFF", amount_paise: 200_000 }],
  }),
];

const releases: CatalogReleaseRow[] = [
  {
    id: "gir-launch",
    product_variant_id: "gir-1000",
    release_code: "LAUNCH_2026",
    release_label: "Launch release",
    status: "ACTIVE",
    release_capacity: 80,
    release_committed: 12,
    low_stock_threshold: 10,
    starts_at: "2026-09-24T00:00:00.000Z",
    ends_at: null,
  },
];

beforeAll(async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
  process.env.COMMERCE_ALLOWED_ORIGINS = "https://framer.com";
  ({ buildPublicCatalogResponse } = await import("../../lib/commerce/publicCatalog"));
});

function catalog() {
  return buildPublicCatalogResponse({
    products,
    variants,
    releases,
    promotions,
    now: "2026-09-25T00:00:00.000Z",
  });
}

describe("public commerce catalog", () => {
  it("returns Gir and Murrah 1 L display prices from the shared pricing engine", () => {
    const response = catalog();
    const gir = response.products.find((product) => product.product_key === "gir")!;
    const murrah = response.products.find((product) => product.product_key === "murrah")!;
    expect(gir.variants.find((item) => item.sku === "GIR-1000")?.pricing).toEqual({
      standard_price_paise: 750_000,
      current_display_price_paise: 700_000,
    });
    expect(murrah.variants.find((item) => item.sku === "MURRAH-1000")?.pricing).toEqual({
      standard_price_paise: 550_000,
      current_display_price_paise: 500_000,
    });
  });

  it("returns both active 500 ml variants at their standard paise prices", () => {
    const response = catalog();
    const allVariants = response.products.flatMap((product) => product.variants);
    expect(allVariants.find((item) => item.sku === "GIR-500")?.pricing).toEqual({
      standard_price_paise: 380_000,
      current_display_price_paise: 380_000,
    });
    expect(allVariants.find((item) => item.sku === "MURRAH-500")?.pricing).toEqual({
      standard_price_paise: 300_000,
      current_display_price_paise: 300_000,
    });
  });

  it("marks an inactive variant unavailable and not sellable", () => {
    const inactive = catalog().products
      .flatMap((product) => product.variants)
      .find((item) => item.sku === "GIR-TRIAL")!;
    expect(inactive.active).toBe(false);
    expect(inactive.sellable).toBe(false);
    expect(inactive.availability.status).toBe("UNAVAILABLE");
  });

  it("calculates release remaining as capacity minus committed", () => {
    const gir = catalog().products
      .flatMap((product) => product.variants)
      .find((item) => item.sku === "GIR-1000")!;
    expect(gir.availability).toEqual({
      status: "IN_STOCK",
      release_total: 80,
      release_remaining: 68,
    });
  });

  it("does not return an expired early-bird offer as active", () => {
    const serialized = JSON.stringify(catalog());
    expect(serialized).not.toContain("EXPIRED_PUBLIC");
  });

  it("does not return a future promotion as active", () => {
    const serialized = JSON.stringify(catalog());
    expect(serialized).not.toContain("FUTURE_PUBLIC");
  });

  it("does not leak private promotion conditions", () => {
    const serialized = JSON.stringify(catalog());
    expect(serialized).not.toContain("PRIVATE_VIP");
    expect(serialized).not.toContain("PRIVATE_COHORT");
    expect(serialized).not.toContain("conditions");
    expect(serialized).not.toContain("actions");
  });

  it("keeps every public price as integer paise", () => {
    for (const item of catalog().products.flatMap((product) => product.variants)) {
      expect(Number.isInteger(item.pricing.standard_price_paise)).toBe(true);
      expect(Number.isInteger(item.pricing.current_display_price_paise)).toBe(true);
    }
  });

  it("uses the commerce CORS policy for Framer", async () => {
    const { OPTIONS } = await import("../../app/api/commerce/catalog/route");
    const response = await OPTIONS(
      new Request("https://api.example.test/api/commerce/catalog", {
        method: "OPTIONS",
        headers: { Origin: "https://framer.com" },
      })
    );
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe("https://framer.com");
    expect(response.headers.get("access-control-allow-methods")).toBe("GET, OPTIONS");
  });
});
