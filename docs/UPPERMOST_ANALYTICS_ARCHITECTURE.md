# Analytics architecture and staged security rollout

Before: the external GTM Custom Tracker wrote visitor/session/event tables directly using the Supabase publishable key. Live RLS was enabled but public read/update policies were broad. Existing Dashboard subscribed and read with the browser client.

After the approved continuation: `POST /api/analytics/ingest` is the public technical telemetry sink. It validates configured origins, UUID identities/the existing tracker fallback, UTC timestamps, event/metadata bounds, technical attributes and safe URLs. It disallows customer_id and private field names. Browser IDs are untrusted; this endpoint cannot resolve or mutate commerce identity. Optional client event UUIDs deduplicate retries. Service-side RPC writes raw history and bounded incremental behavior features. No Supabase service-role/provider credentials reach the browser.

Current hard limits: 120 requests/minute per in-process IP bucket, 50 events, 32-KB UTF-8 batch, 4-KB metadata, depth four and arrays of 20. Add distributed gateway/WAF rate limiting before relying on those in-process buckets for abuse prevention across Vercel instances. Origins are not proof of ownership of a visitor ID; forged allowed-origin telemetry remains soft, non-authoritative data.

The additive identity migration introduces authenticated operator-only SELECT policies but deliberately retains old anonymous policies during transition. The existing dashboard retains compatible operator-scoped reads/realtime; new customer journey APIs require verified server membership. Browser writes are removed by the separately reviewed manual SQL script after GTM rollout.

Rollout order: apply additive migrations in staging, deploy the API, verify its writes, prepare GTM changes, Preview, publish, confirm Custom Tracker/GA4/Clarity traffic, then apply `supabase/manual/analytics_lockdown_after_gtm_rollout.sql`. Verify anonymous historical reads and direct inserts/updates fail, operator reads succeed, and server ingest continues. Never include this lockdown file in an automatic migration rollout before GTM publication.

Rollback the Custom Tracker to the last verified API-compatible version. Do not reopen anonymous historical reads. A return to direct browser writes needs a separately reviewed narrow write architecture; the old USING(true) policies are not a rollback plan. See [GTM instructions](UPPERMOST_GTM_ANALYTICS.md) and [read-model design](UPPERMOST_ANALYTICS_READ_MODEL.md).
