# Uppermost Communication Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the existing commerce backend with secure administration, analytics identity, durable asynchronous communication, rules, templates and offer management.

**Architecture:** Preserve the hot commerce path and use the existing integration outbox as durable transport intent. Communication rules query compact derived features; QStash delivers bounded work to Vercel. Operator authorization is independent of guest/customer commerce identity.

**Tech Stack:** Next.js 15/React 19, TypeScript, Supabase/Postgres, Supabase Auth, official QStash SDK, cron-parser, sanitize-html, Vitest/PGlite. Framework upgrade followed the dependency audit; see the implementation report.

**Spec:** `docs/UPPERMOST_COMMUNICATION_SPEC.md` and the preceding Production V1 specification supplied in chat.

## Global Constraints

- Preserve checkout body/hash/pricing/payment/subscription semantics and renewal cron.
- No deployment, production sends, live provider configuration, or production migrations during this implementation.
- Supabase is durable authority; QStash is transport; Vercel is compute.
- ADMIN can mutate; VIEWER can read; membership is server-owned and checked after verified Auth.
- Marketing permissions fail closed. OTP is one encrypted, rate-limited challenge across fallback.
- Normal rule queries use derived features with keyset batches capped at 500.
- Existing anonymous analytics permissions are tightened only after external GTM rollout.

## Review Focus

- Shared-device identity changes preserve validity periods and never authorize a purchase.
- Crash after a provider accepts a send cannot blindly resend an ambiguous reservation.
- Concurrent cron/consumer invocations cannot duplicate runs, projection increments or deliveries.
- Quiet hours/caps/unsubscribe/template approval are checked again at actual delivery time.
- Delayed analytics and provider events cannot regress conversion or delivery state.

## Task 1: Operator security

Files: `lib/admin/{auth,http}.ts`, `lib/supabase/{server,browser}.ts`, `app/login/*`, `middleware.ts`, `app/page.tsx`, existing provider analytics/send routes, new admin-membership migration, `tests/admin/auth.test.ts`.

Interfaces: `requireAdmin(request?, roles?) -> {userId, role}`; `adminErrorResponse(error) -> Response`.

- [ ] Test anonymous/nonmember/viewer denial, ADMIN success, protected provider endpoints and customer/admin separation; run and observe RED.
- [ ] Implement verified cookie/bearer sessions, server-owned membership, operator login/logout and protected dashboard/provider reads. Preserve lead-triggered WhatsApp through an internal server service.
- [ ] Run focused tests and typecheck; record GREEN.

## Task 2: Analytics and identity

Files: `lib/analytics/{schema,identity,ingest}.ts`, `app/api/analytics/ingest/route.ts`, checkout route/service/CORS, analytics/identity migration, `tests/analytics/*.test.ts`, GTM/Framer handoff docs.

Interfaces: `validateAnalyticsId(value,prefix) -> string|null`; `linkAnalyticsIdentity(context) -> Promise<void>`; `parseAnalyticsBatch(input) -> validated batch`.

- [ ] Test bounds/origins/metadata/deduplication plus unchanged checkout hashes and success on linker failure; observe RED.
- [ ] Implement compact ingest RPC, optional headers, identity-scoped atomic history and behavior projection. Add separate manually gated analytics lockdown SQL.
- [ ] Verify identity/analytics tests; document exact external patch instructions without claiming GTM/Framer edits.

## Task 3: Durable events and projections

Files: `lib/communications/{outbox,projections,types,limits}.ts`, communication foundation migration, `tests/communications/outbox.test.ts`, recovery route.

Interfaces: `enqueueCommunicationEvent(event)`, `processProjection(event)`, durable claim/finish RPCs.

- [ ] Test dedupe, best-effort failures, bounded recovery and incremental order/product/subscription/behavior state; observe RED.
- [ ] Reuse `integration_outbox` with additive event/lease/lane/transport fields. Capture narrow facts via exception-isolated database bridge; recover missing intents with bounded cursors. Reuse `customer_messages`/`message_deliveries`.
- [ ] Verify on a disposable local Postgres runtime; never mutate production for schema experimentation.

## Task 4: Rules and QStash

Files: `lib/communications/{dsl,schedule,rules,transport,consumer}.ts`, internal cron/consumer routes, rules/runs/recipients RPCs, `tests/communications/rules.test.ts`.

Interfaces: validated whitelisted `RuleCondition`; `nextRuns(cron,tz,from,count)`; `dispatchCommunications()`; signed consumers accept IDs only.

