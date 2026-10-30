# WhatsApp staging handoff — 29 October 2026

**Later safety update:** the local code now makes explicit communication dry-run unconditional, including allowlisted recipients. Staging-specific allowlists have been cleared and Shiprocket has a code-level disable guard. See `STAGING_DEPLOYMENT_SAFETY_AUDIT.md`. The older running Preview has not been redeployed; earlier descriptions of allowlisted test sends below describe the prior implementation, not the new local safety policy.

## Exact completion boundary

Implementation is in this local workspace. Additive database migration and nine independent WhatsApp draft configurations were applied to **uppermost-staging**, project `jwsivyxapfnyaafdcdos` only. No production database, environment, deployment, provider configuration or customer message was changed.

The running Vercel staging application was verified at commit `c2fab28bf0d7a754ba45a341a87d55fcfe1d4997`, deployment `dpl_E9hVQUKyAMW7urkFd69yjXz2puV6`, alias `https://staging.uppermost.store`. **The new application patch has not been committed, pushed or deployed.** Staging SQL preparation alone does not enable the new application behavior.

No real provider sends, rule/template activation, Meta submissions, subscription changes or QStash schedule creation were performed. Real end-to-end delivery is therefore unproven.

## Implemented behavior

- Verified staging signups record a durable WhatsApp welcome intent instead of calling the legacy sender inline. Both `/api/lead` and `/api/launch-signup` support the persisted-lead path; their existing email/lead response contracts remain.
- One intent per normalized phone prevents repeated or concurrent signup welcomes. Shared identity locks protect overlaps with the existing signup/customer resolver. Conflicting email/phone identities fail closed without rewriting commerce customer fields.
- Pending intents remain recoverable while the dedicated welcome rule/template is DRAFT. Once explicitly activated, the bounded dispatcher uses the existing rule/run/customer-message/delivery/outbox pipeline. No second generic message ledger or provider call inside a database transaction was added.
- Canonical delivery rows retain `lead_id`; customer messages retain the source intent and lead. Provider message IDs and early callback replay use the existing acceptance function.
- The canonical WhatsApp sender fills the declared `name` body parameter in exact order/language. Authoritative customer data wins over campaign constants; blank names use `Uppermost Customer`.
- Responses distinguish `dry_run`, `skipped` and failures. A legacy dry-run result is no longer labelled sent. In verified staging, legacy/manual welcome requests cannot bypass the persisted-lead path.
- WhatsApp consent is independent of email permission. Launch signup no longer defaults WhatsApp permission from phone/email consent. The original lead endpoint's required email-consent form contract remains; its omission still returns the existing validation error.
- Explicit WhatsApp withdrawal updates channel permission. Delivery eligibility also checks the source welcome lead, so an already queued welcome stops after withdrawal. Repeated signup does not silently restore a denied preference.
- Signed STOP/unsubscribe text and button replies create a durable phone suppression even before a customer exists. Marketing sends and allowlisted marketing template tests check suppression. Transactional/authentication traffic is not subjected to marketing-consent checks.
- Authenticated status callbacks update canonical delivery state and legacy history monotonically. Malformed signatures return 401; persistence failures return retryable 503. Ambiguous provider outcomes remain reconciliation-pending and are not blindly resent.

## Files and reconciliation

Core changes: `lib/communications/whatsappWelcome.ts`, `delivery.ts`, `preferences.ts`, `rules.ts`, `variables.ts`, `webhooks.ts`; `lib/whatsapp/legacy.ts`; the two signup routes; focused WhatsApp and existing staging integration tests.

Before implementation, 33 files were reconciled from local base `0cd4aa140603dcd702f706049bb82c160fd02c06` to the exact deployed staging commit. Every affected file matched its base after newline normalization; no conflicting local edit was overwritten. Snapshots are under `.codex/whatsapp-backup`, reconciliation inventory under `.codex/whatsapp-reconciliation.json`. Existing staging email safety, QStash fixes, admin tests and earlier migrations were retained.

Git is unavailable on this machine. No Git reset, branch manipulation, commit, push or release occurred. A source review should distinguish the restored staging delta from the WhatsApp task changes; the plan records both.

## Applied schema and draft configuration

- Migration: `supabase/migrations/20261029113628_whatsapp_staging_welcome.sql`. Generated initially by CLI; the filename was aligned to the version assigned when MCP applied the exact SQL to staging. Historical migrations were not rerun.
- New tables: `communication_whatsapp_welcome_intents` and `communication_whatsapp_opt_outs`. Both have RLS enabled, no public/client table grants, and service-only RPC access.
- Canonical `message_deliveries.lead_id` and its correlation trigger are additive.
- Draft preparation: `supabase/manual/prepare_staging_whatsapp_drafts.sql`, with reviewable content/config in `docs/whatsapp-staging-drafts.json`. Disposable tests run the preparation twice to verify idempotency.
- Nine new WhatsApp rules: welcome, cart recovery, checkout recovery, order confirmation, payment failure, shipping update, delivery confirmation, product care and replenishment reminder. Every rule is DRAFT with `next_run_at = null`.
- The existing WhatsApp welcome draft is reused. Eight new WhatsApp content versions/provider mappings remain DRAFT; no approval was fabricated. Existing nine email rules were not modified.

