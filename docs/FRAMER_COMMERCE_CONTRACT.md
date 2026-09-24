# Uppermost Framer Commerce Frontend Contract

**Status:** generated from implemented code  
**Generated:** 24 September 2026  
**Frontend:** Framer  
**Backend:** the deployed Next.js/Vercel origin  
**Companion types:** `docs/FRAMER_COMMERCE_TYPES.ts`

This document describes the commerce API that is implemented now. It is not a proposal. When this document differs from an older draft, Framer must follow this document until the canonical architecture and API specifications are reconciled.

No secret belongs in Framer. Framer may receive the Razorpay **key ID**, which is public. It must never receive the Razorpay key secret, webhook secrets, recurring tokens, Shiprocket credentials, the commerce token pepper, the cron secret, or the Supabase service-role key.

## 1. Base URL, JSON, money, and time

- Prefix every path below with the deployed backend origin, for example `https://api.example.com`.
- POST requests use `Content-Type: application/json`.
- POST bodies are limited to 128 KiB.
- All public fields ending in `_paise` are integer paise. `100` paise is ₹1. Do not divide before sending a value to Razorpay Checkout; Razorpay also expects the amount in paise.
- Currency is currently the literal `INR`.
- Timestamps are ISO-8601 strings. Delivery dates from the experience API are PostgreSQL date strings (`YYYY-MM-DD`) or `null`.
- Successful and failed responses include `Cache-Control: no-store`.
- Unknown JSON keys are stripped by the current Zod object schemas; Framer should still send only documented fields.

## 2. CORS contract

The browser `Origin` must exactly match an allowed origin after lower-casing and removing trailing slashes.

Allowed by default in production:

- `https://uppermost.store`
- `https://www.uppermost.store`
- every exact origin in the server-only, comma-separated `COMMERCE_ALLOWED_ORIGINS`

Additionally allowed outside production:

- `http://localhost:3000`
- `http://localhost:3001`
- `http://localhost:3002`

Requests without an `Origin` header are accepted for server-to-server and local tooling. A disallowed browser origin receives `403 ORIGIN_NOT_ALLOWED`. Preflight requests return `204`; a disallowed preflight does not receive `Access-Control-Allow-Origin`, so the browser blocks it.

Response/preflight headers implemented now:

```text
Access-Control-Allow-Origin: <the allowed request origin>
Access-Control-Allow-Methods: GET, POST, OPTIONS
Access-Control-Allow-Headers: Content-Type, Idempotency-Key, Authorization, X-Customer-Token, X-Shiprocket-Webhook-Secret
Access-Control-Max-Age: 86400
Cache-Control: no-store
X-Content-Type-Options: nosniff
Referrer-Policy: no-referrer
Vary: Origin
```

For successful/preflight `GET /api/checkout/status` and `GET /api/experience`, `Access-Control-Allow-Methods` is `GET, OPTIONS`. Their error responses currently fall back to `GET, POST, OPTIONS`. There is no `Access-Control-Allow-Credentials`; these six endpoints do not use browser cookies.

## 3. Shared request rules

### 3.1 `guest_session_id`

Framer creates one stable, opaque guest ID and stores it locally for the checkout journey.

- Trimmed length: 8–200 characters.
- It is required by quote and prepare.
- The exact same value must be sent to both endpoints.
- It is a binding identifier, not a secret and not authentication.
- A mismatch at prepare is returned as `INVALID_QUOTE`.
- Payment verification, status polling, and experience lookup do not accept it.

Suggested client behavior: generate a high-entropy value once, such as `gs_<random UUID>`, and reuse it. Do not use email, phone, or another direct identifier.

### 3.2 Cart line JSON

Buy once:

```json
{
  "line_id": "murrah-1",
  "sku": "MURRAH-1000",
  "qty": 1,
  "purchase_mode": "BUY_ONCE"
}
```

Subscription:

```json
{
  "line_id": "gir-1",
  "sku": "GIR-1000",
  "qty": 1,
  "purchase_mode": "SUBSCRIPTION",
  "interval_days": 30
}
```

Validation:

- `line_id`: trimmed, 1–100 characters, unique within the request.
- `sku`: trimmed, 2–100 characters, normalized to uppercase.
- `qty`: integer 1–20.
- `purchase_mode`: `BUY_ONCE` or `SUBSCRIPTION`.
- `interval_days`: required for subscription, forbidden for buy once, and one of `15`, `30`, `60`.
- Request cart: 1–20 lines.
- All subscription lines in one request must use the same interval.

### 3.3 Postal code

`postal_code` is always a six-digit string, for example `"122001"`. Never send it as a number because leading zeroes are meaningful.

### 3.4 Idempotency

Only these browser endpoints require the header:

- `POST /api/checkout/prepare`
- `POST /api/payments/verify`

Header:

```text
Idempotency-Key: <8-to-200-character stable key>
```

Behavior:

- The key is scoped to the endpoint.
- Same endpoint + same key + same normalized request replays the stored HTTP status and JSON.
- Same endpoint + same key + different normalized request returns `409 IDEMPOTENCY_CONFLICT`.
- A still-processing record returns `409 REQUEST_IN_PROGRESS`.
- Validation and missing-header errors occur before an idempotency record is created.
- Once processing has started, implemented Commerce errors and unexpected `500` responses are stored and replayed.
- Generate one key per logical prepare attempt and one key per logical verify attempt. Keep that key stable across network retries.
- After `QUOTE_CHANGED`, adopt the replacement quote and use a **new prepare key**. Reusing the old key with the old body replays the `QUOTE_CHANGED`; reusing it with the new quote conflicts.

### 3.5 Rate limits

The current implementation uses a per-process, per-IP, one-minute in-memory limiter:

| Endpoint | Requests/minute/IP |
|---|---:|
| quote | 40 |
| serviceability | 40 |
| prepare | 15 |
| verify | 20 |
| status | 90 |
| experience | 90 |

This is a best-effort server-instance limit, not a durable distributed quota. A breach returns `429 RATE_LIMITED`.

## 4. Normalized error envelope

Commerce error:

```json
{
  "ok": false,
  "error": {
    "code": "UNSERVICEABLE_PINCODE",
    "message": "Delivery is not currently available for this pincode."
  }
}
```

