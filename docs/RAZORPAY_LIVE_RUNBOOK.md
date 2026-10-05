# Uppermost Razorpay Live + Renewal Runbook

**Actual-code version:** 5 October 2026
**Production base:** `https://uppermost-dashboard-latest-orcin.vercel.app`

## Live webhook configuration

Configure Razorpay Live webhook URL:

`https://uppermost-dashboard-latest-orcin.vercel.app/api/webhooks/razorpay`

Enable exactly:

- `payment.authorized`
- `payment.captured`
- `payment.failed`
- `token.confirmed`
- `token.rejected`
- `token.cancelled`
- `token.paused`

Do not enable `subscription.authenticated`, `subscription.activated`, `subscription.charged`, `subscription.pending`, `subscription.halted`, `subscription.cancelled`, `subscription.paused`, `subscription.resumed`, `subscription.completed`, or `subscription.updated`. Uppermost does not use Razorpay Plans/Subscriptions. `order.paid` is unnecessary; if delivered, it is a persisted signed no-op.

## Razorpay APIs used

- `POST /customers`
- `POST /orders` for one-time and initial `as_presented` recurring authorization
- `POST /orders` with `notification.token_id` and `notification.payment_after` for a renewal's pre-debit lifecycle
- `GET /payments/{payment_id}` for browser-return verification
- `POST /payments/create/recurring` with `recurring: true` for a due debit
- `GET /orders/{order_id}/payments` before a bounded retry/reconciliation

Base URL is `https://api.razorpay.com/v1` through `RAZORPAY_API_BASE_URL`.

## Production environment

Required in Vercel Production without printing values:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `COMMERCE_TOKEN_PEPPER`
- `COMMERCE_QUOTE_TTL_SECONDS`
- `COMMERCE_MANDATE_BUFFER_PAISE`
- `COMMERCE_ALLOWED_ORIGINS`
- `COMMERCE_INVENTORY_SOURCE`
- `COMMERCE_CRON_SECRET`
- `CRON_SECRET` set to the same value as `COMMERCE_CRON_SECRET` so Vercel supplies the correct Bearer token
- `RAZORPAY_KEY_ID`
- `RAZORPAY_KEY_SECRET`
- `RAZORPAY_WEBHOOK_SECRET`
- `RAZORPAY_API_BASE_URL=https://api.razorpay.com/v1`
- `RAZORPAY_MANDATE_EXPIRY_DAYS`
- `SHIPROCKET_TOKEN` or `SHIPROCKET_EMAIL` + `SHIPROCKET_PASSWORD`
- `SHIPROCKET_PICKUP_POSTCODE`
- `SHIPROCKET_PICKUP_LOCATION`
- `SHIPROCKET_WEBHOOK_SECRET`
- `SHIPROCKET_API_BASE_URL`

All secrets are server-only. Framer receives only the Razorpay public key ID and checkout-safe data.

## Deployment sequence

1. Apply `supabase/migrations/20261005090000_harden_razorpay_recurring_architecture.sql` to Production.
2. Confirm RLS remains enabled and only `service_role` can execute the two claim RPCs.
3. Configure both cron variables and Razorpay Live variables in Vercel Production.
4. Deploy Next.js.
5. Configure the exact Razorpay events above and the matching Live webhook secret.
6. Run the unauthorized/authorized cron tests below.
7. Run one-time, recurring authorization, token-first, captured-first and renewal smoke tests.
8. Confirm one payment attempt, order, message and shipment per successful cycle.

## API impact

### Modified

| Method/path | Purpose/auth | Frontend impact |
|---|---|---|
| `POST /api/webhooks/razorpay` | Razorpay only; raw-body HMAC in `X-Razorpay-Signature`, event identity in `x-razorpay-event-id` | None |
| `POST /api/internal/renewals/run` | Legacy internal alias; `Authorization: Bearer <COMMERCE_CRON_SECRET>` | None |

### Newly created

| Method/path | Purpose/auth | Frontend impact |
|---|---|---|
| `GET /api/internal/cron/renewals` | Canonical daily Vercel Hobby Cron wake-up; Bearer secret | None |

### Behavior changed, route unchanged

