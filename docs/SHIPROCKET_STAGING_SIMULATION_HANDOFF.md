# Shiprocket staging simulation — local implementation

30 October 2026. Branch `staging`; existing uncommitted WhatsApp work retained.
**Local implementation complete. Not deployed; hosted vanilla E2E remains unverified.**
No Production access/configuration change, remote database write, migration
application, commit, push, deployment, real provider call, payment, shipment or
WhatsApp message occurred. Local environment values were not changed.

## A. Existing versus newly implemented

| Component | Before this task | Final local status |
|---|---|---|
| Shiprocket outbound kill switch | Already blocks auth, serviceability, order creation and tracking with API flag false; Preview defaults closed | Reused; selected simulation additionally blocks provider transport even if API flag is accidentally true |
| Authoritative quote/pricing/inventory | Already implemented | Reused without changing money/inventory logic |
| Checkout, consent, quote authentication and Razorpay verification | Already implemented | Reused; simulation provenance now joins existing QUOTE_CHANGED comparison |
| Captured-payment fulfillment hook | Already calls ensureShipmentForOrder | Narrow branch calls service-only simulated creation, never Shiprocket |
| Canonical shipment ingestion and WhatsApp workflows | Already implemented in local seven-workflow migration | Reused for all three simulated milestones |
| Explicit default-off simulation mode | Missing | Implemented with strict staging/Preview/Test Mode identity |
| Test pincode serviceability | Missing | Labelled SIMULATED estimates and zero shipping through existing response fields |
| Simulated shipment/provider/audit | Missing | Local migration, captured-evidence validation, idempotent creation and append-only audit |
| Authenticated milestone endpoint | Missing | Admin-only strict body, durable event ID, same-origin checks |
| Real inbound carrier isolation | Missing | HTTP block after authentication; DB guards protect simulation records even after mode changes |
| Live website/provider acceptance | Not proven | Still missing; separate deployment/test approval required |

There is no existing pickup API caller or worker in the inspected repository.
This task does not introduce one. All implemented Shiprocket HTTP operations use
the guarded private transport; simulation never invokes that transport.

## B. Exact files and configuration

Modified, preserving prior working contents:

- `.env.local.example`: documents two simulation variables; existing API kill
  switch remains false. Actual `.env.local` was not changed.
- `lib/commerce/shiprocket/client.ts`: simulation serviceability branch; transport
  denial while simulation is selected; simulation tracking IDs never reach a carrier.
- `lib/commerce/fulfillment.ts`: local creation branch; old simulation order
  snapshots cannot later be fulfilled through the real provider.
- `lib/commerce/checkout.ts`: simulation-only provenance comparison, reusing
  existing QUOTE_CHANGED replacement behavior and response contract.
- `app/api/webhooks/shiprocket/route.ts`: authenticates normally, then blocks real
  inbound events before parsing or mutating while simulation is selected.

New:

- `lib/commerce/shiprocket/simulationConfig.ts`
- `lib/commerce/shiprocket/simulation.ts`
- `app/api/admin/shipping/simulation/route.ts`
- `supabase/migrations/20261030082749_staging_shiprocket_simulation.sql`
- `tests/commerce/shiprocket-simulation.test.ts`
- `tests/commerce/shiprocket-simulation-checkout.test.ts`
- `tests/commerce/shiprocket-simulation-database.test.ts`
- `docs/superpowers/plans/2026-10-30-shiprocket-staging-simulation.md`
- This report and `docs/diffs/2026-10-30-shiprocket-staging-simulation.patch`.

Required configuration for a later approved staging deployment:

| Variable | Required value |
|---|---|
| `SHIPROCKET_STAGING_SIMULATION_ENABLED` | `true` only for the approved staging test; default is off |
| `SHIPROCKET_API_ENABLED` | Exact `false`; never enable it to make simulation work |
| `SHIPROCKET_STAGING_TEST_PINCODES` | Explicit comma-separated set, 1–20 valid six-digit pincodes; no defaults |
| `VERCEL_ENV` | Platform-provided `preview` |
| `VERCEL_GIT_COMMIT_REF` | Platform-provided `staging` |
| `VERCEL_GIT_COMMIT_SHA` | Platform-provided 40-character lowercase hex build |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://jwsivyxapfnyaafdcdos.supabase.co` |
| `COMMUNICATION_BASE_URL` | `https://staging.uppermost.store` |
| `COMMUNICATION_DRY_RUN` | Exact `true` |
| `RAZORPAY_KEY_ID` | Verified staging `rzp_test_…` key, never Live |