Zod validation error:

```json
{
  "ok": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed.",
    "fields": [
      {
        "path": "items.0.interval_days",
        "message": "interval_days is required for subscription lines."
      }
    ]
  }
}
```

`QUOTE_CHANGED` is the only implemented browser error that carries a defined `details` payload:

```json
{
  "ok": false,
  "error": {
    "code": "QUOTE_CHANGED",
    "message": "Pricing or eligibility changed. Review the refreshed quote.",
    "details": {
      "quote": {
        "ok": true,
        "quote_id": "quo_replacement",
        "quote_token": "qt_replacement",
        "currency": "INR",
        "valid_until": "2026-09-24T12:15:00.000Z",
        "items": [],
        "promotions": [],
        "benefits": [],
        "initial": {
          "subtotal_paise": 0,
          "discount_paise": 0,
          "shipping_paise": 0,
          "tax_paise": 0,
          "total_paise": 0
        },
        "recurring_groups": [],
        "shipping": {
          "serviceable": true,
          "estimated_delivery_from": null,
          "estimated_delivery_to": null,
          "shipping_amount_paise": 0,
          "display": "Delivery details are unavailable."
        }
      }
    }
  }
}
```

The quote above shows the exact nested shape but zero placeholder values. The real replacement contains the newly calculated items and totals.

Common errors:

| HTTP | Code | When |
|---:|---|---|
| 400 | `VALIDATION_ERROR` | Request/query validation failed. Includes `error.fields` for Zod body errors. |
| 400 | `INVALID_JSON` | POST body is not valid JSON. |
| 403 | `ORIGIN_NOT_ALLOWED` | Browser origin is not allowed. |
| 413 | `PAYLOAD_TOO_LARGE` | POST body exceeds 128 KiB. |
| 415 | `UNSUPPORTED_MEDIA_TYPE` | POST does not contain `Content-Type: application/json`. |
| 429 | `RATE_LIMITED` | Per-IP route limit reached. |
| 500 | `SYSTEM_ERROR` | An unexpected database, configuration, or provider failure occurred. Raw details are not returned. |

### 4.1 Exact error message catalog

Except for the fully shown Zod and `QUOTE_CHANGED` payloads above, every listed error JSON is exactly:

```json
{
  "ok": false,
  "error": {
    "code": "CODE_FROM_TABLE",
    "message": "MESSAGE_FROM_TABLE"
  }
}
```

Dynamic placeholders below are interpolated server values; provider-private errors are never interpolated.

| Endpoint(s) | HTTP | Code | Exact implemented message |
|---|---:|---|---|
| all | 403 | `ORIGIN_NOT_ALLOWED` | `Origin is not allowed.` |
| all | 429 | `RATE_LIMITED` | `Too many requests. Please try again shortly.` |
| all POST | 415 | `UNSUPPORTED_MEDIA_TYPE` | `Content-Type must be application/json.` |
| all POST | 413 | `PAYLOAD_TOO_LARGE` | `Request body is too large.` |
| all POST | 400 | `INVALID_JSON` | `Request body must be valid JSON.` |
| all Zod-validated POST | 400 | `VALIDATION_ERROR` | `Request validation failed.` plus `error.fields` |
| all | 500 | `SYSTEM_ERROR` | `The commerce service is temporarily unavailable.` |
| quote, serviceability, prepare reprice | 400 | `UNKNOWN_SKU` | `Unknown SKU: <comma-separated SKUs>` |
| quote, serviceability, prepare reprice | 409 | `SKU_UNAVAILABLE` | `<SKU> is unavailable.` |
| quote, serviceability, prepare reprice | 409 | `INSUFFICIENT_INVENTORY` | `<SKU> does not have enough inventory.` |
| quote, serviceability, prepare reprice | 503 | `INVENTORY_UNAVAILABLE` | `Inventory could not be confirmed.` |
| prepare, verify | 400 | `IDEMPOTENCY_KEY_REQUIRED` | `A valid Idempotency-Key header is required.` |
| prepare, verify | 409 | `IDEMPOTENCY_CONFLICT` | `This Idempotency-Key was already used with a different request.` |
| prepare, verify | 409 | `REQUEST_IN_PROGRESS` | `A request with this Idempotency-Key is already being processed.` |
| prepare | 400 | `INVALID_QUOTE` | `Quote validation failed.` |
| prepare, revoked quote | 409 | `INVALID_QUOTE` | `This quote is no longer valid.` |
| prepare | 409 | `QUOTE_EXPIRED` | `This quote has expired.` |
| prepare | 409 | `QUOTE_CONSUMED` | `This quote has already been used.` |
| prepare | 400 | `RECURRING_CONSENT_REQUIRED` | `Recurring payment consent is required for subscription items.` |
| prepare | 409 | `UNSERVICEABLE_PINCODE` | `Delivery is not currently available for this pincode.` |
| prepare | 409 | `QUOTE_CHANGED` | `Pricing or eligibility changed. Review the refreshed quote.` plus `error.details.quote` |
| prepare | 409 | `CUSTOMER_IDENTITY_CONFLICT` | `Email and phone belong to different customer records.` |
| verify | 400 | `INVALID_PAYMENT_SIGNATURE` | `Payment signature is invalid.` |
| verify | 404 | `PAYMENT_ATTEMPT_NOT_FOUND` | `Payment attempt was not found.` |
| verify | 409 | `PAYMENT_MISMATCH` | `Payment details do not match the checkout.` |
| verify, status | 404 | `CHECKOUT_NOT_FOUND` | `Checkout session was not found.` |
| status | 400 | `VALIDATION_ERROR` | `A valid session_id is required.` with no `error.fields` |
| experience | 400 | `INVALID_EXPERIENCE_TOKEN` | `Invalid experience token.` |
| experience | 404 | `EXPERIENCE_NOT_FOUND` | `Order experience was not found.` |

## 5. `POST /api/commerce/quote`

Creates and persists an authoritative quote. No idempotency header is used; repeating the call creates a new quote.

### Headers

```text
Content-Type: application/json
Origin: <allowed Framer origin>
```

### Request JSON