| Method/path | Change |
|---|---|
| `POST /api/checkout/prepare` | Persists Razorpay order correlation on a pending recurring mandate; response is unchanged |
| `POST /api/payments/verify` | Uses centralized strict order/payment/amount/currency and monotonic reconciliation; request/response unchanged |
| `GET /api/checkout/status` | Can remain `ACTIVATION_PENDING` until both capture and token confirmation; response schema unchanged |
| `GET /api/experience` | Reflects the hardened persisted state; response schema unchanged |

### Audited only

- `GET /api/commerce/catalog`
- `POST /api/commerce/quote`
- `POST /api/shipping/serviceability`
- `POST /api/webhooks/carrier-events`

The exact public JSON contract remains in `docs/FRAMER_COMMERCE_CONTRACT.md`. No Framer request shape changed.

## Curl handbook

There is no general commerce health route.

### Authoritative quote

```bash
curl -i 'https://uppermost-dashboard-latest-orcin.vercel.app/api/commerce/quote' \
  -H 'Content-Type: application/json' \
  -H 'Origin: https://www.uppermost.store' \
  --data '{
    "guest_session_id":"<SESSION_ID>",
    "postal_code":"110001",
    "items":[
      {"line_id":"gir","sku":"GIR-1000","qty":1,"purchase_mode":"SUBSCRIPTION","interval_days":30},
      {"line_id":"murrah","sku":"MURRAH-1000","qty":1,"purchase_mode":"BUY_ONCE"}
    ]
  }'
```

Success is HTTP 201 and includes `quote_id`, `quote_token`, `valid_until`, `initial`, `recurring_groups`, and shipping context. Money is integer paise.

### Shipping serviceability

```bash
curl -i 'https://uppermost-dashboard-latest-orcin.vercel.app/api/shipping/serviceability' \
  -H 'Content-Type: application/json' \
  -H 'Origin: https://www.uppermost.store' \
  --data '{
    "postal_code":"110001",
    "items":[{"line_id":"gir","sku":"GIR-0500","qty":1,"purchase_mode":"BUY_ONCE"}]
  }'
```

Success is HTTP 200. An unserviceable pincode returns the normalized error envelope.

### Checkout prepare

```bash
curl -i 'https://uppermost-dashboard-latest-orcin.vercel.app/api/checkout/prepare' \
  -H 'Content-Type: application/json' \
  -H 'Origin: https://www.uppermost.store' \
  -H 'Idempotency-Key: <IDEMPOTENCY_KEY>' \
  --data '{
    "guest_session_id":"<SESSION_ID>",
    "quote_id":"<QUOTE_ID>",
    "quote_token":"<QUOTE_TOKEN>",
    "customer":{"name":"Test Customer","email":"test@example.com","phone":"+919999999999"},
    "shipping_address":{"line1":"Test address","city":"Delhi","state":"Delhi","postal_code":"110001","country":"IN"},
    "billing_same_as_shipping":true,
    "recurring_consent":{"accepted":true,"version":"v1.0"}
  }'
```

Success is HTTP 201 with unchanged Framer-safe Razorpay checkout payload. Omit `recurring_consent` for a pure buy-once quote.

### Payment verify

```bash
curl -i 'https://uppermost-dashboard-latest-orcin.vercel.app/api/payments/verify' \
  -H 'Content-Type: application/json' \
  -H 'Origin: https://www.uppermost.store' \
  -H 'Idempotency-Key: <IDEMPOTENCY_KEY>' \
  --data '{
    "checkout_session_id":"<CHECKOUT_SESSION_ID>",
    "razorpay_payment_id":"pay_...",
    "razorpay_order_id":"order_...",
    "razorpay_signature":"<RAZORPAY_CHECKOUT_SIGNATURE>"
  }'
```

Success is HTTP 200 in checkout-status shape. Signature/order/payment/amount/currency mismatch cannot confirm payment.

### Checkout polling

```bash
curl -i 'https://uppermost-dashboard-latest-orcin.vercel.app/api/checkout/status?session_id=<CHECKOUT_SESSION_ID>' \
  -H 'Origin: https://www.uppermost.store'
```

Success is HTTP 200. `ACTIVATION_PENDING` means capture succeeded but recurring token is not yet confirmed; the browser must poll rather than start a second payment.

### Experience fetch