Razorpay Test secret/webhook secret, Supabase service credentials, token pepper
and staging allowed origins still require their existing server-only settings.
The simulation requires no Shiprocket login/token. The existing carrier webhook
authentication check still requires its configured webhook secret/pickup settings.
No credential is returned in a simulation response or audit record.

Local inspection: simulation flag/pincode list/API flag are absent from
`.env.local`; its database/base are not the exact staging pair. Preview's existing
default-closed transport remains, and the example documents API false. Simulation
cannot operate with this local configuration; tests supply isolated fixture envs.
No hosted settings were read or changed in this task.

## C. Serviceability, checkout and verified payment

Configured pincodes return existing public fields: `ok`, `serviceable`, nullable
ISO estimates, integer `shipping_amount_paise=0`, and a SIMULATED message. Quote
shipping uses its existing `display` field. The 3–5 day estimate is explicitly a
test estimate without a carrier/delivery promise. No courier ID/name or AWB is
invented by serviceability. Unconfigured pincodes are unserviceable.

Internal quote snapshots carry `simulated`, project and pincode provenance.
Pricing uses the existing calculateCartQuote path; checkout still checks stored
quote/token, authoritative reprice, inventory and recurring consent. Switching a
quote between live/simulation, changing its simulation project or pincode cannot
silently replace that provenance at prepare time. Normal live quotes retain their
existing comparison. A persisted simulation order cannot be converted to a real
shipment if flags later change.

The existing capture reconciliation hook calls the local creation RPC only after
normal provider payment identity checks/order confirmation. SQL independently
requires exact captured evidence, amount/currency, owned checkout/customer/order,
INITIAL order kind and the authoritative simulated serviceable quote/address.
Current test-pincode membership is rechecked. Unpaid, nonfinal, mismatched,
cancelled, renewal or unmarked orders fail closed. No financial rows are altered
by simulation RPCs.

Creation produces one local shipment with provider `STAGING_SIMULATION`, status
`ORDER_CREATED`, private `sim_<UUID>` correlation, null AWB/courier/provider-order
IDs, a clear simulated label and saved estimate dates. Repeated/concurrent calls
reuse that shipment and its creation audit event. It cannot replace a real shipment.

## D. Authenticated milestone contract

New **test-only admin endpoint**:
`POST /api/admin/shipping/simulation`. It is absent (404) when mode is off,
fails closed on mismatched configuration, requires same-origin plus the existing
authenticated active ADMIN policy, and accepts only:

```json
{
  "order_id": "<exact staging test order UUID>",
  "shipment_id": "<correlated local shipment UUID>",
  "event_id": "<unique test event UUID>",
  "status": "SHIPPED"
}
```

Use SHIPPED, then OUT_FOR_DELIVERY, then DELIVERED, each with a new event UUID.
Replay the identical event UUID/body for retry. The database checks actor role,
current paid/quote/pincode facts, exact order/shipment ownership and strict next
state; it records an immutable audit event. Conflicting reuse, skips, backwards
steps and cancelled state are rejected. Identical replay does not reset state.

Each milestone calls the existing `comm_ingest_shipment_event` under a private
transaction marker. It creates normal authenticated tracking/customer messages;
existing outbox capture and communication intents evaluate ORDER_SHIPPED,
OUT_FOR_DELIVERY and DELIVERY_CONFIRMATION. No WhatsApp delivery is directly
injected. Draft cutoff, canonical permissions, cancellation and consent suppression
remain authoritative. This task changes neither consent policy nor rule activation.

## E. Traffic and worker isolation

- Outbound: API false is checked before credentials/auth and again before HTTP.
  Simulation-selected transport is blocked regardless of API flag. No simulation
  function calls fetch, carrier auth, order creation, tracking or pickup.
- Inbound: missing/wrong carrier auth remains 401. Authenticated real callbacks
  during selected simulation return 409 before JSON/database access; invalid
  simulation configuration fails closed. Genuine non-simulation behavior is retained.
- Persistent isolation: simulated shipment and tracking writes require the private
  transaction marker. Canonical ingest and its retained implementation alias
  cannot mutate simulated tracking without that marker. Provider/order/correlation
  conversion and AWB/carrier assignment are forbidden on simulated shipments.