```json
{
  "guest_session_id": "gs_8fc92b8e-4a59-45c1-afe3-939109dc8cc7",
  "items": [
    {
      "line_id": "gir-1",
      "sku": "GIR-1000",
      "qty": 1,
      "purchase_mode": "SUBSCRIPTION",
      "interval_days": 30
    },
    {
      "line_id": "murrah-1",
      "sku": "MURRAH-1000",
      "qty": 1,
      "purchase_mode": "BUY_ONCE"
    }
  ],
  "postal_code": "122001"
}
```

`postal_code` is optional. If omitted, shipping has `serviceable: null` and a prompt to enter a pincode.

### Success: HTTP 201

Illustrative mixed-cart response using the seeded launch promotions. UUIDs, quote tokens, dates, serviceability, promotion availability, and totals are live values and can differ:

```json
{
  "ok": true,
  "quote_id": "quo_7sYx1A2B3C4D5E6F7G8H9I0J",
  "quote_token": "qt_q1w2e3r4t5y6u7i8o9p0a1s2d3f4g5h6j7k8l9z0x",
  "currency": "INR",
  "valid_until": "2026-09-24T12:15:00.000Z",
  "items": [
    {
      "line_id": "gir-1",
      "sku": "GIR-1000",
      "qty": 1,
      "purchase_mode": "SUBSCRIPTION",
      "interval_days": 30,
      "product_id": "11111111-1111-4111-8111-111111111111",
      "product_variant_id": "11111111-1111-4111-8111-111111111112",
      "product_code": "GIR_GHEE",
      "product_name": "Gir Cow Ghee",
      "variant_name": "Gir Cow Ghee 1 L",
      "size_label": "1 L",
      "unit_price_paise": 750000,
      "line_subtotal_paise": 750000,
      "line_total_paise": 750000,
      "weight_grams": 1200,
      "dimensions_cm": { "length": 14, "breadth": 14, "height": 18 }
    },
    {
      "line_id": "murrah-1",
      "sku": "MURRAH-1000",
      "qty": 1,
      "purchase_mode": "BUY_ONCE",
      "product_id": "22222222-2222-4222-8222-222222222221",
      "product_variant_id": "22222222-2222-4222-8222-222222222222",
      "product_code": "MURRAH_GHEE",
      "product_name": "Murrah Buffalo Ghee",
      "variant_name": "Murrah Buffalo Ghee 1 L",
      "size_label": "1 L",
      "unit_price_paise": 550000,
      "line_subtotal_paise": 550000,
      "line_total_paise": 550000,
      "weight_grams": 1200,
      "dimensions_cm": { "length": 14, "breadth": 14, "height": 18 }
    }
  ],
  "promotions": [
    {
      "promotion_id": "33333333-3333-4333-8333-333333333331",
      "code": "GIR_1L_EARLY_BIRD",
      "label": "Gir 1 L Early Bird",
      "type": "AMOUNT_OFF",
      "amount_paise": 50000,
      "scope": "INITIAL",
      "applies_to_line_ids": ["gir-1"]
    },
    {
      "promotion_id": "33333333-3333-4333-8333-333333333332",
      "code": "MURRAH_1L_EARLY_BIRD",
      "label": "Murrah 1 L Early Bird",
      "type": "AMOUNT_OFF",
      "amount_paise": 50000,
      "scope": "INITIAL",
      "applies_to_line_ids": ["murrah-1"]
    },
    {
      "promotion_id": "33333333-3333-4333-8333-333333333333",
      "code": "THE_PAIR",
      "label": "The Pair",
      "type": "AMOUNT_OFF",
      "amount_paise": 50000,
      "scope": "INITIAL",
      "applies_to_line_ids": ["gir-1", "murrah-1"]
    },
    {
      "promotion_id": "33333333-3333-4333-8333-333333333334",
      "code": "FREE_SHIPPING_INDIA",
      "label": "Free Shipping Across India",
      "type": "FREE_SHIPPING",
      "amount_paise": 0,
      "scope": "INITIAL",
      "applies_to_line_ids": ["gir-1", "murrah-1"]
    }
  ],
  "benefits": [],
  "initial": {
    "subtotal_paise": 1300000,
    "discount_paise": 150000,
    "shipping_paise": 0,
    "tax_paise": 0,
    "total_paise": 1150000
  },
  "recurring_groups": [
    {
      "interval_days": 30,
      "items": [
        {
          "line_id": "gir-1",
          "sku": "GIR-1000",
          "qty": 1,
          "purchase_mode": "SUBSCRIPTION",
          "interval_days": 30,
          "product_id": "11111111-1111-4111-8111-111111111111",
          "product_variant_id": "11111111-1111-4111-8111-111111111112",
          "product_code": "GIR_GHEE",
          "product_name": "Gir Cow Ghee",
          "variant_name": "Gir Cow Ghee 1 L",
          "size_label": "1 L",
          "unit_price_paise": 750000,
          "line_subtotal_paise": 750000,
          "line_total_paise": 750000,
          "weight_grams": 1200,
          "dimensions_cm": { "length": 14, "breadth": 14, "height": 18 }
        }
      ],
      "projected_subtotal_paise": 750000,
      "projected_discount_paise": 50000,
      "projected_total_paise": 700000,
      "mandate_max_amount_paise": 1150000
    }
  ],
  "shipping": {
    "serviceable": true,
    "estimated_delivery_from": "2026-09-27T12:00:00.000Z",
    "estimated_delivery_to": "2026-09-29T12:00:00.000Z",
    "best_courier_internal_reference": "42",
    "shipping_amount_paise": 0,
    "display": "Estimated delivery in 4-5 days"
  }
}
```

Field details:

- `quote_id` and `quote_token` are both required later. Treat the token as sensitive browser state: do not log it or place it in a URL.
- Default lifetime is 900 seconds, controlled server-side.
- `items` contains normalized server catalog fields, including internal UUID values currently exposed by this mapper.
- `interval_days` is absent on buy-once normalized items.
- `promotions` contains monetary/shipping adjustments only. Its public `scope` is always the literal `INITIAL` in the current mapper.
- `benefits` contains non-monetary promotion actions.
- `recurring_groups` is empty for pure buy once and currently contains at most one group.
- `shipping.serviceable` is `null` only when no postal code was supplied; otherwise boolean.
- `estimated_delivery_from` and `estimated_delivery_to` are nullable.
- `best_courier_internal_reference` is optional.

