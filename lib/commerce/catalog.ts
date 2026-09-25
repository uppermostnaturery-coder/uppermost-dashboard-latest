import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getCommerceEnv, getShopifyEnv } from "./env";
import { CommerceError } from "./http";
import type { CatalogVariant } from "./types";

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
  products:
    | { code: string; name: string; product_family: string }
    | Array<{ code: string; name: string; product_family: string }>;
};

type ReleaseInventoryRow = {
  product_variant_id: string;
  release_code: string;
  release_capacity: number;
  release_committed: number;
  starts_at: string | null;
  ends_at: string | null;
};

export function constrainInventoryQuantity(
  physicalQuantity: number | null | undefined,
  releaseRemaining: number | null | undefined
): number | null {
  const physical = physicalQuantity == null ? null : Math.max(0, physicalQuantity);
  const release = releaseRemaining == null ? null : Math.max(0, releaseRemaining);
  if (physical === null) return release;
  if (release === null) return physical;
  return Math.min(physical, release);
}

function currentReleaseRemaining(
  releases: ReleaseInventoryRow[],
  nowMs = Date.now()
): Map<string, number> {
  const sorted = [...releases]
    .filter((release) => {
      if (release.starts_at && new Date(release.starts_at).getTime() > nowMs) return false;
      if (release.ends_at && new Date(release.ends_at).getTime() <= nowMs) return false;
      return true;
    })
    .sort((left, right) => {
      const leftStart = left.starts_at ? new Date(left.starts_at).getTime() : 0;
      const rightStart = right.starts_at ? new Date(right.starts_at).getTime() : 0;
      return rightStart - leftStart || left.release_code.localeCompare(right.release_code);
    });
  const remaining = new Map<string, number>();
  for (const release of sorted) {
    if (!remaining.has(release.product_variant_id)) {
      remaining.set(
        release.product_variant_id,
        Math.max(0, release.release_capacity - release.release_committed)
      );
    }
  }
  return remaining;
}

function productFromRelation(row: VariantRow) {
  return Array.isArray(row.products) ? row.products[0] : row.products;
}

async function getShopifyInventory(
  variants: CatalogVariant[]
): Promise<Map<string, number | null>> {
  const ids = variants
    .map((variant) => variant.external_shopify_variant_id)
    .filter((value): value is string => Boolean(value));
  if (ids.length === 0) return new Map();

  const env = getShopifyEnv();
  const response = await fetch(
    `https://${env.storeDomain}/admin/api/${env.apiVersion}/graphql.json`,
    {
      method: "POST",
      headers: {
        "X-Shopify-Access-Token": env.adminAccessToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: `query Inventory($ids: [ID!]!) {
          nodes(ids: $ids) {
            ... on ProductVariant { id inventoryQuantity }
          }
        }`,
        variables: { ids },
      }),
      cache: "no-store",
    }
  );
  const payload = (await response.json().catch(() => null)) as
    | {
        data?: { nodes?: Array<{ id?: string; inventoryQuantity?: number | null } | null> };
        errors?: unknown;
      }
    | null;

  if (!response.ok || !payload?.data?.nodes) {
    throw new CommerceError(
      "INVENTORY_UNAVAILABLE",
      "Inventory could not be confirmed.",
      503
    );
  }

  return new Map(
    payload.data.nodes
      .filter((node): node is { id: string; inventoryQuantity?: number | null } =>
        Boolean(node?.id)
      )
      .map((node) => [node.id, node.inventoryQuantity ?? null])
  );
}

export async function loadCatalogVariants(skus: string[]): Promise<CatalogVariant[]> {
  const uniqueSkus = Array.from(new Set(skus.map((sku) => sku.toUpperCase())));
  const { data, error } = await supabaseAdmin
    .from("product_variants")
    .select(
      "id, product_id, sku, name, size_label, price_paise, currency, weight_grams, length_cm, breadth_cm, height_cm, external_shopify_variant_id, inventory_policy, inventory_quantity, is_active, products!inner(code, name, product_family)"
    )
    .in("sku", uniqueSkus);

  if (error) throw new Error(`Catalog lookup failed: ${error.message}`);

  const variants = ((data ?? []) as unknown as VariantRow[]).map((row) => {
    const product = productFromRelation(row);
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

  const found = new Set(variants.map((variant) => variant.sku));
  const missing = uniqueSkus.filter((sku) => !found.has(sku));
  if (missing.length > 0) {
    throw new CommerceError("UNKNOWN_SKU", `Unknown SKU: ${missing.join(", ")}`, 400);
  }

  let inventoryAdjustedVariants = variants;
  if (getCommerceEnv().inventorySource === "SHOPIFY") {
    const inventory = await getShopifyInventory(variants);
    inventoryAdjustedVariants = variants.map((variant) => ({
      ...variant,
      inventory_quantity: variant.external_shopify_variant_id
        ? inventory.get(variant.external_shopify_variant_id) ?? null
        : variant.inventory_quantity,
    }));
  }

  const releaseResult = await supabaseAdmin
    .from("product_variant_releases")
    .select(
      "product_variant_id, release_code, release_capacity, release_committed, starts_at, ends_at"
    )
    .in("product_variant_id", inventoryAdjustedVariants.map((variant) => variant.id))
    .eq("status", "ACTIVE");
  if (releaseResult.error) {
    throw new Error(`Release inventory lookup failed: ${releaseResult.error.message}`);
  }
  const releaseByVariant = currentReleaseRemaining(
    (releaseResult.data ?? []) as ReleaseInventoryRow[]
  );

  return inventoryAdjustedVariants.map((variant) => ({
    ...variant,
    inventory_quantity: constrainInventoryQuantity(
      variant.inventory_quantity,
      releaseByVariant.get(variant.id)
    ),
  }));
}

export function assertInventory(
  requested: Array<{ sku: string; qty: number }>,
  catalog: CatalogVariant[]
): void {
  const bySku = new Map(catalog.map((variant) => [variant.sku, variant]));
  for (const item of requested) {
    const variant = bySku.get(item.sku);
    if (!variant?.is_active) {
      throw new CommerceError("SKU_UNAVAILABLE", `${item.sku} is unavailable.`, 409);
    }
    if (
      variant.inventory_quantity !== null &&
      variant.inventory_quantity !== undefined &&
      variant.inventory_quantity < item.qty
    ) {
      throw new CommerceError(
        "INSUFFICIENT_INVENTORY",
        `${item.sku} does not have enough inventory.`,
        409
      );
    }
  }
}
