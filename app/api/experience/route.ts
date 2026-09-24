import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { tokenHash } from "@/lib/commerce/crypto";
import { getCommerceEnv } from "@/lib/commerce/env";
import {
  assertCommerceOrigin,
  CommerceError,
  commerceCorsHeaders,
  commerceJson,
  enforceRateLimit,
  errorResponse,
} from "@/lib/commerce/http";
import { resolveMessage } from "@/lib/commerce/messages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function maskedPhone(phone: string | null): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  return digits.length < 4 ? "••••" : `••••••${digits.slice(-4)}`;
}

export async function OPTIONS(request: Request) {
  return new Response(null, {
    status: 204,
    headers: commerceCorsHeaders(request.headers.get("origin"), "GET, OPTIONS"),
  });
}

export async function GET(request: Request) {
  let origin: string | null = null;
  try {
    origin = assertCommerceOrigin(request);
    enforceRateLimit(request, "experience", 90);
    const token = new URL(request.url).searchParams.get("token");
    if (!token || token.length < 32) throw new CommerceError("INVALID_EXPERIENCE_TOKEN", "Invalid experience token.", 400);
    const orderResult = await supabaseAdmin.from("orders")
      .select("id, order_number, customer_id, subscription_id, status, total_paise, created_at, address_snapshot")
      .eq("experience_token_hash", tokenHash(token, getCommerceEnv().tokenPepper))
      .maybeSingle();
    if (orderResult.error) throw new Error(`Experience lookup failed: ${orderResult.error.message}`);
    if (!orderResult.data) throw new CommerceError("EXPERIENCE_NOT_FOUND", "Order experience was not found.", 404);
    const order = orderResult.data;
    const [itemsResult, adjustmentResult, benefitsResult, shipmentResult, customerResult] = await Promise.all([
      supabaseAdmin.from("order_items").select("sku, product_name, variant_name, quantity, purchase_mode, interval_days, unit_price_paise, line_total_paise").eq("order_id", order.id),
      supabaseAdmin.from("order_adjustments").select("label, adjustment_type, amount_paise, scope").eq("order_id", order.id),
      supabaseAdmin.from("order_benefits").select("benefit_type, label, fulfilment_status").eq("order_id", order.id),
      supabaseAdmin.from("shipments").select("id, status, expected_from, expected_to, courier_name, awb_code").eq("order_id", order.id).maybeSingle(),
      supabaseAdmin.from("customers").select("first_name, phone").eq("id", order.customer_id).single(),
    ]);
    const shipment = shipmentResult.data;
    const timelineResult = shipment
      ? await supabaseAdmin.from("tracking_events")
          .select("status, description, location, occurred_at")
          .eq("shipment_id", shipment.id)
          .order("occurred_at", { ascending: false })
      : { data: [] as any[] };
    let subscription: Record<string, unknown> | undefined;
    if (order.subscription_id) {
      const [sub, mandate, subItems] = await Promise.all([
        supabaseAdmin.from("subscriptions").select("status, interval_days, next_charge_at, current_cycle_number").eq("id", order.subscription_id).single(),
        supabaseAdmin.from("recurring_mandates").select("max_amount_paise, status").eq("subscription_id", order.subscription_id).maybeSingle(),
        supabaseAdmin.from("subscription_items").select("sku, quantity, status").eq("subscription_id", order.subscription_id).eq("status", "ACTIVE"),
      ]);
      const cycle = await supabaseAdmin.from("subscription_cycles")
        .select("amount_paise, pricing_snapshot")
        .eq("subscription_id", order.subscription_id)
        .order("cycle_number", { ascending: false })
        .limit(1)
        .maybeSingle();
      subscription = {
        active: sub.data?.status === "ACTIVE",
        status: sub.data?.status ?? "PENDING_AUTH",
        subscribed_items: subItems.data ?? [],
        interval_days: sub.data?.interval_days ?? null,
        next_charge_at: sub.data?.next_charge_at ?? null,
        projected_next_amount_paise: cycle.data?.amount_paise ?? null,
        mandate_max_amount_paise: mandate.data?.max_amount_paise ?? null,
      };
    }
    const message = await resolveMessage(order.status === "CONFIRMED" ? "PAYMENT_CONFIRMED" : "PAYMENT_PENDING");
    const address = order.address_snapshot as Record<string, unknown>;
    return commerceJson({
      ok: true,
      state: order.status,
      message,
      order: {
        display_order_number: order.order_number,
        placed_at: order.created_at,
        items: itemsResult.data ?? [],
        adjustments: adjustmentResult.data ?? [],
        benefits: benefitsResult.data ?? [],
        total_paise: order.total_paise,
      },
      delivery: {
        status: shipment?.status ?? "NOT_CREATED",
        expected_from: shipment?.expected_from ?? null,
        expected_to: shipment?.expected_to ?? null,
        courier_display_name: shipment?.courier_name ?? null,
        awb_masked_or_safe: shipment?.awb_code ?? null,
        latest_event: timelineResult.data?.[0] ?? null,
        timeline: timelineResult.data ?? [],
      },
      ...(subscription ? { subscription } : {}),
      customer: {
        first_name: customerResult.data?.first_name ?? null,
        masked_phone: maskedPhone(customerResult.data?.phone ?? null),
        city: address.city ?? null,
        postal_code: address.postal_code ?? null,
      },
    }, 200, origin, "GET, OPTIONS");
  } catch (error) {
    return errorResponse(error, origin);
  }
}