### Endpoint-specific errors

In addition to the common errors:

| HTTP | Code | Meaning |
|---:|---|---|
| 400 | `UNKNOWN_SKU` | One or more SKUs do not exist. |
| 409 | `SKU_UNAVAILABLE` | A SKU exists but is inactive. |
| 409 | `INSUFFICIENT_INVENTORY` | Authoritative inventory is below requested quantity. |
| 503 | `INVENTORY_UNAVAILABLE` | Shopify inventory was configured and could not be confirmed. |

Shiprocket serviceability failure does not fail this endpoint. It returns a created quote with `shipping.serviceable: false`, null delivery dates, zero shipping, and a fallback message.

## 6. `POST /api/shipping/serviceability`

Checks serviceability against the current authoritative catalog. Framer never sends origin postcode, weight, dimensions, declared value, or payment mode.

### Headers

```text
Content-Type: application/json
Origin: <allowed Framer origin>
```

No idempotency header is required.

### Request JSON

```json
{
  "postal_code": "122001",
  "items": [
    {
      "line_id": "gir-1",
      "sku": "GIR-1000",
      "qty": 1,
      "purchase_mode": "SUBSCRIPTION",
      "interval_days": 30
    },
    {
      "line_id": "murrah-1",
      "sku": "MURRAH-1000",
      "qty": 1,
      "purchase_mode": "BUY_ONCE"
    }
  ]
}
```

### Success: HTTP 200

```json
{
  "ok": true,
  "serviceable": true,
  "estimated_delivery_from": "2026-09-27T12:00:00.000Z",
  "estimated_delivery_to": "2026-09-29T12:00:00.000Z",
  "best_courier_internal_reference": "42",
  "shipping_amount_paise": 0,
  "message": "Estimated delivery in 4-5 days"
}
```

`best_courier_internal_reference` is optional. Both delivery timestamps are nullable. `shipping_amount_paise` is integer paise and is currently normalized to zero by the Shiprocket adapter/current free-shipping policy.

An unavailable Shiprocket API is normalized as a successful `200` result:

```json
{
  "ok": true,
  "serviceable": false,
  "estimated_delivery_from": null,
  "estimated_delivery_to": null,
  "shipping_amount_paise": 0,
  "message": "Delivery availability could not be confirmed."
}
```

The frontend must not treat this fallback as serviceable.

### Endpoint-specific errors

The same catalog errors as quote apply: `UNKNOWN_SKU` (`400`), `SKU_UNAVAILABLE` (`409`), `INSUFFICIENT_INVENTORY` (`409`), and `INVENTORY_UNAVAILABLE` (`503`), plus the common errors.

## 7. `POST /api/checkout/prepare`

Creates the customer/address snapshots, checkout session, Uppermost order, optional subscription/mandate records, Razorpay Order, and public checkout payload.

### Required headers

```text
Content-Type: application/json
Origin: <allowed Framer origin>
Idempotency-Key: prepare_<stable-random-value>
```

### Request JSON

```json
{
  "guest_session_id": "gs_8fc92b8e-4a59-45c1-afe3-939109dc8cc7",
  "quote_id": "quo_7sYx1A2B3C4D5E6F7G8H9I0J",
  "quote_token": "qt_q1w2e3r4t5y6u7i8o9p0a1s2d3f4g5h6j7k8l9z0x",
  "customer": {
    "name": "Asha Singh",
    "email": "asha@example.com",
    "phone": "+919999999999"
  },
  "shipping_address": {
    "line1": "12 Market Road",
    "line2": null,
    "landmark": null,
    "city": "Gurugram",
    "state": "Haryana",
    "postal_code": "122001",
    "country": "IN"
  },
  "billing_same_as_shipping": true,
  "recurring_consent": {
    "accepted": true,
    "version": "recurring-2026-09-v1"
  }
}
```

Validation:

- `quote_id`: trimmed, 10–160 characters.
- `quote_token`: trimmed, 32–300 characters.
- Customer name: 2–160 characters.
- Email: valid, max 320, normalized to lowercase.
- Phone: optional leading `+`, then 8–15 digits total with a non-zero first digit.
- `line1`: 3–240 characters.
- `line2`: optional or null, max 240.
- `landmark`: optional or null, max 160.
- City/state: 2–120 characters.
- Country: literal `IN`.
- `billing_same_as_shipping` is required, but current server behavior always uses the shipping address and does not branch on this boolean.

### Recurring consent

`recurring_consent` is schema-optional, but runtime-required when the stored quote contains at least one subscription line.

```json
{
  "accepted": true,
  "version": "recurring-2026-09-v1"
}
```

- `accepted` must be the literal `true`.
- `version` is an arbitrary trimmed consent-copy version of 3–100 characters; the backend does not require a hard-coded version value.
- A subscription/mixed request without accepted consent returns `400 RECURRING_CONSENT_REQUIRED`.
- A pure buy-once request may omit consent. The current schema does not reject an unnecessary consent object on buy-once.

### Success: HTTP 201

Mixed/subscription response:

```json
{
  "ok": true,
  "checkout_session_id": "44444444-4444-4444-8444-444444444444",
  "uppermost_order_id": "UPM-20260924-000001",
  "payment_kind": "RECURRING_AUTH",
  "state": "CHECKOUT_READY",
  "razorpay": {
    "key_id": "rzp_test_public_key_id",
    "order_id": "order_RazorpayPublicId",
    "customer_id": "cust_RazorpayPublicId",
    "amount_paise": 1150000,
    "currency": "INR",
    "recurring": true,
    "prefill": {
      "name": "Asha Singh",
      "email": "asha@example.com",
      "contact": "+919999999999"
    }
  },
  "display": {
    "amount_now_paise": 1150000,
    "recurring_projection_paise": 700000,
    "mandate_max_amount_paise": 1150000,
    "interval_days": 30
  },
  "subscription_id": "55555555-5555-4555-8555-555555555555"
}
```

Pure buy-once response:

```json
{
  "ok": true,
  "checkout_session_id": "44444444-4444-4444-8444-444444444444",
  "uppermost_order_id": "UPM-20260924-000002",
  "payment_kind": "ONE_TIME",
  "state": "CHECKOUT_READY",
  "razorpay": {
    "key_id": "rzp_test_public_key_id",
    "order_id": "order_RazorpayPublicId",
    "amount_paise": 700000,
    "currency": "INR",
    "recurring": false,
    "prefill": {
      "name": "Asha Singh",
      "email": "asha@example.com",
      "contact": "+919999999999"
    }
  },
  "display": {
    "amount_now_paise": 700000,
    "recurring_projection_paise": 0,
    "mandate_max_amount_paise": null,
    "interval_days": null
  },
  "subscription_id": null
}
```

Nullable/optional behavior:

- `razorpay.customer_id` is present for subscription/mixed recurring authorization and absent for pure buy once.
- `display.mandate_max_amount_paise` and `display.interval_days` are `null` for pure buy once.
- `subscription_id` is always a key in the success JSON: UUID for subscription/mixed, `null` for buy once.

### Razorpay Checkout mapping

The backend object is safe public data, but it is not named exactly like Razorpay's browser options. Framer maps it as follows:

```ts
const options = {
  key: prepared.razorpay.key_id,
  order_id: prepared.razorpay.order_id,
  amount: prepared.razorpay.amount_paise,
  currency: prepared.razorpay.currency,
  customer_id: prepared.razorpay.customer_id,
  recurring: prepared.razorpay.recurring,
  prefill: prepared.razorpay.prefill,
}
```

Omit `customer_id` when it is absent. Never put `quote_token`, address data, or any secret into browser notes.

### Endpoint-specific errors

In addition to common and catalog errors:

| HTTP | Code | Meaning/front-end action |
|---:|---|---|
| 400 | `IDEMPOTENCY_KEY_REQUIRED` | Header is missing, shorter than 8, or longer than 200 characters. |
| 409 | `IDEMPOTENCY_CONFLICT` | Key was used with a different normalized request. Generate a new key only for a genuinely new logical attempt. |
| 409 | `REQUEST_IN_PROGRESS` | Same request is still processing. Wait; do not create another checkout. |
| 400 | `INVALID_QUOTE` | Quote missing, token invalid, or guest binding mismatched. |
| 409 | `INVALID_QUOTE` | Stored quote was revoked. |
| 409 | `QUOTE_EXPIRED` | Quote expiry passed. Request a new quote. |
| 409 | `QUOTE_CONSUMED` | Quote already has/attempted a checkout. Do not create another payment. |
| 400 | `RECURRING_CONSENT_REQUIRED` | Stored cart subscribes but accepted consent is absent. |
| 409 | `UNSERVICEABLE_PINCODE` | Current address cannot be confirmed serviceable. Do not open Razorpay. |
| 409 | `QUOTE_CHANGED` | Use `error.details.quote`, show the new total/terms, obtain confirmation, and prepare again with a new idempotency key. |
| 409 | `CUSTOMER_IDENTITY_CONFLICT` | Email and phone match different customer records; stop and request support/correction. |

Razorpay/customer/database setup errors are returned only as `500 SYSTEM_ERROR`, with no raw provider details.

## 8. `POST /api/payments/verify`

Call from the Razorpay browser success handler. Browser success is not payment finality; this endpoint verifies the signature, fetches Razorpay's payment, checks exact order/amount/currency, reconciles state, and returns the checkout-status shape.

### Required headers

```text
Content-Type: application/json
Origin: <allowed Framer origin>
Idempotency-Key: verify_<stable-random-value>
```

### Request JSON

```json
{
  "checkout_session_id": "44444444-4444-4444-8444-444444444444",
  "razorpay_payment_id": "pay_RazorpayPublicId",
  "razorpay_order_id": "order_RazorpayPublicId",
  "razorpay_signature": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
}
```

- `checkout_session_id` must be a UUID.
- The payment/order IDs are trimmed strings of 3–160 characters.
- Signature is exactly 64 hexadecimal characters.

### Success: HTTP 200

Captured one-time payment:

```json
{
  "ok": true,
  "state": "CONFIRMED",
  "retry_allowed": false,
  "order_id": "UPM-20260924-000002",
  "message": {
    "key": "PAYMENT_CONFIRMED",
    "title": "Payment confirmed",
    "body": "Your Uppermost order is confirmed.",
    "severity": "SUCCESS",
    "cta_label": "View order journey"
  },
  "next": {
    "type": "EXPERIENCE",
    "url": "/experience?t=exp_high_entropy_token"
  }
}
```

Captured subscription authorization whose recurring token has not become usable yet:

```json
{
  "ok": true,
  "state": "ACTIVATION_PENDING",
  "retry_allowed": false,
  "order_id": "UPM-20260924-000001",
  "subscription_id": "55555555-5555-4555-8555-555555555555",
  "message": {
    "key": "PAYMENT_PENDING",
    "title": "Payment pending",
    "body": "We are waiting for final confirmation. Do not make another payment yet.",
    "severity": "WARNING"
  },
  "next": {
    "type": "EXPERIENCE",
    "url": "/experience?t=exp_high_entropy_token"
  }
}
```

Pending/authorized payment:

```json
{
  "ok": true,
  "state": "PENDING",
  "retry_allowed": false,
  "order_id": "UPM-20260924-000001",
  "subscription_id": "55555555-5555-4555-8555-555555555555",
  "message": {
    "key": "PAYMENT_PENDING",
    "title": "Payment pending",
    "body": "We are waiting for final confirmation. Do not make another payment yet.",
    "severity": "WARNING"
  }
}
```

The returned message can be overridden by an active database template. `cta_label` and `cta_url` are optional.

### Endpoint-specific errors