Post-apply checks found 18 rules, all DRAFT, and no WhatsApp deliveries or new welcome intents. The new RPC/table access boundary was checked through catalogs. Existing staging advisor warnings remain unchanged: publicly executable legacy SECURITY DEFINER commerce RPCs, mutable search paths and password protection configuration need a separate scoped review before a broader rollout. They were not modified in this WhatsApp task. See Supabase's [function access guidance](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable). The new private tables' no-policy INFO notices are expected: clients have no grants and service access is intentional.

## Verification

- New tests exercised actual PostgreSQL semantics in disposable PGlite: concurrency, per-phone uniqueness, separate permissions, identity conflicts, STOP-before-customer, withdrawal after queuing, service privileges, canonical delivery correlation, early callbacks and repeated draft preparation.
- Application tests use controlled provider/database seams. They cover template parameters/language, missing names, accurate dry-run results, no inline legacy send, both signup routes, preservation of email suppression, signature rejection, STOP buttons, callback persistence failure, explicit provider rejection, throttling and ambiguous timeouts.
- Final full suite: `npm test` passed **41 test files / 278 tests**. `npm run typecheck` passed. `npm run build` passed under the dummy-credential verification wrapper.
- Production build evaluation used dummy credentials; `.env.local` was not edited. No provider fixtures contain real tokens or recipient identities.
- Lint cannot complete: this repository has no ESLint configuration and `npm run lint` opens the setup prompt. No configuration or dependency was installed for this unrelated issue.
- Git diff checks are unavailable; `node scripts/check-workspace.mjs` found zero changed-line whitespace findings and preserved Dashboard encoding.

## Remaining external steps, in order

1. Review and commit the patch on an isolated branch, then deploy the reviewed application to **staging only**. Current running staging is still the older commit. Do not promote it to production.
2. Confirm the actual Framer staging form target. The repository cannot prove which external form is published. Supported requests are unchanged: completed `/api/lead` uses explicit `consentWhatsApp`; launch signup accepts its existing explicit WhatsApp consent aliases. Missing WhatsApp permission never grants it. Check browser network traffic against staging, not production.
3. Verify whether staging shares a Meta app, WABA, sender and callback configuration with production. Do not replace an existing production webhook with the staging URL.
4. Verify token validity/expiry, permissions, sender readiness, exact WABA/template language and fresh provider approval. The welcome artifact was marked APPROVED in staging but lacked fresh synchronization timestamps; that stored state is not independent proof of current Meta status.
5. Review draft copy and samples, then separately authorize any Meta template submission. New drafts require provider approval and local activation before use. Current body-parameter sender supports the prepared text bodies; it is not a rich-media campaign builder.
6. Verify the intended callback `/api/whatsapp/webhook`, WABA/app subscriptions and message/template-status event delivery. Its verify-token and app-secret entries exist; no Meta account settings were changed.
7. Verify QStash signing keys, consumer reachability and the dispatcher schedule targeting `https://staging.uppermost.store/api/internal/cron/communications`. Keys exist and earlier email transport records show processing, but the actual minute schedule was not independently inspected. Schedule creation/enabling requires separate approval.
8. Keep `COMMUNICATION_DRY_RUN=true`, provider mutations disabled and a controlled test-phone allowlist. **An allowlisted recipient can receive a real message even in dry-run mode.** The old email-test exception does not authorize WhatsApp sends.
9. Separately authorize the selected template/rule activation and a bounded real WhatsApp test. Do not activate all nine campaigns together. Quiet hours currently suppress a marketing run rather than defer it; test at an allowed time.

## Authorized E2E acceptance checklist

Use one controlled, explicitly consenting staging recipient and a unique test identity. No step below was executed against a real provider in this task.

1. Submit an eligible completed signup through the actual staging form. Confirm one persisted lead, one welcome intent and independent WhatsApp consent evidence.
2. Repeat the request concurrently and through the other supported endpoint with the same normalized identity. Confirm one logical welcome, not a second provider send.
3. Confirm the server-resolved name and exact approved language arrive on the controlled phone; retain the canonical delivery/provider ID correlation without sharing raw PII or tokens.
4. Observe accepted → sent → delivered/read. Read receipts depend on recipient settings. Replay signed duplicate/out-of-order callbacks and verify no state regression or second send.
5. Verify a non-allowlisted recipient produces DRY_RUN and no provider call. Verify false/missing permission cannot produce a marketing send.
6. Queue a welcome, withdraw permission before delivery, and confirm suppression. Send STOP, confirm durable phone suppression, then resubmit and confirm it remains suppressed.
7. Exercise provider rejection/throttling and ambiguous timeout with controlled mocks or provider-approved test fixtures. Never retry an uncertain real send without reconciliation.

## Recovery and rollback

For a saved signup whose bridge returned `connection_failed`, an authorized operator can retry `comm_connect_whatsapp_welcome` with that persisted lead ID after repairing configuration/database access. It is idempotent and records intent only; do not backfill historical leads in bulk. Inspect pending intents and canonical delivery/outbox state rather than sending manually.

To halt automation, pause the dedicated WhatsApp rules and any explicitly enabled staging dispatcher schedule, retain dry-run true and clear test allowlists. Revert only this WhatsApp application patch to the reviewed compatible build; do not remove prior staging email safety.

Retain the additive tables, lead correlations, consent history, provider events and intents. Do not delete migrations, reset delivery status, remove STOP records or rerun debits. No destructive down-migration is required. Rolling back to the old legacy sender after real activation could reintroduce duplicate welcomes and incomplete tracking; keep the old path disabled while reconciling any uncertain work.