```bash
curl -i 'https://uppermost-dashboard-latest-orcin.vercel.app/api/experience?token=<EXPERIENCE_TOKEN>' \
  -H 'Origin: https://www.uppermost.store'
```

Success is HTTP 200 with safe order, exact paid items, shipment/timeline, messages and subscription projection. Provider IDs/tokens and full PII are excluded.

### Authorized renewal cron

```bash
curl -i 'https://uppermost-dashboard-latest-orcin.vercel.app/api/internal/cron/renewals' \
  -H 'Authorization: Bearer <CRON_SECRET>'
```

Success is HTTP 200 with notification/debit claim counts and results.

The committed schedule is `0 0 * * *` UTC because Hobby rejects schedules more frequent than daily. The scheduler locks notification work 50 hours before due so the daily job still supplies at least 24 hours of notice. Upgrade the project to Pro before higher subscription volume to use hourly execution and tighter debit timing.

### Unauthorized renewal cron

```bash
curl -i 'https://uppermost-dashboard-latest-orcin.vercel.app/api/internal/cron/renewals'
```

Expected: HTTP 401 with `{"ok":false,"error":{"code":"UNAUTHORIZED","message":"Unauthorized."}}`.

### Signed Razorpay webhook test

Do this only against Test mode/test records or a local/staging deployment. The script signs the exact bytes it sends; it never uses a fake signature. Set `RAZORPAY_WEBHOOK_SECRET` in the shell without committing it.

```bash
RAZORPAY_WEBHOOK_SECRET='<RAZORPAY_WEBHOOK_SECRET>' \
WEBHOOK_EVENT='payment.captured' \
node <<'NODE'
const crypto = require('crypto')
const event = process.env.WEBHOOK_EVENT
const entities = {
  'payment.captured': {
    event,
    created_at: Math.floor(Date.now() / 1000),
    payload: { payment: { entity: {
      id: 'pay_<EXISTING_TEST_PAYMENT_ID>',
      order_id: 'order_<EXISTING_TEST_ORDER_ID>',
      status: 'captured', amount: 100, currency: 'INR'
    } } }
  },
  'token.confirmed': {
    event,
    created_at: Math.floor(Date.now() / 1000),
    payload: { token: { entity: {
      id: 'token_<EXISTING_TEST_TOKEN_ID>',
      payment_id: 'pay_<EXISTING_TEST_PAYMENT_ID>',
      order_id: 'order_<EXISTING_TEST_ORDER_ID>',
      recurring_details: { status: 'confirmed' }
    } } }
  }
}
const body = JSON.stringify(entities[event])
const signature = crypto.createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET).update(body).digest('hex')
fetch('https://uppermost-dashboard-latest-orcin.vercel.app/api/webhooks/razorpay', {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'x-razorpay-signature': signature,
    'x-razorpay-event-id': `manual-${event}-${crypto.randomUUID()}`
  },
  body
}).then(async response => {
  console.log(response.status, await response.text())
  if (!response.ok) process.exitCode = 1
})
NODE
```

Set `WEBHOOK_EVENT='token.confirmed'` to test the second exact supported payload. Values must reference an actual matching Test payment/order/token; otherwise strict correlation deliberately returns an error.

No manual reconciliation route exists. Ambiguous renewals remain `RECONCILIATION_PENDING` for webhook/provider-fetch recovery and operator investigation; do not trigger another debit manually without proving the first did not succeed.

## Production validation checklist

- Migration applied before deployment.
- Invalid webhook HMAC returns 401 without persistence.
- Duplicate processed event returns idempotent 200.
- Failed/stale event is reclaimable.
- Both captured-first and token-first reach active only after both prerequisites.
- Late `payment.failed` cannot downgrade capture.
- Token payload uses `recurring_details.status`; cancelled remains terminal.
- Hourly cron receives Bearer auth; unauthorized request is 401.
- Notification occurs before scheduled debit and cycle amount is locked.
- Above-cap cycle makes no provider debit and becomes `REAUTH_REQUIRED`.
- Ambiguous response does not create a blind second debit.
- Mixed cart renews subscribed lines only.
- One captured cycle yields exactly one order, message and Shiprocket shipment.
- `next_charge_at` advances only after capture from the previous due timestamp.
