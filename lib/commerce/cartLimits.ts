import type { CatalogVariant } from "./types";

export class CartQuantityLimitError extends Error {
  constructor(public readonly sku: string, public readonly limit: number) {
    super(`Cart quantity limit for ${sku} is ${limit}.`);
  }
}

/** Aggregate all lines, including different sizes of the same product. */
export function assertCartQuantityLimits(items: Array<{ sku: string; qty: number }>, catalog: CatalogVariant[]): void {
  const bySku = new Map(catalog.map(variant => [variant.sku, variant]));
  const skuCounts = new Map<string, number>(), productCounts = new Map<string, number>();
  for (const item of items) {
    const variant = bySku.get(item.sku); if (!variant) continue;
    const skuCount = (skuCounts.get(item.sku) ?? 0) + item.qty;
    const productCount = (productCounts.get(variant.product_id) ?? 0) + item.qty;
    skuCounts.set(item.sku, skuCount); productCounts.set(variant.product_id, productCount);
    if (skuCount > (variant.max_cart_quantity ?? 20)) throw new CartQuantityLimitError(item.sku, variant.max_cart_quantity ?? 20);
    if (productCount > (variant.product_max_cart_quantity ?? 20)) throw new CartQuantityLimitError(item.sku, variant.product_max_cart_quantity ?? 20);
  }
}
