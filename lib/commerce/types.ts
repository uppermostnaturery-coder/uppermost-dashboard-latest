export type PurchaseMode = "BUY_ONCE" | "SUBSCRIPTION";
export type PricingStage = "INITIAL" | "RENEWAL";
export type SubscriptionIntervalDays = 15 | 30 | 60;

export type CartLineInput = {
  line_id: string;
  sku: string;
  qty: number;
  purchase_mode: PurchaseMode;
  interval_days?: SubscriptionIntervalDays;
};

export type CatalogVariant = {
  id: string;
  product_id: string;
  product_code: string;
  product_name: string;
  product_family: string;
  sku: string;
  variant_name: string;
  size_label: string;
  price_paise: number;
  currency: "INR";
  weight_grams: number;
  length_cm: number;
  breadth_cm: number;
  height_cm: number;
  external_shopify_variant_id?: string | null;
  inventory_policy: "SUPABASE" | "SHOPIFY";
  inventory_quantity?: number | null;
  is_active: boolean;
};

export type NormalizedCartLine = CartLineInput & {
  product_id: string;
  product_variant_id: string;
  product_code: string;
  product_name: string;
  variant_name: string;
  size_label: string;
  unit_price_paise: number;
  line_subtotal_paise: number;
  line_total_paise: number;
  weight_grams: number;
  dimensions_cm: {
    length: number;
    breadth: number;
    height: number;
  };
};

export type PromotionConditions = {
  skus?: string[];
  product_codes?: string[];
  required_product_codes?: string[];
  minimum_cart_value_paise?: number;
  minimum_quantity?: number;
  purchase_modes?: PurchaseMode[] | ["MIXED"];
  lifecycle?: PricingStage[];
  minimum_subscription_cycle?: number;
  maximum_subscription_cycle?: number;
  audience?:
    | "ALL"
    | "NEW_SUBSCRIBERS"
    | "EXISTING_SUBSCRIBERS"
    | "NEW_SUBSCRIBERS_AND_BUYERS";
  customer_cohorts?: string[];
  requires_entitlement?: boolean;
  first_order_only?: boolean;
  returning_customer_only?: boolean;
  countries?: string[];
};

export type PromotionAction = {
  type:
    | "AMOUNT_OFF"
    | "PERCENT_OFF"
    | "FIXED_BUNDLE_PRICE"
    | "FREE_SHIPPING"
    | "SHIPPING_DISCOUNT"
    | "FREE_GIFT"
    | "FREE_GIFT_WRAP"
    | "BUY_X_GET_Y"
    | "INFORMATIONAL";
  amount_paise?: number;
  percent?: number;
  fixed_price_paise?: number;
  scope?: "CART" | "MATCHING_LINES" | "SHIPPING";
  label?: string;
  metadata?: Record<string, unknown>;
};

export type PromotionDefinition = {
  id: string;
  code: string;
  label: string;
  status: "DRAFT" | "ACTIVE" | "PAUSED" | "ARCHIVED";
  valid_from?: string | null;
  valid_until?: string | null;
  conditions: PromotionConditions;
  actions: PromotionAction[];
  priority: number;
  stackable: boolean;
  stacking_group?: string | null;
  usage_limit?: number | null;
  usage_count?: number;
  version: number;
};

export type PromotionEntitlement = {
  promotion_id: string;
  customer_id: string;
  subscription_id?: string | null;
  starts_at: string;
  ends_at?: string | null;
  remaining_uses?: number | null;
  status: "ACTIVE" | "PAUSED" | "EXPIRED" | "REVOKED";
  is_grandfathered: boolean;
};

export type PricingContext = {
  stage: PricingStage;
  customer_id?: string;
  subscription_id?: string;
  subscription_started_at?: string;
  cycle_number?: number;
  now: string;
  is_new_subscriber?: boolean;
  is_first_order?: boolean;
  is_returning_customer?: boolean;
  customer_cohorts?: string[];
  shipping_country?: string;
};

export type PricingAdjustment = {
  promotion_id: string;
  code: string;
  label: string;
  type: PromotionAction["type"];
  amount_paise: number;
  scope: string;
  applies_to_line_ids: string[];
};

export type OrderBenefit = {
  promotion_id: string;
  code: string;
  benefit_type: string;
  label: string;
  metadata: Record<string, unknown>;
};

export type PromotionEvaluation = {
  promotion_id: string;
  code: string;
  label: string;
  eligible: boolean;
  reason?: string;
};

export type CartQuote = {
  currency: "INR";
  stage: PricingStage;
  items: NormalizedCartLine[];
  promotions_evaluated: PromotionEvaluation[];
  promotions_applied: PromotionEvaluation[];
  promotions_rejected: PromotionEvaluation[];
  adjustments: PricingAdjustment[];
  benefits: OrderBenefit[];
  subtotal_paise: number;
  discount_paise: number;
  shipping_paise: number;
  tax_paise: number;
  total_paise: number;
};

export type CustomerMessageKey =
  | "PAYMENT_CONFIRMING"
  | "PAYMENT_CONFIRMED"
  | "PAYMENT_PENDING"
  | "PAYMENT_FAILED"
  | "ORDER_PREPARING"
  | "ORDER_SHIPPED"
  | "IN_TRANSIT"
  | "OUT_FOR_DELIVERY"
  | "DELIVERED"
  | "RENEWAL_UPCOMING"
  | "RENEWAL_SUCCESS"
  | "RENEWAL_FAILED"
  | "MANDATE_REAUTH_REQUIRED"
  | "MANDATE_PAUSED"
  | "QUOTE_CHANGED";

export type NormalizedPaymentState =
  | "CHECKOUT_READY"
  | "AUTHORIZING"
  | "VERIFYING"
  | "CONFIRMED"
  | "ACTIVATION_PENDING"
  | "PENDING"
  | "FAILED_RETRYABLE"
  | "INSUFFICIENT_FUNDS"
  | "MANDATE_ACTION_REQUIRED"
  | "MANDATE_PAUSED"
  | "MANDATE_EXPIRED"
  | "CAP_EXCEEDED"
  | "CUSTOMER_CANCELLED"
  | "QUOTE_CHANGED"
  | "QUOTE_EXPIRED"
  | "SYSTEM_ERROR";