- [ ] Test JSON DSL bounds/all/any/none, indexed feature predicates, keyset batches, cron dedupe, realtime priority and signature rejection; observe RED.
- [ ] Implement atomic due claims, immutable run snapshots, bounded audience snapshots, durable delivery reservation, retries/reconciliation, two lanes and provider flow control.
- [ ] Verify bounded large synthetic processing and critical SQL query plans in local development.

## Task 5: Templates/providers/preferences/OTP

Files: `lib/communications/{templates,email,preferences,delivery,otp}.ts`, `lib/communications/providers/*`, authenticated template/provider/test-send routes, signed provider webhook routes, `tests/communications/{templates,delivery,otp}.test.ts`.

Interfaces: canonical immutable versions/artifacts; `compileEmail(version,variables)`; `sendDelivery(id)`; authenticated encrypted challenge API.

- [ ] Test unsafe HTML/URLs/variables, active-version safety, approval/DLT gating, provider errors and ambiguous timeouts, unsubscribe/caps, dry-run and OTP single-use/fallback; observe RED.
- [ ] Implement official/current provider contracts, direct Brevo HTML, Meta lifecycle, MSG91 DLT mapping, Lemlist sequence mapping and one challenge across fallback.
- [ ] Verify all provider interactions with controlled HTTP seams; do not send externally.

## Task 6: Offers and operations UI

Files: `lib/admin/offers.ts`, admin offer routes/migration, `components/{Communications,Offers,OperationsShell}/*`, scoped CSS, small existing dashboard navigation additions, `tests/admin/offers.test.ts`.

Interfaces: optimistic `version` mutation returning 409 on conflict; server-side `calculateCartQuote` simulations; authorized communications read/mutation APIs.

- [ ] Test role guards, stale edits, history immutability and server-engine simulation; observe RED.
- [ ] Implement accessible Rules/Runs/Templates/Deliveries/Providers/DLQ UI and Offers CRUD/test UI reflecting actual supported conditions/actions; preserve existing Overview.
- [ ] Verify typecheck/build and browser workflows with dry-run fixtures.

## Task 7: Review and handoff

- [ ] Run full typecheck, tests, build, supported lint and whitespace check.
- [ ] Review whole change with one fresh reviewer; repair evidenced defects and rerun affected checks.
- [ ] Finish audit and required documentation with migration/deployment/rollback order, exact external patches, environment and production risks. Report unperformed live checks accurately.

## Execution ledger

Approved continuation authorizes inline execution without another design/auth approval gate. Git is unavailable on PATH; no branch/commit/push operations are planned. Current workspace is the explicit user target. Dependencies installed from the lockfile; scoped dependencies added with approval.

7 October, repository execution verified: operator security, optional checkout identity, bounded ingestion/history, existing outbox bridge, incremental features, DSL/schedules/keysets, signed QStash, canonical templates/providers, encrypted OTP, Offers/versioning and both dashboard additions are implemented. Files were consolidated from the initial blueprint; the report maps the actual paths. Native MSG91/Lemlist callbacks, server-resolved transactional variables, timestamp/ID journey pagination, projection-only state backfill and transport DLQ bounds are included.

One independent reviewer completed a fresh review. Its seven evidenced findings were repaired with focused regressions. Additional callback authentication/correlation and WhatsApp STOP normalization regressions were reproduced and fixed. No repeated review agents were spawned.

| Repository verification | Observed result |
| --- | --- |
| npm run typecheck | Passed |
| npm test | 27 files / 142 tests passed |
| npm run build | Passed, with dummy build credentials |
| npm audit | Zero known vulnerabilities |
| Local migrations / performance | All historical/new SQL applied to disposable PGlite; 500,000-row features returned indexed bounded keyset pages |
| Local auth smoke | Root 307 to login; protected reads/unsigned consumer 401; anonymous WhatsApp mutation rejected |
| Whitespace | Git unavailable; verified Git-blob fallback found zero changed-line whitespace errors and preserved existing dashboard encoding |
| Lint | next lint prompted for an absent ESLint configuration; no configured lint result claimed |

The original RED/implementation/browser checklist above is retained as a planning record rather than fabricated command history. Full command results establish repository validation; live provider fixtures, authenticated browser acceptance, GTM/Framer publication and production plans remain separate rollout gates. Required documentation, migration/bootstrap/deployment/rollback order and explicit incomplete scope are in [the final report](../../UPPERMOST_COMMUNICATION_IMPLEMENTATION_REPORT.md). No production DDL, external send, provider configuration, deployment, commit or push occurred.