- Audit is RLS/service-only, append-only and truncation-protected. Source payment/
  checkout evidence is locked during validation. Service context is trusted server
  infrastructure, never an unauthenticated browser assertion.
- No other shipment/pickup worker was found. Simulation RPCs do not modify
  subscriptions, renewal schedules, pricing, inventory or fulfillment jobs. Keep
  unrelated staging cron/automation paused during hosted vanilla testing.

## F. Verification

| Check | Result |
|---|---|
| New simulation suites | PASS: 74 tests / 3 files |
| Final exact `npm test` | PASS: 504 tests / 51 files, exit 0 |
| Typecheck | PASS, exit 0 |
| New simulation files and previously clean modified modules ESLint | PASS, no findings |
| Full `npm run lint` | FAIL: unchanged 84 errors / 47 warnings |
| Full `npm run build` with existing dummy-credential wrapper | FAIL: existing application lint errors; no rules disabled |
| Independent review | No remaining Important findings after quote-mode fix |

Initial full run concurrent with lint: three known 5-second timeouts in
`tests/admin/endpoints.test.ts`, `tests/commerce/security-idempotency.test.ts`,
`tests/communications/transport.test.ts`. Exact full rerun without concurrent
lint/build passed. No timeout limits were increased. Whole-repository lint totals
match the audited baseline; existing checkout/Shiprocket-webhook any errors remain
with shifted line numbers. No new lint errors/warnings were introduced.

Evidence: `.codex/shiprocket-simulation-*.log`. Quote-mode regressions were observed
RED before the fix, then GREEN. Actual quote/prepare/reconciliation/fulfillment
functions run against local persistence/provider doubles; separate PGlite tests
exercise actual SQL/canonical ingest and all three intents. These tests do not
prove a hosted Framer journey, actual Razorpay signature delivery, multi-session
Postgres concurrency, QStash transport or Meta receipt. All provider networking in
the new suites is forbidden or explicitly replaced with a controlled local seam.

## G. Deployment prerequisites and rollback — separate approval required

1. Review the exact task-only patch and retained dirty workspace. Resolve existing
   lint/build blockers under their own scope before selecting a release.
2. Confirm the target is staging branch/Preview, the exact staging project/base,
   Test keys and approved pincode set. Keep API false and dry-run true; never copy
   Production secrets. Confirm Framer endpoints/CORS target staging.
3. Reconcile migration history/definitions, including the earlier documented signup
   bridge timestamp discrepancy. Simulation directly depends on
   `20261029133013_whatsapp_seven_workflows.sql` and its commerce/communications/
   welcome prerequisites. Canonical acceptance also needs
   `20261028122916_confirm_delivery_acceptance.sql`. The dormant one-message gate
   migration is not a direct simulation dependency; do not blindly apply all
   pending migrations. Approve the exact ordered release set explicitly.
4. Snapshot affected staging definitions/configuration, current deployment/alias,
   rules and pending outbox state. Stop only staging dispatch while changing schema.
5. Under separate approval, apply the reviewed staging migration(s), verify RLS/
   RPC grants/triggers/provider constraint, and prepare reviewed DRAFT mappings.
   Keep all communication rules DRAFT and outbound messages blocked.
6. Deploy a compatible staging build and enable only simulation configuration.
   Verify disallowed/mismatched cases first, then one real browser Test Mode order
   through quote/prepare/server-verified payment/local shipment. No such hosted
   journey was executed here. Verify payment mode and persisted canonical facts.
7. Under separate test approval, use an authenticated admin to advance the three
   milestones and verify canonical intents/dry-run outcomes and duplicate rejection.
   Active rule evaluation requires separately reviewed staging-only activation;
   DRAFT-time work must never be reset to catch up. Real WhatsApp sending remains
   a separate authorization and is not enabled by simulation.

Rollback now: restore only the five modified files from
`.codex/shiprocket-simulation-before/` and remove only this task's new files after
reviewing the patch; preserve subsequent/earlier edits. No remote rollback is needed.

Rollback after a future approved deployment: stop the dedicated staging test and
dispatch, set simulation off while retaining API false/dry-run true, then restore
the prior compatible staging release/alias. Keep additive schema/guards, source
floor, audit, simulated shipment markers, consent, intents and delivery history.
Never convert test records into real shipments, clear consumed send budgets or
replay historical DRAFT work. Do not drop the provider constraint/guards while
simulated records exist. Keep Test credentials and unrelated workers isolated.

STOP: local implementation and verification only. Await explicit deployment approval.
