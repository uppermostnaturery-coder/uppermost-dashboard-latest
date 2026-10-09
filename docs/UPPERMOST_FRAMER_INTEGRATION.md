# CheckoutDrawer identity handoff

**EXTERNAL MANUAL CHANGE — NOT APPLIED BY THIS REPOSITORY**

Add this helper alongside the existing CheckoutDrawer request utilities:

```typescript
function getUppermostAnalyticsIdentity() {
  try {
    const analytics = (window as any).uppermostAnalytics;
    if (analytics && typeof analytics.getIdentity === "function") {
      return analytics.getIdentity();
    }
  } catch {}
  try {
    return {
      visitorId: localStorage.getItem("uppermost_visitor_id") || null,
      sessionId: localStorage.getItem("uppermost_session_id") || null
    };
  } catch {
    return { visitorId: null, sessionId: null };
  }
}
```

Immediately before the existing `fetch(CHECKOUT_PREPARE_URL, …)`:

```typescript
const { visitorId, sessionId } = getUppermostAnalyticsIdentity();
```

Preserve its URL, method, existing headers and body. Add these two spreads inside its existing `headers` object:

```typescript
...(visitorId ? { "X-Uppermost-Visitor-Id": visitorId } : {}),
...(sessionId ? { "X-Uppermost-Session-Id": sessionId } : {})
```

Do not change `JSON.stringify(existingCheckoutBody)`, quote handling or the existing `Idempotency-Key`. The repository now allows both headers in commerce CORS. Deploy that CORS change before publishing CheckoutDrawer. Missing or malformed IDs are ignored; blocked localStorage and late GTM loading cannot prevent checkout. Server identity linking happens only after the existing customer resolver and is best effort. It does not authenticate a customer, alter a quote, or change the checkout body hash.

## External verification

In Framer Preview, inspect the OPTIONS response and a prepare request with both headers. Compare its JSON body to the current implementation byte for byte. Retry the same idempotency key/body after changing only analytics headers; the commerce result must replay unchanged. Test missing GTM, blocked localStorage and malformed IDs with a valid quote. Confirm totals and Razorpay setup remain unchanged, and inspect the server-only identity link using an operator session. Test the anonymous tracker ID before and after the 30-minute inactivity interval. These external publication checks were not performed during repository implementation.
