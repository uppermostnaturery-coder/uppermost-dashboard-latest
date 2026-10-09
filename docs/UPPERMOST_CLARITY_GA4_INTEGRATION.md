# Clarity and GA4 identity

**EXTERNAL MANUAL CHANGE — NOT APPLIED BY THIS REPOSITORY**

GTM orchestrates the first-party tracker, GA4 and Clarity as separate destinations. `uppermost_visitor_id` and `uppermost_session_id` remain owned by the first-party tracker. Verify GTM’s **Analytics Client ID** and **Analytics Session ID** variables read those exact active values; GA4’s client/session identifiers are not interchangeable by assumption.

After Clarity loads and each time the existing tracker rotates its active session:

```javascript
var identity = window.uppermostAnalytics && window.uppermostAnalytics.getIdentity();
if (identity && identity.visitorId && window.clarity) {
  window.clarity("identify", identity.visitorId, identity.sessionId || undefined);
}
```

Do not send names, customer IDs, emails, phones or addresses to this call. GA4 is independent: retain its existing tag configuration and consent handling. No GA4 export ingestion is implemented here.

Clarity installation does not expose its proprietary rage-click/dead-click detections to Uppermost’s database. The feature model has space for future approved behavioral signals, but V1 does not infer those signals from Clarity presence and does not send friction-triggered messages.
