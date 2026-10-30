# First real Order Shipped WhatsApp test readiness

30 October 2026. **NOT READY for a real send.** Local rehearsal passes; external
prerequisites and a durable one-message authorization gate remain outstanding.
This report supersedes the earlier 339-test handoff for this readiness decision.

## Boundaries and evidence

- Checkout: `staging`, HEAD `0cd4aa140603dcd702f706049bb82c160fd02c06`.
  Existing dirty workspace preserved. No commit, push, deployment, migration,
  remote DRAFT preparation, rule activation, provider mutation, payment, shipment
  creation or real message was performed.
- Read-only SQL was restricted to staging project `jwsivyxapfnyaafdcdos`.
  It returned **zero orders**, zero confirmed orders, and no marked test orders.
  No authorized recipient was supplied in this request.
- Staging has neither `comm_ingest_shipment_event(jsonb)` nor
  `communication_whatsapp_workflow_intents`. Latest recorded migration is
  `20261029113628_whatsapp_staging_welcome`; the seven-workflow migration is absent.
- All nine existing WhatsApp rules are DRAFT with null approval timestamps.
  Dedicated ORDER_SHIPPED and OUT_FOR_DELIVERY mappings are absent remotely.
- Vercel's latest returned READY staging deployment is
  `dpl_E9hVQUKyAMW7urkFd69yjXz2puV6`, commit
  `c2fab28bf0d7a754ba45a341a87d55fcfe1d4997`. This is deployment metadata,
  not proof of the current custom-domain alias or runtime configuration.
- Local `.env.local` has no Meta access token, app secret, WABA/sender IDs,
  verification token, QStash token or signing keys. It has dry-run true,
  provider mutations false and an empty phone allowlist. Its database/base are
  not the staging pair. No secret values were printed or copied into this report.
  Local absence does not establish whether Preview has these variables.

## Exact PASS/FAIL checklist

FAIL means an unmet readiness requirement, including unavailable external evidence;
it does not imply a mocked local test failed.

| Check | Result | Evidence / action |
|---|---|---|
| Full current local suite | PASS | `npm test`: 349 tests, 46 files, exit 0 |
| Typecheck | PASS | `npm run typecheck`, exit 0 after final fixture typing correction |
| Build | PASS | Existing `.codex/verify-whatsapp-build.mjs` runs `npm run build` with dummy credentials; final exit 0 |
| Lint | FAIL | `npm run lint` enters first-time ESLint configuration; no configured unattended lint check; no dependency/config changes made |
| Seven workflow local implementation | PASS | Existing canonical database/application suites, including capture, dispatch and delivery preparation |
| Authenticated synthetic shipment | PASS | Added HTTP-to-PGlite test: invalid auth creates no tracking; valid shipped event creates one; replay is duplicate; DRAFT intent stays BLOCKED_DRAFT; fetch forbidden |
| Paid-order / ownership checks | PASS | Exact order, provider payment ID/order/amount/currency and CAPTURED evidence required |
| Duplicate suppression | PASS | Workflow subject uniqueness, canonical delivery uniqueness, concurrent claim and replay tests |
| Cancellation / return suppression | PASS | CANCELLED, RTO Delivered, Returned and Lost suppress queued shipping; later positive milestones do not resurrect it |
| Historical DRAFT no-catch-up | PASS | Source floor, BLOCKED_DRAFT, activation cutoff and welcome timestamp regressions |
| Consent / STOP local behavior | PASS | Marketing affirmative consent, transactional explicit denial, durable phone STOP, withdrawal before dispatch; see limitation below |
| Callback persistence / ordering | PASS | Early callbacks replay on acceptance; READ does not regress to SENT; duplicate event identity; persistence errors return retryable failure |
| Staging callback sender isolation | PASS locally | New regressions reproduce and fix signed wrong-WABA / wrong-sender STOP writes; missing configured identity returns 503 |
| Unconditional dry-run preserved | PASS | Provider, legacy/OTP and delivery guards retained; dispatch still hardcodes `p_dry:true`; no bypass added |
| Staging schema matches local path | FAIL | Seven-workflow migration absent; apply only after explicit approval |
| Known staging test order | FAIL | Database has zero orders; prepare a separately approved local-only commerce fixture in staging without payment/provider calls |
| Explicit recipient authorization | FAIL | No number or recorded WhatsApp opt-in supplied |
| Approved Order Shipped Utility template | FAIL | No dedicated remote artifact; Meta inventory unavailable, so approval cannot be asserted |
| Meta token permissions / app mode / sender | FAIL | No usable local Meta credentials or Meta account connector; live checks not executed |
| Meta webhook isolation in hosted environment | FAIL | Local guard tested; actual app callback URL, WABA subscription/override and exclusive staging sender not verified |
| QStash schedule / signing / reachability | FAIL | Local verifier/publication suites pass; live account schedule and keys unavailable |
| Durable one-recipient / one-rule / one-message gate | FAIL | Design prepared separately; current allowlist is not a durable one-message budget |
| Actual accepted / delivered message | FAIL | Intentionally not attempted; requires separate authorization |

