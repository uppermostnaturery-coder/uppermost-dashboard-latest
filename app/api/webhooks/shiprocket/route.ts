import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requestHash, safeEqual } from "@/lib/commerce/crypto";
import { getShiprocketEnv } from "@/lib/commerce/env";
import { commerceJson, errorResponse } from "@/lib/commerce/http";
import { createCustomerMessage } from "@/lib/commerce/messages";
import type { CustomerMessageKey } from "@/lib/commerce/types";

export const runtime = "nodejs";

function messageForShipment(status: string): CustomerMessageKey | null {
  const value = status.toLowerCase();
  if (value.includes("delivered")) return "DELIVERED";
  if (value.includes("out for delivery")) return "OUT_FOR_DELIVERY";
  if (value.includes("transit") || value.includes("shipped")) return "IN_TRANSIT";
  if (value.includes("pickup") || value.includes("manifest")) return "ORDER_SHIPPED";
  return null;
}

export async function POST(request: Request) {
  try {
    const supplied = request.headers.get("x-shiprocket-webhook-secret") ??
      request.headers.get("x-api-key") ??
      request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
    if (!safeEqual(supplied, getShiprocketEnv().webhookSecret)) {
      return commerceJson({ ok: false, error: { code: "INVALID_WEBHOOK_SECRET", message: "Invalid secret." } }, 401, null);
    }
    const raw = await request.text();
    const payload = JSON.parse(raw) as Record<string, any>;
    const awb = String(payload.awb ?? payload.awb_code ?? "");
    const providerShipmentId = String(payload.shipment_id ?? payload.sr_shipment_id ?? "");
    const shipmentResult = await supabaseAdmin.from("shipments")
      .select("id, order_id")
      .or(`awb_code.eq.${awb || "__none__"},provider_shipment_id.eq.${providerShipmentId || "__none__"}`)
      .maybeSingle();
    if (!shipmentResult.data) return commerceJson({ ok: true, ignored: true }, 202, null);

    const status = String(payload.current_status ?? payload.status ?? "UPDATED");
    const eventId = String(payload.event_id ?? payload.id ?? requestHash(raw));
    const tracking = await supabaseAdmin.from("tracking_events").insert({
      shipment_id: shipmentResult.data.id,
      provider_event_id: eventId,
      status,
      status_code: payload.current_status_id ? String(payload.current_status_id) : null,
      description: payload.status_description ?? payload.current_status ?? null,
      location: payload.current_location ?? payload.location ?? null,
      occurred_at: payload.event_time ?? payload.updated_at ?? new Date().toISOString(),
      raw_payload: payload,
    });
    if (tracking.error?.code === "23505") return commerceJson({ ok: true, duplicate: true }, 200, null);
    if (tracking.error) throw new Error(`Tracking event persistence failed: ${tracking.error.message}`);

    await supabaseAdmin.from("shipments").update({
      status,
      awb_code: awb || undefined,
      courier_name: payload.courier_name ?? payload.courier ?? undefined,
      raw_metadata: payload,
    }).eq("id", shipmentResult.data.id);
    const orderResult = await supabaseAdmin.from("orders")
      .select("customer_id, subscription_id")
      .eq("id", shipmentResult.data.order_id)
      .single();
    const key = messageForShipment(status);
    if (key && orderResult.data) {
      await createCustomerMessage({
        customerId: orderResult.data.customer_id,
        key,
        orderId: shipmentResult.data.order_id,
        shipmentId: shipmentResult.data.id,
        subscriptionId: orderResult.data.subscription_id ?? undefined,
      });
    }
    return commerceJson({ ok: true }, 200, null);
  } catch (error) {
    return errorResponse(error, null);
  }
}

