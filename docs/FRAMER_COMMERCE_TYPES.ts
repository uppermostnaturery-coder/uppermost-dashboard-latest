/**
 * Frontend-safe types for the implemented Uppermost commerce API.
 *
 * Source of truth for this file:
 * - project/app/api/{commerce,shipping,checkout,payments,experience}
 * - project/lib/commerce/{schemas,apiShape,http,status,types}.ts
 *
 * This file intentionally contains no server secrets or provider-private data.
 */

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue =
  | JsonPrimitive
  | JsonValue[]
  | { [key: string]: JsonValue };

export type Currency = "INR";
export type PurchaseMode = "BUY_ONCE" | "SUBSCRIPTION";
export type SubscriptionIntervalDays = 15 | 30 | 60;
export type PaymentKind = "ONE_TIME" | "RECURRING_AUTH";

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

export type CommerceErrorCode =
  | "ORIGIN_NOT_ALLOWED"
  | "RATE_LIMITED"
  | "UNSUPPORTED_MEDIA_TYPE"
  | "PAYLOAD_TOO_LARGE"
  | "INVALID_JSON"
  | "VALIDATION_ERROR"
  | "UNKNOWN_SKU"
  | "SKU_UNAVAILABLE"
  | "INSUFFICIENT_INVENTORY"
  | "INVENTORY_UNAVAILABLE"
  | "IDEMPOTENCY_KEY_REQUIRED"
  | "IDEMPOTENCY_CONFLICT"
  | "REQUEST_IN_PROGRESS"
  | "INVALID_QUOTE"
  | "QUOTE_EXPIRED"
  | "QUOTE_CONSUMED"
  | "QUOTE_CHANGED"
  | "RECURRING_CONSENT_REQUIRED"
  | "UNSERVICEABLE_PINCODE"
  | "CUSTOMER_IDENTITY_CONFLICT"
  | "INVALID_PAYMENT_SIGNATURE"
  | "PAYMENT_ATTEMPT_NOT_FOUND"
  | "PAYMENT_MISMATCH"
  | "CHECKOUT_NOT_FOUND"
  | "INVALID_EXPERIENCE_TOKEN"
  | "EXPERIENCE_NOT_FOUND"
  | "SYSTEM_ERROR";

export interface CommerceFieldError {
  path: string;
  message: string;
}

export interface CommerceErrorBody {
  code: CommerceErrorCode;
  message: string;
  fields?: CommerceFieldError[];
  details?: {
    quote?: QuoteSuccessResponse;
    [key: string]: unknown;
  };
}

export interface CommerceErrorResponse {
  ok: false;
  error: CommerceErrorBody;
}

export interface BuyOnceCartLineInput {
  line_id: string;
  sku: string;
  qty: number;
  purchase_mode: "BUY_ONCE";
  interval_days?: never;
}

export interface SubscriptionCartLineInput {
  line_id: string;
  sku: string;
  qty: number;
  purchase_mode: "SUBSCRIPTION";
  interval_days: SubscriptionIntervalDays;
}

export type CartLineInput = BuyOnceCartLineInput | SubscriptionCartLineInput;

export interface DimensionsCm {
  length: number;
  breadth: number;
  height: number;
}

export interface NormalizedCartLine {
  line_id: string;
  sku: string;
  qty: number;
  purchase_mode: PurchaseMode;
  interval_days?: SubscriptionIntervalDays;
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
  dimensions_cm: DimensionsCm;
}

export type PromotionActionType =
  | "AMOUNT_OFF"
  | "PERCENT_OFF"
  | "FIXED_BUNDLE_PRICE"
  | "FREE_SHIPPING"
  | "SHIPPING_DISCOUNT"
  | "FREE_GIFT"
  | "FREE_GIFT_WRAP"
  | "BUY_X_GET_Y"
  | "INFORMATIONAL";