| HTTP | Code | Meaning |
|---:|---|---|
| 400 | `IDEMPOTENCY_KEY_REQUIRED` | Required header invalid. |
| 409 | `IDEMPOTENCY_CONFLICT` | Same key used for different verification input. |
| 409 | `REQUEST_IN_PROGRESS` | Same verification is still processing. |
| 400 | `INVALID_PAYMENT_SIGNATURE` | Razorpay callback signature failed server verification. |
| 404 | `PAYMENT_ATTEMPT_NOT_FOUND` | No prepared attempt matches the checkout session and Razorpay order. |
| 409 | `PAYMENT_MISMATCH` | Provider order, integer amount, or currency differs from the prepared attempt. |
| 404 | `CHECKOUT_NOT_FOUND` | Reconciliation completed but the checkout session cannot be loaded. |

Unexpected Razorpay, database, reconciliation, or fulfillment lookup errors become `500 SYSTEM_ERROR`. Shiprocket remote order creation failure is caught internally after payment capture; it does not downgrade a confirmed payment or leak provider errors.

## 9. `GET /api/checkout/status?session_id=<uuid>`

Read-only polling endpoint. It does not require an idempotency key, guest ID, bearer token, or request body.

### Headers

```text
Origin: <allowed Framer origin>
```

### Request example

```text
GET /api/checkout/status?session_id=44444444-4444-4444-8444-444444444444
```

### Success: HTTP 200

```json
{
  "ok": true,
  "state": "CONFIRMED",
  "retry_allowed": false,
  "order_id": "UPM-20260924-000001",
  "subscription_id": "55555555-5555-4555-8555-555555555555",
  "message": {
    "key": "PAYMENT_CONFIRMED",
    "title": "Payment confirmed",
    "body": "Your Uppermost order is confirmed.",
    "severity": "SUCCESS",
    "cta_label": "View order journey"
  },
  "next": {
    "type": "EXPERIENCE",
    "url": "/experience?t=exp_high_entropy_token"
  }
}
```

Optionality:

- `order_id` is optional and is the human-facing Uppermost order number, despite the field name.
- `subscription_id` is optional and present only for subscription/mixed orders once linked.
- `next` is present only for `CONFIRMED` and `ACTIVATION_PENDING`.
- `message.cta_label` and `message.cta_url` are optional.

### Normalized states and frontend behavior

Declared normalized state union:

```text
CHECKOUT_READY
AUTHORIZING
VERIFYING
CONFIRMED
ACTIVATION_PENDING
PENDING
FAILED_RETRYABLE
INSUFFICIENT_FUNDS
MANDATE_ACTION_REQUIRED
MANDATE_PAUSED
MANDATE_EXPIRED
CAP_EXCEEDED
CUSTOMER_CANCELLED
QUOTE_CHANGED
QUOTE_EXPIRED
SYSTEM_ERROR
```

Actual `retry_allowed` is `true` only for:

- `FAILED_RETRYABLE`
- `INSUFFICIENT_FUNDS`
- `CUSTOMER_CANCELLED`
- `SYSTEM_ERROR`

It is `false` for every other state, including `PENDING` and `ACTIVATION_PENDING`.

Polling rules:

1. After the Razorpay success callback, call verify once with a stable verify idempotency key.
2. If verify returns `PENDING` or the browser loses the verify response, poll this endpoint using the existing `checkout_session_id`.
3. Keep the cadence below the implemented 90 requests/minute/IP limit. The backend does not prescribe a specific interval; use bounded polling/backoff.
4. Never launch a second Razorpay payment while `retry_allowed` is false.
5. On `CONFIRMED`, navigate once to `next.url`.
6. On `ACTIVATION_PENDING`, the current backend also supplies `next.url`; show that activation is pending and continue status reconciliation rather than claiming the subscription is active.
7. In the Framer page URL, the experience token query name is `t`. The API query name is `token`.

### Errors

| HTTP | Code | Meaning |
|---:|---|---|
| 400 | `VALIDATION_ERROR` | `session_id` is absent or not UUID-shaped. This error has no `fields` array because it is raised manually. |
| 404 | `CHECKOUT_NOT_FOUND` | No checkout session matches the UUID. |

Common origin, rate-limit, and system errors also apply.

## 10. `GET /api/experience?token=<experience-token>`

Returns the customer-safe order journey. The API expects the token under `token`, not `t`.

### Headers

```text
Origin: <allowed Framer origin>
```

### Request example

If Framer is at `/experience?t=exp_abc`, read `t` and call:

```text
GET /api/experience?token=exp_abc
```

The real token is high entropy and longer than 32 characters. Do not log it, send it to analytics, or use the order number instead.

### Success: HTTP 200

Subscription/mixed order example:

```json
{
  "ok": true,
  "state": "CONFIRMED",
  "message": {
    "key": "PAYMENT_CONFIRMED",
    "title": "Payment confirmed",
    "body": "Your Uppermost order is confirmed.",
    "severity": "SUCCESS",
    "cta_label": "View order journey"
  },
  "order": {
    "display_order_number": "UPM-20260924-000001",
    "placed_at": "2026-09-24T12:05:00.000Z",
    "items": [
      {
        "sku": "GIR-1000",
        "product_name": "Gir Cow Ghee",
        "variant_name": "Gir Cow Ghee 1 L",
        "quantity": 1,
        "purchase_mode": "SUBSCRIPTION",
        "interval_days": 30,
        "unit_price_paise": 750000,
        "line_total_paise": 750000
      },
      {
        "sku": "MURRAH-1000",
        "product_name": "Murrah Buffalo Ghee",
        "variant_name": "Murrah Buffalo Ghee 1 L",
        "quantity": 1,
        "purchase_mode": "BUY_ONCE",
        "interval_days": null,
        "unit_price_paise": 550000,
        "line_total_paise": 550000
      }
    ],
    "adjustments": [
      {
        "label": "The Pair",
        "adjustment_type": "AMOUNT_OFF",
        "amount_paise": 50000,
        "scope": "CART"
      }
    ],
    "benefits": [],
    "total_paise": 1150000
  },
  "delivery": {
    "status": "ORDER_CREATED",
    "expected_from": null,
    "expected_to": null,
    "courier_display_name": null,
    "awb_masked_or_safe": null,
    "latest_event": null,
    "timeline": []
  },
  "subscription": {
    "active": true,
    "status": "ACTIVE",
    "subscribed_items": [
      { "sku": "GIR-1000", "quantity": 1, "status": "ACTIVE" }
    ],
    "interval_days": 30,
    "next_charge_at": "2026-10-24T12:10:00.000Z",
    "projected_next_amount_paise": null,
    "mandate_max_amount_paise": 1150000
  },
  "customer": {
    "first_name": "Asha",
    "masked_phone": "••••••9999",
    "city": "Gurugram",
    "postal_code": "122001"
  }
}
```

