import type {
  CartLineInput,
  CartQuote,
  CatalogVariant,
  NormalizedCartLine,
  OrderBenefit,
  PricingAdjustment,
  PricingContext,
  PromotionDefinition,
  PromotionEntitlement,
  PromotionEvaluation,
  PurchaseMode,
} from "../types";

export type CalculateCartQuoteInput = {
  items: CartLineInput[];
  catalog: CatalogVariant[];
  promotions: PromotionDefinition[];
  entitlements?: PromotionEntitlement[];
  context: PricingContext;
  shipping_paise?: number;
  tax_paise?: number;
};

function cartShape(items: CartLineInput[]): PurchaseMode | "MIXED" {
  const modes = new Set(items.map((item) => item.purchase_mode));
  if (modes.size > 1) return "MIXED";
  return items[0]?.purchase_mode ?? "BUY_ONCE";
}

function activeEntitlement(
  promotionId: string,
  entitlements: PromotionEntitlement[],
  context: PricingContext
): boolean {
  const now = new Date(context.now).getTime();
  return entitlements.some((entitlement) => {
    if (entitlement.promotion_id !== promotionId || entitlement.status !== "ACTIVE") {
      return false;
    }
    if (entitlement.customer_id !== context.customer_id) return false;
    if (
      entitlement.subscription_id &&
      entitlement.subscription_id !== context.subscription_id
    ) {
      return false;
    }
    if (new Date(entitlement.starts_at).getTime() > now) return false;
    if (entitlement.ends_at && new Date(entitlement.ends_at).getTime() <= now) {
      return false;
    }
    return entitlement.remaining_uses === null || entitlement.remaining_uses === undefined || entitlement.remaining_uses > 0;
  });
}

function promotionEligibility(
  promotion: PromotionDefinition,
  items: NormalizedCartLine[],
  context: PricingContext,
  entitlements: PromotionEntitlement[],
  subtotal: number
): string | null {
  const now = new Date(context.now).getTime();
  if (promotion.status !== "ACTIVE") return "PROMOTION_NOT_ACTIVE";
  if (promotion.valid_from && now < new Date(promotion.valid_from).getTime()) {
    return "NOT_STARTED";
  }
  if (promotion.valid_until && now >= new Date(promotion.valid_until).getTime()) {
    return "EXPIRED";
  }
  if (
    promotion.usage_limit !== null &&
    promotion.usage_limit !== undefined &&
    (promotion.usage_count ?? 0) >= promotion.usage_limit
  ) {
    return "USAGE_LIMIT_REACHED";
  }

  const conditions = promotion.conditions ?? {};
  if (conditions.lifecycle && !conditions.lifecycle.includes(context.stage)) {
    return "LIFECYCLE_MISMATCH";
  }
  if (conditions.minimum_cart_value_paise && subtotal < conditions.minimum_cart_value_paise) {
    return "MINIMUM_CART_VALUE_NOT_MET";
  }
  const totalQuantity = items.reduce((sum, item) => sum + item.qty, 0);
  if (conditions.minimum_quantity && totalQuantity < conditions.minimum_quantity) {
    return "MINIMUM_QUANTITY_NOT_MET";
  }
  if (conditions.skus && !items.some((item) => conditions.skus!.includes(item.sku))) {
    return "SKU_MISMATCH";
  }
  if (
    conditions.product_codes &&
    !items.some((item) => conditions.product_codes!.includes(item.product_code))
  ) {
    return "PRODUCT_MISMATCH";
  }
  if (
    conditions.required_product_codes &&
    !conditions.required_product_codes.every((code) =>
      items.some((item) => item.product_code === code)
    )
  ) {
    return "REQUIRED_COMBINATION_MISSING";
  }
  if (
    conditions.purchase_modes &&
    !(conditions.purchase_modes as string[]).includes(cartShape(items))
  ) {
    return "PURCHASE_MODE_MISMATCH";
  }
  if (
    conditions.minimum_subscription_cycle &&
    (context.cycle_number ?? 1) < conditions.minimum_subscription_cycle
  ) {
    return "SUBSCRIPTION_CYCLE_TOO_EARLY";
  }
  if (
    conditions.maximum_subscription_cycle &&
    (context.cycle_number ?? 1) > conditions.maximum_subscription_cycle
  ) {
    return "SUBSCRIPTION_CYCLE_TOO_LATE";
  }
  if (conditions.first_order_only && !context.is_first_order) return "FIRST_ORDER_ONLY";
  if (conditions.returning_customer_only && !context.is_returning_customer) {
    return "RETURNING_CUSTOMER_ONLY";
  }
  if (conditions.audience === "NEW_SUBSCRIBERS" && !context.is_new_subscriber) {
    return "NEW_SUBSCRIBERS_ONLY";
  }
  if (conditions.audience === "EXISTING_SUBSCRIBERS" && context.is_new_subscriber !== false) {
    return "EXISTING_SUBSCRIBERS_ONLY";
  }
  if (
    conditions.customer_cohorts &&
    !conditions.customer_cohorts.some((cohort) => context.customer_cohorts?.includes(cohort))
  ) {
    return "COHORT_MISMATCH";
  }
  if (conditions.countries && !conditions.countries.includes(context.shipping_country ?? "IN")) {
    return "COUNTRY_MISMATCH";
  }
  if (conditions.requires_entitlement && !activeEntitlement(promotion.id, entitlements, context)) {
    return "ENTITLEMENT_REQUIRED";
  }
  return null;
}

