# Uppermost Commerce API Contract (V1)

This is the Framer/backend contract. The frozen architecture remains `../../docs/UPPERMOST_COMMERCE_ARCHITECTURE.md`.

## Conventions

- JSON is used unless noted. Currency is `INR`.
- Every money field is integer **paise** and ends in `_paise`; `100` means ₹1.
- Browser routes allow `https://uppermost.store`, `https://www.uppermost.store`, and `COMMERCE_ALLOWED_ORIGINS`. Localhost is non-production only; production never uses wildcard CORS.
- `POST /api/checkout/prepare` and `POST /api/payments/verify` require `Idempotency-Key` (8–200 characters). Same key/request replays; same key/different request returns `409 IDEMPOTENCY_CONFLICT`.
- Error shape: `{ "ok": false, "error": { "code": "...", "message": "...", "details"?: {} } }`. Raw provider errors and secrets are not returned.

## Cart line

```json
{ "line_id": "line_x", "sku": "GIR-1000", "qty": 1, "purchase_mode": "SUBSCRIPTION", "interval_days": 30 }
```

`purchase_mode` is `BUY_ONCE` or `SUBSCRIPTION`. `interval_days` is required only for subscription lines and is `15`, `30`, or `60`. V1 requires one common interval. Initial pricing includes every line; renewal pricing includes subscription lines only.

## `POST /api/commerce/quote`

Request:

```json
{
  "guest_session_id": "gs_high_entropy_session",
  "items": [
    { "line_id": "gir", "sku": "GIR-1000", "qty": 1, "purchase_mode": "SUBSCRIPTION", "interval_days": 30 },
    { "line_id": "murrah", "sku": "MURRAH-1000", "qty": 1, "purchase_mode": "BUY_ONCE" }
  ],
  "postal_code": "122001"
}
```

Response (`201`):

```json
{
  "ok": true,
  "quote_id": "quo_...",
  "quote_token": "qt_...",
  "currency": "INR",
  "valid_until": "...",
  "items": [],
  "promotions": [{ "promotion_id": "uuid", "code": "THE_PAIR", "label": "The Pair", "type": "AMOUNT_OFF", "amount_paise": 50000, "scope": "INITIAL", "applies_to_line_ids": ["gir", "murrah"] }],
  "benefits": [],
  "initial": { "subtotal_paise": 1300000, "discount_paise": 50000, "shipping_paise": 0, "tax_paise": 0, "total_paise": 1250000 },
  "recurring_groups": [{ "interval_days": 30, "items": [], "projected_subtotal_paise": 750000, "projected_discount_paise": 50000, "projected_total_paise": 700000, "mandate_max_amount_paise": 1250000 }],
  "shipping": { "serviceable": true, "estimated_delivery_from": "...", "estimated_delivery_to": "...", "shipping_amount_paise": 0, "display": "Estimated ..." }
}
```

The token is returned once and stored as an HMAC hash. Quote ID alone is not authorization. The server binds context, normalized cart, versions, snapshot, shipping, status, and expiry.

## `POST /api/shipping/serviceability`

Request: `{ "postal_code": "122001", "items": [<cart line>] }`.

Response: `{ "ok": true, "serviceable": true, "estimated_delivery_from": "...", "estimated_delivery_to": "...", "best_courier_internal_reference"?: "...", "shipping_amount_paise": 0, "message": "..." }`.

Origin, value, weight, dimensions, and prepaid mode are server-derived. Provider credentials/raw responses are not exposed.

## `POST /api/checkout/prepare`

Requires `Idempotency-Key`.

```json
{
  "guest_session_id": "gs_high_entropy_session",
  "quote_id": "quo_...",
  "quote_token": "qt_...",
  "customer": { "name": "Asha Singh", "email": "asha@example.com", "phone": "+919999999999" },
  "shipping_address": { "line1": "12 Market Road", "line2": null, "landmark": null, "city": "Gurugram", "state": "Haryana", "postal_code": "122001", "country": "IN" },
  "billing_same_as_shipping": true,
  "recurring_consent": { "accepted": true, "version": "recurring-2026-09-v1" }
}
```

Consent is required if any line subscribes. The backend revalidates token/binding/status/expiry, inventory, serviceability, and pricing. A change returns `409 QUOTE_CHANGED` with a new quote under `error.details.quote`; it never silently changes the charge.

Response (`201`):

```json
{
  "ok": true,
  "checkout_session_id": "uuid",
  "uppermost_order_id": "UPM-20260924-000001",
  "payment_kind": "RECURRING_AUTH",
  "state": "CHECKOUT_READY",
  "razorpay": { "key_id": "rzp_public_id", "order_id": "order_...", "customer_id": "cust_...", "amount_paise": 1250000, "currency": "INR", "recurring": true, "prefill": { "name": "...", "email": "...", "contact": "..." } },
  "display": { "amount_now_paise": 1250000, "recurring_projection_paise": 700000, "mandate_max_amount_paise": 1250000, "interval_days": 30 }
}
```

Mixed checkout charges every initial line in the authorization order. Future recurring projection contains subscription lines only. The mandate maximum is `max(initial total, projected recurring total + configured buffer)`.