Field behavior:

- `state` is the stored order status string. It is not runtime-validated against `NormalizedPaymentState`.
- `order.items[].interval_days` is nullable in this API.
- All order money is integer paise.
- `delivery.status` is `NOT_CREATED` when no shipment row exists.
- Delivery dates, courier, AWB, and latest event are always keys and nullable.
- Tracking event shape is `{ status, description, location, occurred_at }`; `description` and `location` can be null. Timeline is newest first.
- `subscription` is omitted entirely for pure buy-once orders.
- When present, `subscription.active` is true only when status is `ACTIVE`.
- `interval_days`, `next_charge_at`, `projected_next_amount_paise`, and `mandate_max_amount_paise` are nullable.
- `projected_next_amount_paise` comes from the latest stored subscription cycle amount; the initially scheduled cycle can still have `null` before renewal pricing runs.
- Customer fields are nullable. Phone contains only the last four digits when present.
- The current field named `awb_masked_or_safe` contains the stored AWB as-is; Framer must treat it as customer-facing tracking data.

### Errors

| HTTP | Code | Meaning |
|---:|---|---|
| 400 | `INVALID_EXPERIENCE_TOKEN` | Token absent or shorter than 32 characters. |
| 404 | `EXPERIENCE_NOT_FOUND` | Token hash does not match an order. |

Common origin, rate-limit, and system errors also apply.

## 11. Exact cart-shape examples

These examples use the seeded prices and launch promotions active on 24 September 2026. They are illustrative live-data examples, not client-side pricing authority. Framer must always render the returned quote.

### 11.1 Mixed: Gir subscription + Murrah buy once

Quote items:

```json
[
  {
    "line_id": "gir-1",
    "sku": "GIR-1000",
    "qty": 1,
    "purchase_mode": "SUBSCRIPTION",
    "interval_days": 30
  },
  {
    "line_id": "murrah-1",
    "sku": "MURRAH-1000",
    "qty": 1,
    "purchase_mode": "BUY_ONCE"
  }
]
```

Implemented result under the seeded launch window:

- Initial subtotal: `1300000` paise.
- Gir early-bird: `50000` paise.
- Murrah early-bird: `50000` paise.
- Pair: `50000` paise.
- Initial total: `1150000` paise.
- Renewal cart: Gir only.
- Projected cycle-2 Gir subtotal: `750000` paise.
- Cycle-2 subscriber benefit: `50000` paise.
- Projected recurring total: `700000` paise.
- Default mandate buffer: `250000` paise.
- Mandate maximum: `max(1150000, 700000 + 250000) = 1150000` paise.
- Prepare uses `payment_kind: RECURRING_AUTH`, charges the entire initial mixed cart, and returns a subscription UUID.

### 11.2 Pure buy once: Gir

```json
[
  {
    "line_id": "gir-once",
    "sku": "GIR-1000",
    "qty": 1,
    "purchase_mode": "BUY_ONCE"
  }
]
```

Implemented launch-window example:

- Initial subtotal: `750000` paise.
- Early-bird discount: `50000` paise.
- Initial total: `700000` paise.
- `recurring_groups: []`.
- Prepare uses `payment_kind: ONE_TIME`.
- `razorpay.recurring: false`.
- `razorpay.customer_id` absent.
- Recurring projection is `0`; mandate and interval are `null`; `subscription_id` is `null`.
- `recurring_consent` may be omitted.

### 11.3 Pure subscription: Gir every 30 days

```json
[
  {
    "line_id": "gir-sub",
    "sku": "GIR-1000",
    "qty": 1,
    "purchase_mode": "SUBSCRIPTION",
    "interval_days": 30
  }
]
```

Implemented launch-window example:

- Initial subtotal: `750000` paise.
- Initial early-bird discount: `50000` paise.
- Initial total: `700000` paise.
- Projected cycle-2 subtotal: `750000` paise.
- Projected cycle-2 subscriber benefit: `50000` paise.
- Projected recurring total: `700000` paise.
- Default mandate maximum: `max(700000, 700000 + 250000) = 950000` paise.
- Prepare uses `payment_kind: RECURRING_AUTH`, returns Razorpay customer ID and Uppermost subscription UUID, and requires accepted recurring consent.
- `CONFIRMED` requires captured payment plus a usable recurring token. Captured payment without the usable token is `ACTIVATION_PENDING`.

## 12. Framer integration sequence

```text
stable guest_session_id
  -> POST quote
  -> display server totals/benefits/mandate cap
  -> POST serviceability when pincode/cart changes
  -> collect address + recurring consent when needed
  -> POST prepare with stable prepare Idempotency-Key
  -> map public prepare payload into Razorpay Checkout
  -> Razorpay success callback
  -> POST verify with stable verify Idempotency-Key
  -> poll GET status when unresolved
  -> navigate to returned /experience?t=...
  -> Framer page calls GET /api/experience?token=<t>
```

Frontend invariants:

- Never calculate the charge from displayed catalog copy.
- Never open Razorpay if quote/prepare/serviceability failed.
- Never mark an order paid from the Razorpay browser callback alone.
- Never retry payment while status says `retry_allowed: false`.
- Never place `quote_token` or experience token into analytics events.
- Never persist provider secrets; none are required by this flow.

## 13. Drift report

### 13.1 Actual code vs `UPPERMOST_COMMERCE_OPENAPI.yaml`

`UPPERMOST_COMMERCE_OPENAPI.yaml` is not present anywhere in the current repository or the supplied text attachments. Therefore a literal operation/schema-by-schema diff against that file cannot be performed without inventing content. This missing canonical artifact is itself a contract drift and should be resolved by restoring or regenerating the OpenAPI document from this implemented contract.

The earlier implementation brief that contained the intended API examples differs from actual code in these identifiable ways:

