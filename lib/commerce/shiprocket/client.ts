import { getShiprocketEnv } from "../env";
import type { NormalizedCartLine } from "../types";

type ShiprocketCourier = {
  courier_company_id?: number;
  courier_name?: string;
  estimated_delivery_days?: string | number;
  etd?: string;
  freight_charge?: number;
  rate?: number;
};

let cachedToken: { value: string; expiresAt: number } | null = null;

async function shiprocketToken(): Promise<string> {
  const env = getShiprocketEnv();
  if (env.token) return env.token;
  if (cachedToken && cachedToken.expiresAt > Date.now()) return cachedToken.value;
  if (!env.email || !env.password) {
    throw new Error("SHIPROCKET_TOKEN or SHIPROCKET_EMAIL/SHIPROCKET_PASSWORD is required.");
  }
  const response = await fetch(`${env.apiBaseUrl}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ email: env.email, password: env.password }),
    cache: "no-store",
  });
  const payload = (await response.json().catch(() => null)) as { token?: string } | null;
  if (!response.ok || !payload?.token) throw new Error("Shiprocket authentication failed.");
  cachedToken = { value: payload.token, expiresAt: Date.now() + 8 * 60 * 60 * 1000 };
  return payload.token;
}

async function shiprocketRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const env = getShiprocketEnv();
  const token = await shiprocketToken();
  const response = await fetch(`${env.apiBaseUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
    cache: "no-store",
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(`Shiprocket request failed with status ${response.status}.`);
  }
  return payload as T;
}

export function packedCart(items: NormalizedCartLine[]) {
  const weightGrams = items.reduce((sum, item) => sum + item.weight_grams, 0);
  return {
    weightKg: Math.max(0.5, Math.ceil(weightGrams / 500) * 0.5),
    lengthCm: Math.max(...items.map((item) => item.dimensions_cm.length)),
    breadthCm: Math.max(...items.map((item) => item.dimensions_cm.breadth)),
    heightCm: items.reduce((sum, item) => sum + item.dimensions_cm.height, 0),
  };
}

export async function getShiprocketServiceability(input: {
  postalCode: string;
  items: NormalizedCartLine[];
  declaredValuePaise: number;
}) {
  const env = getShiprocketEnv();
  const packed = packedCart(input.items);
  const params = new URLSearchParams({
    pickup_postcode: env.pickupPostcode,
    delivery_postcode: input.postalCode,
    weight: String(packed.weightKg),
    cod: "0",
    declared_value: (input.declaredValuePaise / 100).toFixed(2),
  });
  const payload = await shiprocketRequest<{
    data?: { available_courier_companies?: ShiprocketCourier[] };
  }>(`/courier/serviceability/?${params.toString()}`, { method: "GET" });
  const couriers = payload.data?.available_courier_companies ?? [];
  const best = [...couriers].sort(
    (left, right) => Number(left.freight_charge ?? left.rate ?? Infinity) - Number(right.freight_charge ?? right.rate ?? Infinity)
  )[0];
  if (!best) {
    return {
      serviceable: false,
      estimated_delivery_from: null,
      estimated_delivery_to: null,
      shipping_amount_paise: 0,
      message: "Delivery is not currently available for this pincode.",
    };
  }
  const days = Math.max(1, Number(best.estimated_delivery_days ?? 5) || 5);
  const from = new Date(Date.now() + Math.max(1, days - 1) * 86_400_000);
  const to = new Date(Date.now() + (days + 1) * 86_400_000);
  return {
    serviceable: true,
    estimated_delivery_from: from.toISOString(),
    estimated_delivery_to: to.toISOString(),
    best_courier_internal_reference: best.courier_company_id ? String(best.courier_company_id) : undefined,
    courier_display_name: best.courier_name ?? undefined,
    shipping_amount_paise: 0,
    message: best.etd ? `Estimated delivery ${best.etd}` : `Estimated delivery in ${days}-${days + 1} days`,
  };
}

export async function createShiprocketOrder(input: {
  orderNumber: string;
  placedAt: string;
  customer: { name: string; email: string; phone: string };
  address: Record<string, unknown>;
  items: Array<{ sku: string; name: string; units: number; selling_price: number }>;
  subtotalRupees: number;
  dimensions: { weightKg: number; lengthCm: number; breadthCm: number; heightCm: number };
}) {
  const env = getShiprocketEnv();
  const address = input.address;
  return shiprocketRequest<{
    order_id?: number;
    shipment_id?: number;
    status?: string;
  }>("/orders/create/adhoc", {
    method: "POST",
    body: JSON.stringify({
      order_id: input.orderNumber,
      order_date: input.placedAt.slice(0, 19).replace("T", " "),
      pickup_location: env.pickupLocation,
      billing_customer_name: input.customer.name,
      billing_last_name: "",
      billing_address: address.line1,
      billing_address_2: address.line2 ?? "",
      billing_city: address.city,
      billing_pincode: address.postal_code,
      billing_state: address.state,
      billing_country: "India",
      billing_email: input.customer.email,
      billing_phone: input.customer.phone.replace(/\D/g, "").slice(-10),
      shipping_is_billing: true,
      order_items: input.items,
      payment_method: "Prepaid",
      sub_total: input.subtotalRupees,
      length: input.dimensions.lengthCm,
      breadth: input.dimensions.breadthCm,
      height: input.dimensions.heightCm,
      weight: input.dimensions.weightKg,
    }),
  });
}

export async function fetchShiprocketTracking(awb: string) {
  return shiprocketRequest<unknown>(`/courier/track/awb/${encodeURIComponent(awb)}`, {
    method: "GET",
  });
}