## `POST /api/payments/verify`

Requires `Idempotency-Key`. Request:

```json
{ "checkout_session_id": "uuid", "razorpay_payment_id": "pay_...", "razorpay_order_id": "order_...", "razorpay_signature": "64_hex_chars" }
```

The server verifies HMAC, fetches the payment, and checks order, exact amount, and currency. Browser callback is not proof. Subscription is `CONFIRMED` only when payment is captured and recurring token is usable; otherwise it is `ACTIVATION_PENDING` or `PENDING`. Response uses checkout-status shape.

## `GET /api/checkout/status?session_id=<uuid>`

```json
{
  "ok": true,
  "state": "CONFIRMED",
  "retry_allowed": false,
  "order_id": "UPM-...",
  "subscription_id": "uuid optional",
  "message": { "key": "PAYMENT_CONFIRMED", "title": "...", "body": "...", "severity": "SUCCESS", "cta_label": "View order journey" },
  "next": { "type": "EXPERIENCE", "url": "/experience?t=exp_..." }
}
```

An unresolved attempt returns `retry_allowed: false`; do not begin another payment.

## `GET /api/experience?token=<token>`

Returns safe order number/date, items, adjustments, operational benefits, total, shipment/EDD/timeline, subscription projection, first name, masked phone, city, and pincode. It excludes internal IDs, provider/payment/mandate tokens, email, and full address. Sequential order number is insufficient.

## `GET|POST /api/customer/addresses`

Requires a Supabase bearer token linked to `customers.auth_user_id`. `GET` lists only that customer’s addresses. `POST` accepts `{ label?, name, phone, line1, line2?, landmark?, city, state, postal_code, country: "IN", is_default? }`. Checkout stores an immutable address snapshot.

## Provider and internal endpoints

- `POST /api/webhooks/razorpay`: validates `X-Razorpay-Signature` over the raw body; deduplicates event ID/body hash; handles payment authorised/captured/failed and token/mandate status.
- `POST /api/webhooks/shiprocket`: validates `X-Shiprocket-Webhook-Secret`, `X-Api-Key`, or bearer secret; deduplicates tracking updates.
- `POST /api/internal/renewals/run`: requires `Authorization: Bearer <COMMERCE_CRON_SECRET>`. It creates 24-hour pre-debit messages, atomically claims due cycles with `SKIP LOCKED`, prices subscription lines only, enforces mandate cap, creates one provider order/attempt, calls recurring payment, and advances only after capture.

## States, messages, and errors

Normalized states: `CHECKOUT_READY`, `AUTHORIZING`, `VERIFYING`, `CONFIRMED`, `ACTIVATION_PENDING`, `PENDING`, `FAILED_RETRYABLE`, `INSUFFICIENT_FUNDS`, `MANDATE_ACTION_REQUIRED`, `MANDATE_PAUSED`, `MANDATE_EXPIRED`, `CAP_EXCEEDED`, `CUSTOMER_CANCELLED`, `QUOTE_CHANGED`, `QUOTE_EXPIRED`, `SYSTEM_ERROR`.

Message keys: `PAYMENT_CONFIRMING`, `PAYMENT_CONFIRMED`, `PAYMENT_PENDING`, `PAYMENT_FAILED`, `ORDER_PREPARING`, `ORDER_SHIPPED`, `IN_TRANSIT`, `OUT_FOR_DELIVERY`, `DELIVERED`, `RENEWAL_UPCOMING`, `RENEWAL_SUCCESS`, `RENEWAL_FAILED`, `MANDATE_REAUTH_REQUIRED`, `MANDATE_PAUSED`, `QUOTE_CHANGED`. DB templates override fallbacks.

Errors include: `VALIDATION_ERROR`, `ORIGIN_NOT_ALLOWED`, `RATE_LIMITED`, `UNKNOWN_SKU`, `SKU_UNAVAILABLE`, `INSUFFICIENT_INVENTORY`, `UNSERVICEABLE_PINCODE`, `INVALID_QUOTE`, `QUOTE_EXPIRED`, `QUOTE_CONSUMED`, `QUOTE_CHANGED`, `RECURRING_CONSENT_REQUIRED`, `IDEMPOTENCY_KEY_REQUIRED`, `IDEMPOTENCY_CONFLICT`, `REQUEST_IN_PROGRESS`, `INVALID_PAYMENT_SIGNATURE`, `PAYMENT_MISMATCH`, `AUTH_REQUIRED`, `AUTH_INVALID`, `SYSTEM_ERROR`.

## Required examples

- Pure one-time: Gir `BUY_ONCE`; a normal Razorpay Order charges initial total; there is no recurring group/mandate.
- Pure subscription: Gir `SUBSCRIPTION` every 30 days; initial total authorizes UPI AutoPay; cycle-2 benefit is evaluated on renewal only.
- Mixed: Gir `SUBSCRIPTION` + Murrah `BUY_ONCE`. Both charge initially and may qualify for Pair. Murrah disappears on renewal, so Gir-only renewal does not inherit Pair.