1. Older examples used money names such as `amount`, `subtotal`, `discount`, `shipping`, `tax`, `total`, `projected_total`, and `mandate_max_amount`. Actual public JSON consistently uses `_paise` suffixes.
2. Actual successes include `ok: true`; the older serviceability/status/experience snippets did not consistently show it.
3. Actual quote `items` expose the full normalized item shape, including product/product-variant UUIDs, product code/name, dimensions, weight, and line paise values.
4. Actual quote `promotions[].scope` is hard-mapped to the literal `INITIAL`, not the underlying adjustment scope (`CART`, `MATCHING_LINES`, or `SHIPPING`).
5. Actual quote shipping includes `shipping_amount_paise` and optional `best_courier_internal_reference`.
6. Actual serviceability includes `ok`, nullable delivery timestamps, and a fallback `200 serviceable:false` when Shiprocket cannot be reached.
7. Actual prepare returns `subscription_id` for every success, using `null` for buy once. Earlier response examples omitted it.
8. Actual prepare Razorpay data uses `key_id` and `amount_paise`; Framer must map them to Razorpay browser option `key` and `amount`.
9. Actual recurring consent version is any 3–100 character string; no fixed version literal is enforced.
10. Actual verify response is the complete checkout-status object, not a dedicated verify-only object.
11. Actual status includes `ok`, derives `retry_allowed` from only four states, and exposes `next` for both `CONFIRMED` and `ACTIVATION_PENDING`.
12. Actual `next.url` uses the Framer query key `t`, while the experience API itself requires `token`.
13. Actual experience adds `subscription.status`, `adjustments[].adjustment_type`, `benefits[].fulfilment_status`, and always-present nullable delivery fields.
14. Actual experience `state` is an unconstrained stored order status, not runtime-validated as a normalized payment state.
15. Actual error surface additionally includes media type, payload size, invalid JSON, rate limiting, inventory-provider failure, customer identity conflict, payment-attempt not found, checkout not found, and experience-token errors.
16. Actual idempotency stores and replays post-reservation error responses, including `QUOTE_CHANGED` and unexpected `500` results.

### 13.2 Actual code vs `docs/UPPERMOST_COMMERCE_ARCHITECTURE.md`

Aligned behavior:

- Framer owns visible UI; the backend owns pricing, checkout, payment, subscription, shipping, and safe state.
- Per-line buy-once/subscription and mixed carts are implemented.
- Initial payment includes every line; renewal pricing contains subscription lines only.
- Server prices in integer paise and re-evaluates promotions.
- Razorpay Orders/Customers/recurring token model is used; Plans/Subscriptions APIs are not used.
- Quote token is high entropy and stored hashed.
- Prepare reprices and returns a fresh quote instead of silently changing the charge.
- Money-changing browser endpoints are durable/idempotent.
- Fulfillment starts only on captured payment.
- Subscription activation requires captured payment and a usable token; otherwise `ACTIVATION_PENDING`.
- Provider secrets and raw provider errors are not returned.
- Experience lookup uses a high-entropy token and does not expose full address, email, payment token, or mandate token.

Implemented drift or narrower behavior:

1. **Quote context verification is narrower than the frozen design.** The database stores a cart fingerprint and shipping context, but prepare validates only quote existence/token, exact `guest_session_id`, status, and expiry. It does not pass a cart fingerprint into `validateQuoteRecord`. Prepare uses the stored items, while a different shipping-address postal code can be accepted when re-pricing produces the same serviceability and amount fingerprint.
2. **Quote issuance is guest-only.** The implemented quote request always requires `guest_session_id` and does not accept/authenticate a customer identity, although the architecture describes guest/customer binding.
3. **Carts are not part of the route flow.** `carts` and `cart_items` tables exist, but quote/prepare persist directly to `commerce_quotes` and checkout/order records.
4. **Experience state is not fully normalized.** `/api/experience` returns `orders.status` directly. For example, a pending order can return `PAYMENT_PENDING`, which is not the declared normalized state `PENDING`.
5. **Experience messaging is coarse.** It selects only `PAYMENT_CONFIRMED` when order status is `CONFIRMED`; otherwise `PAYMENT_PENDING`. It does not currently select mandate/renewal action-required copy from subscription or mandate status.
6. **Experience token timing differs.** The token is created during prepare, not after confirmation. It is only returned to Framer through status `next` after `CONFIRMED` or `ACTIVATION_PENDING`, and only its hash is stored on the order.
7. **`ACTIVATION_PENDING` exposes experience navigation.** The architecture emphasizes activation only after payment plus usable token; current status correctly keeps the state pending but still returns `next.url`.
8. **AWB is not transformed.** The response field is named `awb_masked_or_safe`, but actual code returns the stored `shipments.awb_code` unchanged.
9. **Billing flag has no behavior.** `billing_same_as_shipping` is required but is not used; the backend always persists/ships to `shipping_address` and has no separate billing-address contract.
10. **Public quote shape exposes internal catalog/promotion UUIDs and physical dimensions/weight.** These are not secrets, but this is broader than the minimal customer-facing data described by the architecture.
11. **Shipping provider rate is discarded.** The Shiprocket adapter selects a courier by freight cost but currently returns `shipping_amount_paise: 0`; free shipping is also modeled as a promotion. This matches the current free-shipping offer but is narrower than general paid-shipping support.
12. **Not every declared normalized state is currently written to checkout sessions by the six inspected routes.** The union/message mapping includes all architecture states, while prepare/verify/webhook paths directly produce only a subset. Renewal-only states are handled outside this frontend checkout flow.
13. **The frozen must-pass matrix is only partially automated.** Existing tests cover pricing combinations, promotion timing/eligibility, quote validation helpers, idempotency resolution, duplicate webhook decision, renewal claim gating, and mandate-cap comparison. They do not route-test the exact JSON/CORS contracts, Shiprocket-unavailable flow, pending-to-late-success reconciliation, provider webhooks end to end, or cross-order experience-token isolation.
14. **Prepare failure recovery is stricter than the architecture text explains.** Once an idempotency record has started, even an unexpected `500` is stored as completed and replayed for that key. A checkout row created before a later provider failure can also make the quote unusable through the one-checkout-per-quote constraint.

These drift findings are documentation only. No runtime behavior was changed while producing this contract.