Initial concurrent full run: 341 passed, three 5-second timeouts in
`tests/admin/endpoints.test.ts`, `tests/commerce/security-idempotency.test.ts`,
`tests/communications/transport.test.ts`. Bounded rerun: 344/344 passed before
today's additions. Subsequent exact `npm test`: 349/349 passed. No timeout was
hidden by increasing test limits. Local build/test contention is consistent with
these observations, but a single rerun does not prove the timeout root cause.
Scratch command evidence is in `.codex/whatsapp-readiness-*.log` (not release
artifacts). The callback isolation regressions failed first (3 failures), then
passed (8/8 webhook tests). The synthetic workflow suite passes 35/35.
Final `git diff --check` exits 0 (existing LF/CRLF notices only); branch and HEAD
remain unchanged. Final typecheck and build both exit 0 after the local fixes.

Independent read-only review completed on the final code and tests: no important
defect found in the reviewed staging callback guard or shipped eligibility chain.
Conditional compatibility risk retained: the pre-existing dirty-workspace legacy
callback call requires `comm_whatsapp_legacy_event` (welcome migration
`20261029113628`) in every database receiving that code. Staging has that migration.
No Production schema inspection or outage claim was made. This patch must not be
deployed to Production under this authorization. The earlier implementation
ledger's unchecked review item is superseded by this explicit current result;
it is not evidence of an earlier completed review.

## Path audit

1. `/api/webhooks/carrier-events` aliases the shipment POST handler. It checks
   the server webhook secret before database access. Under the consistent staging
   Preview boundary, it invokes atomic `comm_ingest_shipment_event` with normalized
   identifiers. It makes no Shiprocket HTTP call and never creates a shipment.
2. The RPC checks shipment identity conflicts, explicit milestone, event identity,
   occurrence time and terminal/monotonic tracking. It records authenticated facts
   atomically; notification waits for exact captured settlement evidence.
3. Existing outbox events and bounded authoritative recovery feed
   `comm_capture_whatsapp_workflows`. The new intent is unique by workflow/subject,
   reuses the canonical message/run/delivery ledgers and expires after 24 hours.
   Inactive-time work is audit-only and cannot be released by activation.
4. `comm_dispatch_whatsapp_workflows` requires an eligible active approved rule,
   builds a canonical run, and application dispatch always passes `p_dry:true`.
   AUDIENCE/RECIPIENTS/SEND outbox work flows through the existing engine.