function matchingLines(
  promotion: PromotionDefinition,
  items: NormalizedCartLine[]
): NormalizedCartLine[] {
  const { skus, product_codes } = promotion.conditions;
  if (!skus && !product_codes) return items;
  return items.filter(
    (item) =>
      (skus?.includes(item.sku) ?? false) ||
      (product_codes?.includes(item.product_code) ?? false)
  );
}

export function calculateCartQuote(input: CalculateCartQuoteInput): CartQuote {
  const catalogBySku = new Map(input.catalog.map((variant) => [variant.sku, variant]));
  const sourceItems =
    input.context.stage === "RENEWAL"
      ? input.items.filter((item) => item.purchase_mode === "SUBSCRIPTION")
      : input.items;

  if (sourceItems.length === 0) {
    throw new Error("The evaluated cart has no eligible items.");
  }

  const subscriptionIntervals = new Set(
    sourceItems
      .filter((item) => item.purchase_mode === "SUBSCRIPTION")
      .map((item) => item.interval_days)
  );
  if (subscriptionIntervals.size > 1) {
    throw new Error("All subscription lines must use one common interval in V1.");
  }

  const items: NormalizedCartLine[] = sourceItems.map((item) => {
    const variant = catalogBySku.get(item.sku);
    if (!variant || !variant.is_active) {
      throw new Error(`SKU is unavailable: ${item.sku}`);
    }
    if (variant.currency !== "INR") throw new Error(`Unsupported currency for ${item.sku}.`);
    if (item.qty < 1 || item.qty > 20 || !Number.isInteger(item.qty)) {
      throw new Error(`Invalid quantity for ${item.sku}.`);
    }
    const subtotal = variant.price_paise * item.qty;
    return {
      ...item,
      product_id: variant.product_id,
      product_variant_id: variant.id,
      product_code: variant.product_code,
      product_name: variant.product_name,
      variant_name: variant.variant_name,
      size_label: variant.size_label,
      unit_price_paise: variant.price_paise,
      line_subtotal_paise: subtotal,
      line_total_paise: subtotal,
      weight_grams: variant.weight_grams * item.qty,
      dimensions_cm: {
        length: variant.length_cm,
        breadth: variant.breadth_cm,
        height: variant.height_cm * item.qty,
      },
    };
  });

  const subtotal = items.reduce((sum, item) => sum + item.line_subtotal_paise, 0);
  let shipping = Math.max(0, Math.round(input.shipping_paise ?? 0));
  const tax = Math.max(0, Math.round(input.tax_paise ?? 0));
  let remainingMerchandise = subtotal;
  const adjustments: PricingAdjustment[] = [];
  const benefits: OrderBenefit[] = [];
  const evaluated: PromotionEvaluation[] = [];
  const appliedGroups = new Set<string>();

  const promotions = [...input.promotions].sort(
    (left, right) => right.priority - left.priority || left.code.localeCompare(right.code)
  );

  for (const promotion of promotions) {
    const rejection = promotionEligibility(
      promotion,
      items,
      input.context,
      input.entitlements ?? [],
      subtotal
    );

    if (rejection) {
      evaluated.push({
        promotion_id: promotion.id,
        code: promotion.code,
        label: promotion.label,
        eligible: false,
        reason: rejection,
      });
      continue;
    }

    if (
      promotion.stacking_group &&
      appliedGroups.has(promotion.stacking_group) &&
      !promotion.stackable
    ) {
      evaluated.push({
        promotion_id: promotion.id,
        code: promotion.code,
        label: promotion.label,
        eligible: false,
        reason: "STACKING_GROUP_ALREADY_APPLIED",
      });
      continue;
    }

    const lines = matchingLines(promotion, items);
    let applied = false;

    for (const action of promotion.actions) {
      const scope = action.scope ?? "CART";
      const eligibleSubtotal =
        scope === "MATCHING_LINES"
          ? lines.reduce((sum, item) => sum + item.line_subtotal_paise, 0)
          : remainingMerchandise;
      let amount = 0;

      if (action.type === "AMOUNT_OFF") {
        amount = Math.min(
          eligibleSubtotal,
          remainingMerchandise,
          Math.max(0, Math.round(action.amount_paise ?? 0))
        );
      } else if (action.type === "PERCENT_OFF") {
        const percent = Math.min(100, Math.max(0, action.percent ?? 0));
        amount = Math.min(
          eligibleSubtotal,
          remainingMerchandise,
          Math.round((eligibleSubtotal * percent) / 100)
        );
      } else if (action.type === "FIXED_BUNDLE_PRICE") {
        amount = Math.min(
          remainingMerchandise,
          Math.max(0, eligibleSubtotal - Math.max(0, action.fixed_price_paise ?? 0))
        );
      } else if (action.type === "FREE_SHIPPING") {
        amount = shipping;
        shipping = 0;
      } else if (action.type === "SHIPPING_DISCOUNT") {
        amount = Math.min(shipping, Math.max(0, action.amount_paise ?? 0));
        shipping -= amount;
      } else {
        benefits.push({
          promotion_id: promotion.id,
          code: promotion.code,
          benefit_type: action.type,
          label: action.label ?? promotion.label,
          metadata: action.metadata ?? {},
        });
        applied = true;
        continue;
      }

      if (amount > 0 || action.type === "FREE_SHIPPING") {
        if (action.type !== "FREE_SHIPPING" && action.type !== "SHIPPING_DISCOUNT") {
          remainingMerchandise = Math.max(0, remainingMerchandise - amount);
        }
        adjustments.push({
          promotion_id: promotion.id,
          code: promotion.code,
          label: action.label ?? promotion.label,
          type: action.type,
          amount_paise: amount,
          scope,
          applies_to_line_ids: lines.map((line) => line.line_id),
        });
        applied = true;
      }
    }

    evaluated.push({
      promotion_id: promotion.id,
      code: promotion.code,
      label: promotion.label,
      eligible: applied,
      ...(!applied ? { reason: "NO_EFFECT" } : {}),
    });

    if (applied && promotion.stacking_group && !promotion.stackable) {
      appliedGroups.add(promotion.stacking_group);
    }
  }

  const discount = adjustments
    .filter((adjustment) => adjustment.scope !== "SHIPPING")
    .reduce((sum, adjustment) => sum + adjustment.amount_paise, 0);
  const total = Math.max(0, subtotal - discount + shipping + tax);

  return {
    currency: "INR",
    stage: input.context.stage,
    items,
    promotions_evaluated: evaluated,
    promotions_applied: evaluated.filter((promotion) => promotion.eligible),
    promotions_rejected: evaluated.filter((promotion) => !promotion.eligible),
    adjustments,
    benefits,
    subtotal_paise: subtotal,
    discount_paise: discount,
    shipping_paise: shipping,
    tax_paise: tax,
    total_paise: total,
  };
}

export function calculateMandateMaxAmount(
  initialTotalPaise: number,
  projectedRecurringTotalPaise: number,
  bufferPaise: number
): number {
  return Math.max(
    Math.max(0, Math.round(initialTotalPaise)),
    Math.max(0, Math.round(projectedRecurringTotalPaise)) +
      Math.max(0, Math.round(bufferPaise))
  );
}
