import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { calculateCartQuote } from "./pricing/calculateCartQuote";
import type {
  CatalogVariant,
  PromotionConditions,
  PromotionDefinition,
} from "./types";

export type PublicAvailabilityStatus =
  | "IN_STOCK"
  | "LOW_STOCK"
  | "OUT_OF_STOCK"
  | "UNAVAILABLE";

export type PublicCatalogOffer = {
  promotion_id: string;
  code: string;
  label: string;
  display_text: string;
  valid_from: string | null;
  valid_until: string | null;
};

export type PublicCatalogVariant = {
  sku: string;
  size: string;
  active: boolean;
  sellable: boolean;
  pricing: {
    standard_price_paise: number;
    current_display_price_paise: number;
  };
  availability: {
    status: PublicAvailabilityStatus;
    release_total: number | null;
    release_remaining: number | null;
  };
  active_offers: PublicCatalogOffer[];
};

export type PublicCatalogProduct = {
  product_key: string;
  name: string;
  active: boolean;
  variants: PublicCatalogVariant[];
};

export type PublicCatalogResponse = {
  ok: true;
  generated_at: string;
  currency: "INR";
  products: PublicCatalogProduct[];
};

export type CatalogProductRow = {
  id: string;
  code: string;
  name: string;
  product_family: string;
  is_active: boolean;
};

export type CatalogReleaseRow = {
  id: string;
  product_variant_id: string;
  release_code: string;
  release_label: string | null;
  status: "SCHEDULED" | "ACTIVE" | "CLOSED";
  release_capacity: number;
  release_committed: number;
  low_stock_threshold: number;
  starts_at: string | null;
  ends_at: string | null;
};

export type PublicPromotionDefinition = PromotionDefinition & {
  public_display_enabled: boolean;
  public_display_text: string | null;
};

type VariantRow = {
  id: string;
  product_id: string;
  sku: string;
  name: string;
  size_label: string;
  price_paise: number;
  currency: "INR";
  weight_grams: number;
  length_cm: number | string;
  breadth_cm: number | string;
  height_cm: number | string;
  external_shopify_variant_id: string | null;
  inventory_policy: "SUPABASE" | "SHOPIFY";
  inventory_quantity: number | null;
  is_active: boolean;
};

function promotionIsCurrent(promotion: PublicPromotionDefinition, nowMs: number): boolean {
  if (!promotion.public_display_enabled || promotion.status !== "ACTIVE") return false;
  if (promotion.valid_from && new Date(promotion.valid_from).getTime() > nowMs) return false;
  if (promotion.valid_until && new Date(promotion.valid_until).getTime() <= nowMs) return false;
  if (
    promotion.usage_limit !== null &&
    promotion.usage_limit !== undefined &&
    (promotion.usage_count ?? 0) >= promotion.usage_limit
  ) {
    return false;
  }
  return true;
}

function promotionCanDescribeVariant(
  conditions: PromotionConditions,
  variant: CatalogVariant
): boolean {
  if (conditions.skus && !conditions.skus.includes(variant.sku)) return false;
  if (
    conditions.product_codes &&
    !conditions.product_codes.includes(variant.product_code)
  ) {
    return false;
  }
  if (
    conditions.required_product_codes &&
    !conditions.required_product_codes.includes(variant.product_code)
  ) {
    return false;
  }
  return true;
}

function productKey(product: CatalogProductRow): string {
  const family = product.product_family.trim().toLowerCase();
  if (family) return family;
  return product.code.toLowerCase().replace(/_ghee$/, "").replace(/_/g, "-");
}

