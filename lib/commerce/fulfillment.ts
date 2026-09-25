import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { createShiprocketOrder, packedCart } from "./shiprocket/client";
import type { NormalizedCartLine } from "./types";

type OrderForShipment = {
  id: string;
  order_number: string;
  customer_id: string;
  subtotal_paise: number;
  total_paise: number;
  address_snapshot: Record<string, unknown>;
  pricing_snapshot: {
    shipping?: {
      estimated_delivery_from?: string | null;
      estimated_delivery_to?: string | null;
    };
    initial?: { items?: NormalizedCartLine[] };
    quote?: { items?: NormalizedCartLine[] };
    items?: NormalizedCartLine[];
  };
  created_at: string;
};

function dateOnly(value: unknown): string | null {
  if (typeof value !== "string" || !value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

export function shipmentDatesFromPricingSnapshot(
  pricingSnapshot: OrderForShipment["pricing_snapshot"]
) {
  return {
    expectedFrom: dateOnly(pricingSnapshot.shipping?.estimated_delivery_from),
    expectedTo: dateOnly(pricingSnapshot.shipping?.estimated_delivery_to),
  };
}

export async function ensureShipmentForOrder(orderId: string): Promise<void> {
  const existing = await supabaseAdmin
    .from("shipments")
    .select("id")
    .eq("order_id", orderId)
    .maybeSingle();
  if (existing.error) throw new Error(`Shipment lookup failed: ${existing.error.message}`);
  if (existing.data) return;

  const orderResult = await supabaseAdmin
    .from("orders")
    .select("id, order_number, customer_id, subtotal_paise, total_paise, address_snapshot, pricing_snapshot, created_at")
    .eq("id", orderId)
    .single();
  if (orderResult.error || !orderResult.data) {
    throw new Error(`Order lookup failed: ${orderResult.error?.message}`);
  }
  const order = orderResult.data as unknown as OrderForShipment;
  const customerResult = await supabaseAdmin
    .from("customers")
    .select("name, email, phone")
    .eq("id", order.customer_id)
    .single();
  if (customerResult.error || !customerResult.data) {
    throw new Error(`Customer lookup failed: ${customerResult.error?.message}`);
  }
  const items =
    order.pricing_snapshot.initial?.items ??
    order.pricing_snapshot.quote?.items ??
    order.pricing_snapshot.items ??
    [];
  if (items.length === 0) throw new Error("Order has no fulfilment items.");
  const shipmentDates = shipmentDatesFromPricingSnapshot(order.pricing_snapshot);
  const placeholder = await supabaseAdmin
    .from("shipments")
    .insert({
      order_id: orderId,
      status: "CREATING",
      expected_from: shipmentDates.expectedFrom,
      expected_to: shipmentDates.expectedTo,
    })
    .select("id")
    .single();
  if (placeholder.error || !placeholder.data) {
    if (placeholder.error?.code === "23505") return;
    throw new Error(`Shipment reservation failed: ${placeholder.error?.message}`);
  }

  try {
    const packed = packedCart(items);
    const remote = await createShiprocketOrder({
      orderNumber: order.order_number,
      placedAt: order.created_at,
      customer: {
        name: customerResult.data.name,
        email: customerResult.data.email,
        phone: customerResult.data.phone,
      },
      address: order.address_snapshot,
      items: items.map((item) => ({
        sku: item.sku,
        name: `${item.product_name} ${item.variant_name}`,
        units: item.qty,
        selling_price: item.unit_price_paise / 100,
      })),
      orderTotalRupees: order.total_paise / 100,
      dimensions: packed,
    });
    await supabaseAdmin
      .from("shipments")
      .update({
        status: remote.status ?? "ORDER_CREATED",
        provider_order_id: remote.order_id ? String(remote.order_id) : null,
        provider_shipment_id: remote.shipment_id ? String(remote.shipment_id) : null,
        raw_metadata: remote,
      })
      .eq("id", placeholder.data.id);
  } catch (error) {
    await supabaseAdmin
      .from("shipments")
      .update({
        status: "CREATE_FAILED",
        raw_metadata: { message: error instanceof Error ? error.message : "Unknown error" },
      })
      .eq("id", placeholder.data.id);
    console.error("Shiprocket order creation failed:", error);
  }
}
