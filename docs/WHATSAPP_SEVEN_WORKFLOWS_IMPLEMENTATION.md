# Seven WhatsApp workflows — local implementation report

29 October 2026. Branch: `staging`. Baseline HEAD:
`0cd4aa140603dcd702f706049bb82c160fd02c06`.

Scope: local code, tests and migration/draft artifacts only. No remote Supabase or
Vercel writes, commit, push, deployment, schedule creation, template submission,
live rule activation, message, payment or shipment was performed in this request.
Existing uncommitted work was retained. Synthetic ACTIVE/APPROVED fixtures exist
only inside disposable PGlite tests, never in staging or Meta.

## Implementation evidence

| Workflow | Local evidence | External E2E status |
|---|---|---|
| Welcome | Existing per-phone durable signup intent; independent consent; concurrent duplicate tests; activation eligibility captured at signup; old DRAFT work suppressed; canonical delivery and callback tests | BLOCKED |
| Cart recovery | Server-owned cart with actual lines; 1–24h inactivity; one intent per cart; marketing permission and STOP; authoritative purchase/withdrawal/activity rechecks; prepared-checkout materialization | BLOCKED |
| Payment failed | Exact owned attempt and provider payment/order/amount/currency/status evidence; no successful or superseding active attempt; obsolete/expired work suppressed | BLOCKED |
| Order confirmed | Exact confirmed order with captured settlement and matching paise/currency; event/receipt and business-subject deduplication; no unverified confirmation | BLOCKED |
| Order shipped | Authenticated explicit shipped/picked-up/transit milestone; paid order required for notification; one shipment/milestone intent | BLOCKED |
| Out for delivery | Dedicated rule/template and exact authenticated milestone; obsolete state suppressed; monotonic courier ingestion | BLOCKED |
| Delivered | Exact delivered mapping; undelivered and RTO-delivered never count as customer delivery; authenticated evidence and verified payment; late payment recovery | BLOCKED |

Canonical tests create a run, snapshot recipients, prepare one WhatsApp delivery,
repeat preparation/dispatch and verify that the same business subject has one
delivery. Further tests cover definite retry reclaims, concurrent delivery claims,
no retry of ambiguous sends, persistence rollback, consent withdrawal, STOP,
paused rules, expiry and courier-before-payment ordering. Existing mocked provider
tests cover rejection, 429, timeout ambiguity, template parameters and callbacks.
All provider requests in automated tests use mocks; new workflow suites fail on
an unexpected real fetch.

## Architecture and operational semantics

- Existing outbox/QStash, rule runs, customer messages, deliveries and Meta artifacts
  remain canonical. The new narrow workflow-intent table stores business eligibility
  and links to these records; it is not another delivery ledger.
- New application orchestration is restricted to the consistently configured
  staging Preview boundary. Production takes its existing application paths.
- Existing exception-isolated event hooks cannot roll back financial transitions.
  Bounded post-installation recovery checks durable verified order/payment/tracking
  facts when an outbox capture was missed. It never turns old history into campaigns.
- The migration sets an immutable source-capture floor in the existing recovery
  cursor table. Existing outbox rows are marked evaluated using a fast column
  default; no historical event replay is scheduled.
- DRAFT-time intents are audit-only. Later activation does not release them.
  Dispatch and pre-send permission recheck approval cutoff, current rule validity,
  source ownership, consent and source state. Work expires after 24 hours.
- A server cart ID is one recovery episode: changes invalidate its pending message
  and it is not repeatedly reminded by subsequent schedule ticks. A new cart is a
  new episode, still subject to marketing frequency caps.
- Prepared checkouts can create a recovery-only cart from their stored, validated
  order lines. No checkout/order/payment/quote price or provider state is changed.
  Pre-checkout anonymous browsing with no persisted consenting recipient remains
  ineligible. Framer must send contact/consent through the existing backend flow;
  anonymous telemetry and browser totals never authorize a WhatsApp message.
- Courier ingestion authenticates before RPC access, checks identifier conflicts,
  and atomically records tracking, monotonic milestone and in-app message. An
  authenticated milestone arriving before local payment reconciliation is retained;
  notification waits for captured-payment evidence. This never creates a shipment
  or confirms an order. Duplicate callbacks can safely retry a failed transaction.
- Strict environment dry-run remains an unconditional provider block. Empty staging
  allowlists, disabled provider mutations and the Shiprocket outbound guard were
  preserved. This implementation does not add a live-send bypass.

## Exact files changed by this request

Application:

1. `lib/communications/whatsappWorkflows.ts` — staging-only orchestration and managed-rule routing.
2. `lib/communications/consumer.ts` — capture after projection; prevent generic duplicate workflow runs.
3. `lib/communications/rules.ts` — bounded workflow dispatch; skip generic recovery repeats.
4. `lib/communications/delivery.ts` — exact workflow permission before sending/dry-run recording.
5. `app/api/webhooks/shiprocket/route.ts` — authenticated atomic staging ingestion; Production path retained.

Schema/configuration artifacts:

6. `supabase/migrations/20261029133013_whatsapp_seven_workflows.sql` — CLI-generated additive migration, tested locally, NOT applied remotely.
7. `supabase/manual/prepare_staging_whatsapp_seven_workflows.sql` — idempotent DRAFT preparation, tested locally, NOT run remotely.

Tests/documentation:

8. `tests/communications/whatsapp-workflows.test.ts` — disposable database workflow tests.
9. `tests/communications/whatsapp-workflows-application.test.ts` — authenticated route, environment and pre-send boundary tests.
10. `tests/communications/whatsapp-database.test.ts` — existing welcome fixture updated for the approved no-catch-up policy.
11. `docs/superpowers/plans/2026-10-29-whatsapp-seven-workflows.md` — implementation ledger.
12. `docs/WHATSAPP_SEVEN_WORKFLOWS_IMPLEMENTATION.md` — this report.

Local `.codex/seven-workflows-*.log` verification output is scratch evidence, not
release material. Earlier uncommitted changes are not attributed to this request.

## Migration, templates and external blockers

The migration adds service-only intent functions/table, capture metadata, a private
authentication marker on tracking events, checkout/cart correlation and welcome
activation eligibility. RLS is enabled; anon/authenticated have no new table/RPC
access. No remote database state was changed.

Seven dedicated DRAFT mappings are prepared. Welcome reuses `UPPERMOST_WELCOME_V1`;
others use `UPPERMOST_WHATSAPP_<WORKFLOW>_V1`. `ORDER_SHIPPED` and
`OUT_FOR_DELIVERY` are separate mappings rather than the earlier generic shipping
draft. Existing active/immutable content is not overwritten. New draft language
is `en`; Meta must approve the exact name, language, category, body and parameters.
Stored approval on the old welcome artifact is not fresh proof of Meta readiness.

Remaining blockers, in dependency order:

1. Separately authorize staging-only migration application and DRAFT preparation.
   Verify schema/RPC privileges and existing draft compatibility on the named project.
2. Review the full dirty workspace and scope a future commit; deploy only the
   reviewed staging build. No deployment was made and the running Preview is unchanged.
3. Verify the actual Framer staging signup/consent and prepared-checkout targets,
   phone/customer correlation and existing checkout contract. Anonymous pre-checkout
   carts cannot be contacted without a durable consenting identity.
4. Freshly verify Meta sender/token permissions, WABA/app subscriptions, callback
   signatures and exact template approvals/languages. No credentials were changed.
5. Verify the QStash dispatcher schedule and signing keys, consumer reachability and
   Vercel protection compatibility. Intended dispatcher:
   `https://staging.uppermost.store/api/internal/cron/communications`;
   consumer: `/api/internal/communications/consume`. No schedule was created or enabled.
6. Separately authorize any rule/template activation and a controlled real E2E send.
   Current safeguards deliberately make real delivery impossible. Preserve them
   until a reviewed, explicitly authorized controlled-send procedure exists.

## Rollback and readiness

Fresh final verification: **46 test files / 339 tests passed**; `npm run typecheck`
passed; `npm run build` passed under the dummy-credential wrapper. `git diff
--check` passed (existing LF/CRLF notices only). Branch remains `staging`; HEAD is
unchanged. Lint remains unconfigured in the repository; no ESLint setup was added.
Passing mocked/database tests do not prove real provider delivery.

All seven workflows: **PASS for local implementation and controlled test coverage**.
Live provider E2E and deployment: **BLOCKED / not executed** under this authorization.
Independent review outcome is recorded below when available.

Rollback the scoped application patch while preserving safety guards and existing
work. If schema is later applied, retain additive tables, source floor, consent,
STOP, intent and delivery history; no destructive down-migration is needed. Keep
dispatch paused/dry and reconcile uncertain sends. Never reset a delivered record,
retry an ambiguous send blindly, replay old DRAFT intents or reverse financial state.

Deployment status: NOT DEPLOYED. Live E2E status: BLOCKED by the explicit external
prerequisites above, not represented as successful delivery.