function currentRelease(
  releases: CatalogReleaseRow[],
  productVariantId: string,
  nowMs: number
): CatalogReleaseRow | null {
  return (
    releases
      .filter((release) => {
        if (release.product_variant_id !== productVariantId || release.status !== "ACTIVE") {
          return false;
        }
        if (release.starts_at && new Date(release.starts_at).getTime() > nowMs) return false;
        if (release.ends_at && new Date(release.ends_at).getTime() <= nowMs) return false;
        return true;
      })
      .sort((left, right) => {
        const leftStart = left.starts_at ? new Date(left.starts_at).getTime() : 0;
        const rightStart = right.starts_at ? new Date(right.starts_at).getTime() : 0;
        return rightStart - leftStart || left.release_code.localeCompare(right.release_code);
      })[0] ?? null
  );
}

export function calculatePublicAvailability(args: {
  productActive: boolean;
  variant: CatalogVariant;
  release: CatalogReleaseRow | null;
}): PublicCatalogVariant["availability"] & { sellable: boolean } {
  if (!args.productActive || !args.variant.is_active) {
    return {
      status: "UNAVAILABLE",
      release_total: args.release?.release_capacity ?? null,
      release_remaining: args.release
        ? Math.max(0, args.release.release_capacity - args.release.release_committed)
        : null,
      sellable: false,
    };
  }

  const physicalAvailable =
    args.variant.inventory_quantity === null ||
    args.variant.inventory_quantity === undefined
      ? null
      : Math.max(0, args.variant.inventory_quantity);
  const releaseAvailable = args.release
    ? Math.max(0, args.release.release_capacity - args.release.release_committed)
    : null;
  const sellableReleaseRemaining =
    releaseAvailable === null
      ? null
      : physicalAvailable === null || physicalAvailable === undefined
        ? releaseAvailable
        : Math.min(releaseAvailable, Math.max(0, physicalAvailable));
  const availabilityQuantity = sellableReleaseRemaining ?? physicalAvailable ?? null;
  const threshold = args.release?.low_stock_threshold ?? 10;
  const status: PublicAvailabilityStatus =
    availabilityQuantity === 0
      ? "OUT_OF_STOCK"
      : availabilityQuantity !== null && availabilityQuantity <= threshold
        ? "LOW_STOCK"
        : "IN_STOCK";

  return {
    status,
    release_total: args.release?.release_capacity ?? null,
    release_remaining: sellableReleaseRemaining,
    sellable: status === "IN_STOCK" || status === "LOW_STOCK",
  };
}

function displayPrice(
  variant: CatalogVariant,
  promotions: PublicPromotionDefinition[],
  now: string,
  active: boolean
): number {
  if (!active) return variant.price_paise;
  const quote = calculateCartQuote({
    items: [
      {
        line_id: `catalog-${variant.sku.toLowerCase()}`,
        sku: variant.sku,
        qty: 1,
        purchase_mode: "BUY_ONCE",
      },
    ],
    catalog: [variant],
    promotions,
    context: {
      stage: "INITIAL",
      now,
      cycle_number: 1,
      is_new_subscriber: true,
      is_first_order: true,
      is_returning_customer: false,
      shipping_country: "IN",
    },
  });
  return quote.total_paise;
}

export function buildPublicCatalogResponse(args: {
  products: CatalogProductRow[];
  variants: CatalogVariant[];
  releases: CatalogReleaseRow[];
  promotions: PublicPromotionDefinition[];
  now?: string;
}): PublicCatalogResponse {
  const now = args.now ?? new Date().toISOString();
  const nowMs = new Date(now).getTime();
  const activePublicPromotions = args.promotions.filter((promotion) =>
    promotionIsCurrent(promotion, nowMs)
  );

  return {
    ok: true,
    generated_at: now,
    currency: "INR",
    products: [...args.products]
      .sort((left, right) => left.code.localeCompare(right.code))
      .map((product) => ({
        product_key: productKey(product),
        name: product.name,
        active: product.is_active,
        variants: args.variants
          .filter((variant) => variant.product_id === product.id)
          .sort((left, right) => left.sku.localeCompare(right.sku))
          .map((variant) => {
            const release = currentRelease(args.releases, variant.id, nowMs);
            const availability = calculatePublicAvailability({
              productActive: product.is_active,
              variant,
              release,
            });
            const offers = activePublicPromotions
              .filter((promotion) =>
                promotionCanDescribeVariant(promotion.conditions ?? {}, variant)
              )
              .map((promotion) => ({
                promotion_id: promotion.id,
                code: promotion.code,
                label: promotion.label,
                display_text: promotion.public_display_text?.trim() || promotion.label,
                valid_from: promotion.valid_from ?? null,
                valid_until: promotion.valid_until ?? null,
              }));

            return {
              sku: variant.sku,
              size: variant.size_label,
              active: product.is_active && variant.is_active,
              sellable: availability.sellable,
              pricing: {
                standard_price_paise: variant.price_paise,
                current_display_price_paise: displayPrice(
                  variant,
                  activePublicPromotions,
                  now,
                  product.is_active && variant.is_active
                ),
              },
              availability: {
                status: availability.status,
                release_total: availability.release_total,
                release_remaining: availability.release_remaining,
              },
              active_offers: offers,
            };
          }),
      })),
  };
}

