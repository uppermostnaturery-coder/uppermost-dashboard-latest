function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing environment variable: ${name}`);
  return value;
}

function optionalNumber(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be a non-negative number.`);
  }
  return value;
}

export function getCommerceEnv() {
  return {
    tokenPepper: required("COMMERCE_TOKEN_PEPPER"),
    quoteTtlSeconds: optionalNumber("COMMERCE_QUOTE_TTL_SECONDS", 900),
    mandateBufferPaise: optionalNumber("COMMERCE_MANDATE_BUFFER_PAISE", 250000),
    inventorySource:
      process.env.COMMERCE_INVENTORY_SOURCE?.trim().toUpperCase() === "SHOPIFY"
        ? ("SHOPIFY" as const)
        : ("SUPABASE" as const),
  };
}

export function getRazorpayEnv() {
  return {
    keyId: required("RAZORPAY_KEY_ID"),
    keySecret: required("RAZORPAY_KEY_SECRET"),
    webhookSecret: required("RAZORPAY_WEBHOOK_SECRET"),
    apiBaseUrl:
      process.env.RAZORPAY_API_BASE_URL?.trim() || "https://api.razorpay.com/v1",
    mandateExpiryDays: optionalNumber("RAZORPAY_MANDATE_EXPIRY_DAYS", 3650),
  };
}

export function getShiprocketEnv() {
  return {
    token: process.env.SHIPROCKET_TOKEN?.trim() || null,
    email: process.env.SHIPROCKET_EMAIL?.trim() || null,
    password: process.env.SHIPROCKET_PASSWORD?.trim() || null,
    pickupPostcode: required("SHIPROCKET_PICKUP_POSTCODE"),
    pickupLocation: process.env.SHIPROCKET_PICKUP_LOCATION?.trim() || "Primary",
    webhookSecret: required("SHIPROCKET_WEBHOOK_SECRET"),
    apiBaseUrl:
      process.env.SHIPROCKET_API_BASE_URL?.trim() || "https://apiv2.shiprocket.in/v1/external",
  };
}

export function getShopifyEnv() {
  return {
    storeDomain: required("SHOPIFY_STORE_DOMAIN"),
    adminAccessToken: required("SHOPIFY_ADMIN_ACCESS_TOKEN"),
    apiVersion: process.env.SHOPIFY_API_VERSION?.trim() || "2026-07",
  };
}

export function configuredCommerceOrigins(): Set<string> {
  const defaults = [
    "https://uppermost.store",
    "https://www.uppermost.store",
  ];
  const configured = (process.env.COMMERCE_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const development =
    process.env.NODE_ENV === "production"
      ? []
      : ["http://localhost:3000", "http://localhost:3001", "http://localhost:3002"];

  return new Set([...defaults, ...configured, ...development].map(normalizeOrigin));
}

export function normalizeOrigin(origin: string): string {
  return origin.trim().replace(/\/+$/, "").toLowerCase();
}