export interface QuotePromotion {
  promotion_id: string;
  code: string;
  label: string;
  type: PromotionActionType;
  amount_paise: number;
  /** The public quote mapper currently emits this literal for every adjustment. */
  scope: "INITIAL";
  applies_to_line_ids: string[];
}

export interface OrderBenefit {
  promotion_id: string;
  code: string;
  benefit_type: string;
  label: string;
  metadata: Record<string, JsonValue>;
}

export interface QuoteTotals {
  subtotal_paise: number;
  discount_paise: number;
  shipping_paise: number;
  tax_paise: number;
  total_paise: number;
}

export interface RecurringQuoteGroup {
  interval_days: SubscriptionIntervalDays;
  items: NormalizedCartLine[];
  projected_subtotal_paise: number;
  projected_discount_paise: number;
  projected_total_paise: number;
  mandate_max_amount_paise: number;
}

export interface QuoteShipping {
  serviceable: boolean | null;
  estimated_delivery_from: string | null;
  estimated_delivery_to: string | null;
  best_courier_internal_reference?: string;
  shipping_amount_paise: number;
  display: string;
}

export interface QuoteRequest {
  guest_session_id: string;
  items: CartLineInput[];
  postal_code?: string;
}

export interface QuoteSuccessResponse {
  ok: true;
  quote_id: string;
  quote_token: string;
  currency: Currency;
  valid_until: string;
  items: NormalizedCartLine[];
  promotions: QuotePromotion[];
  benefits: OrderBenefit[];
  initial: QuoteTotals;
  recurring_groups: RecurringQuoteGroup[];
  shipping: QuoteShipping;
}

export type QuoteResponse = QuoteSuccessResponse | CommerceErrorResponse;

export interface ShippingServiceabilityRequest {
  postal_code: string;
  items: CartLineInput[];
}

export interface ShippingServiceabilitySuccessResponse {
  ok: true;
  serviceable: boolean;
  estimated_delivery_from: string | null;
  estimated_delivery_to: string | null;
  best_courier_internal_reference?: string;
  shipping_amount_paise: number;
  message: string;
}

export type ShippingServiceabilityResponse =
  | ShippingServiceabilitySuccessResponse
  | CommerceErrorResponse;

export interface CheckoutCustomer {
  name: string;
  email: string;
  phone: string;
}

export interface CheckoutAddress {
  line1: string;
  line2?: string | null;
  landmark?: string | null;
  city: string;
  state: string;
  postal_code: string;
  country: "IN";
}

export interface RecurringConsent {
  accepted: true;
  version: string;
}

export interface CheckoutPrepareRequest {
  guest_session_id: string;
  quote_id: string;
  quote_token: string;
  customer: CheckoutCustomer;
  shipping_address: CheckoutAddress;
  billing_same_as_shipping: boolean;
  recurring_consent?: RecurringConsent;
}

export interface RazorpayPublicCheckoutPayload {
  /** Map to Razorpay Checkout option `key`. This is a publishable key ID. */
  key_id: string;
  order_id: string;
  /** Present for recurring authorization checkouts. */
  customer_id?: string;
  /** Map to Razorpay Checkout option `amount`; integer paise. */
  amount_paise: number;
  currency: Currency;
  recurring: boolean;
  prefill: {
    name: string;
    email: string;
    contact: string;
  };
}

export interface CheckoutDisplayAmounts {
  amount_now_paise: number;
  recurring_projection_paise: number;
  mandate_max_amount_paise: number | null;
  interval_days: SubscriptionIntervalDays | null;
}

export interface CheckoutPrepareSuccessResponse {
  ok: true;
  checkout_session_id: string;
  uppermost_order_id: string;
  payment_kind: PaymentKind;
  state: "CHECKOUT_READY";
  razorpay: RazorpayPublicCheckoutPayload;
  display: CheckoutDisplayAmounts;
  /** UUID for subscription/mixed carts; null for a pure buy-once cart. */
  subscription_id: string | null;
}

export type CheckoutPrepareResponse =
  | CheckoutPrepareSuccessResponse
  | CommerceErrorResponse;

