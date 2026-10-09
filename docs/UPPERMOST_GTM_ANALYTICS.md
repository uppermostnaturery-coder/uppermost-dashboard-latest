# GTM tracker handoff

**EXTERNAL MANUAL CHANGE - NOT SAVED OR PUBLISHED BY THIS IMPLEMENTATION**

The `Custom Tracker - Base` source was inspected read-only in the existing GTM workspace on 7 October 2026. Save remained disabled and its seven existing workspace changes were not modified. Verify that draft against the published container before changing it.

Keep existing visitor/session generation, localStorage keys, 30-minute inactivity logic, click/scroll/history listeners, geo lookup and every `track` caller. Its `uuid()` fallback produces `id-<timestamp>-<random>`; ingestion accepts that existing format as well as UUIDs. Framer never creates IDs.

## Exact insertion

Inside Custom Tracker - Base's existing `(function () { ... })();`, immediately after `window.uppermostTrack = track;`, insert the entire contents of [gtm-communications-patch.js](integrations/gtm-communications-patch.js). Replace YOUR_DASHBOARD_DOMAIN with the deployed HTTPS dashboard origin. Do not add another script tag/IIFE. Its later function declarations override only `upsertVisitor`, `upsertSession` and `track`; callers retain the same signatures and promises. Old `request`/Supabase-key helpers become unused; remove them only after confirming no remaining call uses them. No service-role key belongs in GTM.

The identity-only addition is exactly:

```javascript
window.uppermostTrack = track;
window.uppermostAnalytics = {
  getIdentity: function () {
    return { visitorId: visitorId, sessionId: sessionId };
  },
  track: track
};
```

It reads active variables without generating IDs or exposing customer/contact data. The full transport patch is necessary for the approved ingestion security rollout; the accessor alone does not replace direct Supabase writes.

## Preserved behavior and privacy

Both upserts send SESSION_TOUCH to `/api/analytics/ingest`, preserving their true/false online argument. `track` sends one EVENT with ISO time, the same event name and bounded metadata; session_end stays offline. Device/browser/OS/timezone, geo, referrer and UTM dimensions are persisted against the audited columns. CSS class_name/tag_name remain technical fields. Arbitrary button text is omitted because account labels can contain contact information. Queries/hashes/credentials, mailto/tel destinations and private metadata field names are removed. Metadata limits: 4 KB, depth four, 40 keys, arrays of 20; batches: 50 events/32-KB UTF-8. Review future account page paths/titles if they embed private information.

Existing callers retained: page_view, checkout_open, checkout_exit, product_view, scroll_depth_25/50/75/100, button_click, add_to_cart, remove_from_cart, checkout_started, buy_now_click, session_end. Product views without product_code remain soft page-path affinity. Cart values require an explicit cart_value_paise fact from Framer; click detection alone does not know a trusted cart price.

## Preview, publication and rollback

Deploy additive migrations, ingestion and CORS first. GTM Preview must show only the new dashboard endpoint receiving Custom Tracker writes. Verify page/cart/scroll/checkout events, heartbeat/offline state, geo/UTM breakdowns, accessor/localStorage IDs and reload after more than 30 minutes. Check configured Framer origins and 202 responses. Test the rare ID fallback without clearing real user identities.

Keep GA4 event tags, Google tag and Microsoft Clarity tags intact. Verify independent provider traffic and their GTM variables in DebugView/Clarity. Compare the operator's existing workspace edits before publishing a named version. The transport change does not redirect GA4/Clarity traffic.

After publication and healthy traffic, manually apply `supabase/manual/analytics_lockdown_after_gtm_rollout.sql`. Verify anonymous SELECT/INSERT/UPDATE fail, server ingest continues, and operator reads/realtime remain healthy. Keep the prior container version, but do not restore broad anonymous reads for rollback. Returning to direct writes needs a separately reviewed narrow write policy.