5. `publishOutbox` publishes only outbox IDs to QStash, using event deduplication,
   bounded claims, lane flow control and sanitized publication errors.
   Dispatcher POST and consumer verify raw-body QStash signatures with current
   and next keys, bound to the exact destination URL. Dispatcher GET requires the
   cron bearer secret. [QStash signature requirements](https://upstash.com/docs/qstash/howto/signature).
6. `sendDelivery` atomically claims and rechecks workflow permission before its
   dry-run block. Paid ownership, current shipment, rule validity, preferences and
   expiry are checked again. Provider send requires ACTIVE local content and
   approved provider metadata. Ordered body parameter keys build the Meta payload.
7. Provider acceptance binds the canonical provider ID. Signed Meta callbacks feed
   `comm_provider_event` and legacy correlation. Today's staging guard additionally
   requires configured WABA and sender identities, rejects other WABAs/senders
   before persistence, and leaves non-staging behavior intact.
8. Timeout/unknown acceptance and expired send reservations require reconciliation.
   Existing definite HTTP failures can retry. A future strict one-message test
   must burn its budget before the first provider attempt and disable automatic
   retry for that authorization, even for nominally retryable errors.

The callback guard cannot distinguish environments that deliberately share the
same app, WABA and sender. A dedicated staging sender/subscription or verified
per-WABA callback override is an external prerequisite; no settings were changed.

## Exact template finding

No approved Order Shipped Utility template was verified. Staging only has the
older `uppermost_whatsapp_shipping_update_v1`, language `en`, provider status
`DRAFT`, provider category null, local category `TRANSACTIONAL`, parameters
`[name, order_number, shipment_status]`. It is not the dedicated shipped template.

The unapplied local seven-workflow draft proposes:

- Logical key / rule: `UPPERMOST_WHATSAPP_ORDER_SHIPPED_V1`.
- Provider name: `uppermost_whatsapp_order_shipped_v1`; language: `en`.
- Local version/artifact status: DRAFT; desired Meta category: UTILITY.
- Body: `Hello {{1}}, Uppermost order {{2}} has shipped.`
- `{{1}}` = server customer `name`; `{{2}}` = owned order `order_number`.
  No header, URL button or tracking parameter is proposed.

These are proposed values, not Meta approval evidence. Never substitute
`en_US`, `hello_world`, the generic shipping draft or the approved welcome.
Before approval, fetch the actual WABA template inventory and compare exact body,
language, category, component count/order and approval status. Local
TRANSACTIONAL is an internal category; it does not prove Meta UTILITY approval.

## Consent and remaining local changes

Current utility workflow policy rejects an explicit transactional denial, but
does not require a positive transactional preference row. Therefore the first
test gate must separately require explicit WhatsApp test opt-in evidence for
the exact normalized recipient, timestamp and purpose. Do not infer that evidence
from payment, email consent, a phone's existence or a test allowlist.

Changes made in this request: staging callback identity checks in
`lib/communications/webhooks.ts`; four regression cases in
`tests/communications/whatsapp-webhook.test.ts`; one authenticated synthetic
HTTP/database rehearsal in `tests/communications/whatsapp-workflows.test.ts`;
this report and the separate approval plan. Existing earlier changes remain.

Required staging changes after review: apply the existing ordered seven-workflow
migration and DRAFT preparation, deploy the scoped reviewed application build,
provision verified staging-only provider configuration, prepare a marked test
order/shipment without provider calls, and implement/test the durable gate in
the approval plan. No general dry-run bypass is part of this patch.

## Rollback

Stop dispatch; revoke the exact test authorization; pause only the dedicated test
rule; retain dry-run true and empty allowlists. Revoke any test schedule separately
without touching Production schedules. Roll back the scoped application release
to a compatible staging build while retaining send guards and callback isolation.
Retain additive schema, source capture floor, consent/STOP, intents, outbox,
delivery/provider IDs and callback history. Never delete audit history, reset
DRY_RUN/SUPPRESSED/accepted rows to pending, replay DRAFT history, or retry an
uncertain send. Reconcile it by provider ID first. No destructive down migration,
payment reversal or shipment cancellation is required for this test.

Deployment and real-send approval are separate; see
`WHATSAPP_ONE_MESSAGE_APPROVAL_PLAN.md`. This readiness report grants neither.