export interface PaymentVerifyRequest {
  checkout_session_id: string;
  razorpay_payment_id: string;
  razorpay_order_id: string;
  razorpay_signature: string;
}

export type MessageSeverity = "INFO" | "SUCCESS" | "WARNING" | "ERROR";

export interface CustomerMessage {
  key: CustomerMessageKey;
  title: string;
  body: string;
  severity: MessageSeverity;
  cta_label?: string;
  cta_url?: string;
}

export interface CheckoutStatusSuccessResponse {
  ok: true;
  state: NormalizedPaymentState;
  retry_allowed: boolean;
  /** Human-facing Uppermost order number, not the internal order UUID. */
  order_id?: string;
  subscription_id?: string;
  message: CustomerMessage;
  next?: {
    type: "EXPERIENCE";
    /** Framer page URL; its `t` value is passed to /api/experience as `token`. */
    url: string;
  };
}

export type PaymentVerifyResponse =
  | CheckoutStatusSuccessResponse
  | CommerceErrorResponse;

export type CheckoutStatusResponse =
  | CheckoutStatusSuccessResponse
  | CommerceErrorResponse;

export interface ExperienceOrderItem {
  sku: string;
  product_name: string;
  variant_name: string;
  quantity: number;
  purchase_mode: PurchaseMode;
  interval_days: SubscriptionIntervalDays | null;
  unit_price_paise: number;
  line_total_paise: number;
}

export interface ExperienceAdjustment {
  label: string;
  adjustment_type: string;
  amount_paise: number;
  scope: string;
}

export type BenefitFulfilmentStatus =
  | "PENDING"
  | "ALLOCATED"
  | "FULFILLED"
  | "CANCELLED";

export interface ExperienceBenefit {
  benefit_type: string;
  label: string;
  fulfilment_status: BenefitFulfilmentStatus;
}

export interface TrackingEvent {
  status: string;
  description: string | null;
  location: string | null;
  occurred_at: string;
}

export interface ExperienceDelivery {
  status: string;
  expected_from: string | null;
  expected_to: string | null;
  courier_display_name: string | null;
  awb_masked_or_safe: string | null;
  latest_event: TrackingEvent | null;
  /** Newest event first. */
  timeline: TrackingEvent[];
}

export type SubscriptionStatus =
  | "PENDING_AUTH"
  | "ACTIVE"
  | "PAUSED"
  | "REAUTH_REQUIRED"
  | "CANCELLED"
  | "EXPIRED";

export interface ExperienceSubscribedItem {
  sku: string;
  quantity: number;
  status: "ACTIVE";
}

export interface ExperienceSubscription {
  active: boolean;
  status: SubscriptionStatus;
  subscribed_items: ExperienceSubscribedItem[];
  interval_days: SubscriptionIntervalDays | null;
  next_charge_at: string | null;
  projected_next_amount_paise: number | null;
  mandate_max_amount_paise: number | null;
}

export interface ExperienceSuccessResponse {
  ok: true;
  /** Current order status stored by the backend. */
  state: string;
  message: CustomerMessage;
  order: {
    display_order_number: string;
    placed_at: string;
    items: ExperienceOrderItem[];
    adjustments: ExperienceAdjustment[];
    benefits: ExperienceBenefit[];
    total_paise: number;
  };
  delivery: ExperienceDelivery;
  /** Present only when the order belongs to a subscription. */
  subscription?: ExperienceSubscription;
  customer: {
    first_name: string | null;
    masked_phone: string | null;
    city: string | null;
    postal_code: string | null;
  };
}

export type ExperienceResponse =
  | ExperienceSuccessResponse
  | CommerceErrorResponse;

export type CommerceApiResponse =
  | QuoteResponse
  | ShippingServiceabilityResponse
  | CheckoutPrepareResponse
  | PaymentVerifyResponse
  | CheckoutStatusResponse
  | ExperienceResponse;