export async function loadPublicCatalog(now = new Date().toISOString()) {
  const [productsResult, variantsResult, releasesResult, promotionsResult] =
    await Promise.all([
      supabaseAdmin
        .from("products")
        .select("id, code, name, product_family, is_active")
        .order("code"),
      supabaseAdmin
        .from("product_variants")
        .select(
          "id, product_id, sku, name, size_label, price_paise, currency, weight_grams, length_cm, breadth_cm, height_cm, external_shopify_variant_id, inventory_policy, inventory_quantity, is_active"
        )
        .order("sku"),
      supabaseAdmin
        .from("product_variant_releases")
        .select(
          "id, product_variant_id, release_code, release_label, status, release_capacity, release_committed, low_stock_threshold, starts_at, ends_at"
        )
        .eq("status", "ACTIVE"),
      supabaseAdmin
        .from("promotions")
        .select(
          "id, code, label, status, valid_from, valid_until, conditions, actions, priority, stackable, stacking_group, usage_limit, usage_count, version, public_display_enabled, public_display_text"
        )
        .eq("status", "ACTIVE")
        .eq("public_display_enabled", true),
    ]);

  if (productsResult.error) {
    throw new Error(`Public catalog product lookup failed: ${productsResult.error.message}`);
  }
  if (variantsResult.error) {
    throw new Error(`Public catalog variant lookup failed: ${variantsResult.error.message}`);
  }
  if (releasesResult.error) {
    throw new Error(`Public catalog release lookup failed: ${releasesResult.error.message}`);
  }
  if (promotionsResult.error) {
    throw new Error(`Public catalog promotion lookup failed: ${promotionsResult.error.message}`);
  }

  const products = (productsResult.data ?? []) as CatalogProductRow[];
  const productsById = new Map(products.map((product) => [product.id, product]));
  const variants = ((variantsResult.data ?? []) as VariantRow[]).map((row) => {
    const product = productsById.get(row.product_id);
    if (!product) throw new Error(`Product is missing for catalog variant ${row.sku}.`);
    return {
      id: row.id,
      product_id: row.product_id,
      product_code: product.code,
      product_name: product.name,
      product_family: product.product_family,
      sku: row.sku,
      variant_name: row.name,
      size_label: row.size_label,
      price_paise: Number(row.price_paise),
      currency: row.currency,
      weight_grams: row.weight_grams,
      length_cm: Number(row.length_cm),
      breadth_cm: Number(row.breadth_cm),
      height_cm: Number(row.height_cm),
      external_shopify_variant_id: row.external_shopify_variant_id,
      inventory_policy: row.inventory_policy,
      inventory_quantity: row.inventory_quantity,
      is_active: row.is_active,
    } satisfies CatalogVariant;
  });

  return buildPublicCatalogResponse({
    products,
    variants,
    releases: (releasesResult.data ?? []) as CatalogReleaseRow[],
    promotions: (promotionsResult.data ?? []) as PublicPromotionDefinition[],
    now,
  });
}
