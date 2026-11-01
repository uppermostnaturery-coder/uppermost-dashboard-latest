/** Public card projection from an allowlisted part of existing product metadata. */
export const CATEGORY_IDS = ["ghee", "mustard-oil", "pickles"] as const;
export type CategoryId = typeof CATEGORY_IDS[number];
export const MAX_CART_QUANTITY = 20;
export type ListingImage = { url: string; alt: string; kind: "packshot" | "photograph"; position?: "left" | "center" | "right" };
export type ListingDetails = {
  category_id: CategoryId;
  description: string;
  images: ListingImage[];
  tags: string[];
  badge: string | null;
  origin: string;
  detail_url: string | null;
  coming_soon: boolean;
  max_cart_quantity: number;
  display_order: number;
};
type Product = { code: string; name: string; description?: string | null; metadata?: unknown };
const LEGACY: Record<string, { image: string; tags: string[]; order: number }> = {
  GIR_GHEE: { image: "ubRN4xxbU3tqelmjiBswVT9N14.png", tags: ["Pure Gir", "Vedic Bilona", "36 Botanicals", "Ahimsa"], order: 0 },
  MURRAH_GHEE: { image: "vVTsQqQumaQUUwBWC82c4cNbCw.png", tags: ["Pure Murrah", "Vedic Bilona", "36 Botanicals", "Ahimsa"], order: 1 },
};
export function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
export function quantityLimit(value: unknown, fallback = MAX_CART_QUANTITY): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= MAX_CART_QUANTITY ? value : fallback;
}
export function productCartLimit(product: Pick<Product, "code" | "metadata">): number {
  return quantityLimit(object(object(product.metadata).listing).max_cart_quantity, LEGACY[product.code] ? 1 : MAX_CART_QUANTITY);
}
export function categoryOf(product: Product): CategoryId | null {
  const category = object(object(product.metadata).listing).category_id;
  return CATEGORY_IDS.includes(category as CategoryId) ? category as CategoryId : LEGACY[product.code] ? "ghee" : null;
}
function text(value: unknown, max = 500): string { return typeof value === "string" ? value.trim().slice(0, max) : ""; }
function publicUrl(value: unknown): string | null {
  const url = text(value, 2048);
  if (/^\/(?!\/|\\)/.test(url) && !url.includes("\\")) return url;
  try { const parsed = new URL(url); return parsed.protocol === "https:" && !parsed.username && !parsed.password ? url : null; } catch { return null; }
}
export function listingFor(product: Product): ListingDetails | null {
  const category = categoryOf(product); if (!category) return null;
  const data = object(object(product.metadata).listing), legacy = LEGACY[product.code];
  const images: ListingImage[] = (Array.isArray(data.images) ? data.images : []).slice(0, 4).flatMap(value => {
    const image = object(value), url = publicUrl(image.url);
    return url ? [{ url, alt: text(image.alt, 240) || product.name, kind: image.kind === "packshot" ? "packshot" as const : "photograph" as const, ...(["left", "center", "right"].includes(String(image.position)) ? { position: image.position as "left" | "center" | "right" } : {}) }] : [];
  });
  if (!images.length && legacy) images.push({ url: "https://framerusercontent.com/images/" + legacy.image, alt: product.name, kind: "packshot" });
  return {
    category_id: category, description: text(product.description, 1200), images,
    tags: (Array.isArray(data.tags) ? data.tags : legacy?.tags ?? []).flatMap(value => { const tag = text(value, 80); return tag ? [tag] : []; }).slice(0, 8),
    badge: text(data.badge, 80) || (legacy ? "~30 jars a week" : null), origin: text(data.origin, 120) || (legacy ? "Uppermost Farms®" : ""),
    detail_url: publicUrl(data.detail_url) || (legacy ? "https://www.uppermost.store/ghee" : null),
    coming_soon: data.coming_soon === true, max_cart_quantity: productCartLimit(product),
    display_order: typeof data.display_order === "number" && Number.isFinite(data.display_order) ? data.display_order : legacy?.order ?? 100,
  };
}
