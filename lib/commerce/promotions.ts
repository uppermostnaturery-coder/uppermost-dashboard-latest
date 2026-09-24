import { supabaseAdmin } from "@/lib/supabaseAdmin";
import type { PromotionDefinition, PromotionEntitlement } from "./types";

export async function loadActivePromotions(now: string): Promise<PromotionDefinition[]> {
  const { data, error } = await supabaseAdmin
    .from("promotions")
    .select(
      "id, code, label, status, valid_from, valid_until, conditions, actions, priority, stackable, stacking_group, usage_limit, usage_count, version"
    )
    .eq("status", "ACTIVE")
    .or(`valid_from.is.null,valid_from.lte.${now}`)
    .or(`valid_until.is.null,valid_until.gt.${now}`)
    .order("priority", { ascending: false });

  if (error) throw new Error(`Promotion lookup failed: ${error.message}`);
  return (data ?? []) as unknown as PromotionDefinition[];
}

export async function loadPromotionEntitlements(args: {
  customerId?: string;
  subscriptionId?: string;
  now: string;
}): Promise<PromotionEntitlement[]> {
  if (!args.customerId) return [];

  let query = supabaseAdmin
    .from("promotion_entitlements")
    .select(
      "promotion_id, customer_id, subscription_id, starts_at, ends_at, remaining_uses, status, is_grandfathered"
    )
    .eq("customer_id", args.customerId)
    .eq("status", "ACTIVE")
    .lte("starts_at", args.now)
    .or(`ends_at.is.null,ends_at.gt.${args.now}`);

  if (args.subscriptionId) {
    query = query.or(`subscription_id.is.null,subscription_id.eq.${args.subscriptionId}`);
  } else {
    query = query.is("subscription_id", null);
  }

  const { data, error } = await query;
  if (error) throw new Error(`Promotion entitlement lookup failed: ${error.message}`);
  return (data ?? []) as unknown as PromotionEntitlement[];
}

export function promotionVersion(promotions: PromotionDefinition[]): string {
  return promotions
    .map((promotion) => `${promotion.id}:${promotion.version}`)
    .sort()
    .join("|");
}

