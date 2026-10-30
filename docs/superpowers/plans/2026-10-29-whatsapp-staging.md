# WhatsApp staging implementation plan

**Goal:** Complete the staged WhatsApp signup, consent and delivery path without changing commerce or existing email behavior.

**Spec:** User attachment supplied 29 October 2026; execution and local checks authorized. External sends, activation, provider mutations and schedules remain separately gated.

**Architecture:** Retain the communications engine and legacy history. Add a staging-only durable WhatsApp welcome intent which resolves validated persisted leads, explicit consent and approved template mappings, and produces one canonical delivery. Use existing SEND processing and provider callback replay. Legacy history receives compatible callback updates; new signup paths no longer race two senders. Outside verified staging retain existing route ownership.

## Constraints and decisions
- Verified staging project: jwsivyxapfnyaafdcdos; deployed c2fab28bf0d7a754ba45a341a87d55fcfe1d4997 at staging.uppermost.store.
- Preserve local files with snapshots and base/blob comparison. Git executable unavailable; no branch manipulation, commits, pushes or releases.
- No credentials copied into tests or snapshots. No runtime sends during verification.
- Stage additive migration only after disposable database validation and target recheck; draft rules only, no schedules/activation.
- Existing opt-outs win over repeated signup; durable phone suppression also covers STOP before a customer exists.
- Uncertain provider outcomes remain reconciliation-pending, never blindly resent.

## Review focus
Missing names use a deliberate safe display fallback. Phone/customer conflicts fail closed. Existing email opt-out cannot block independent WhatsApp consent. Repeated requests must share one logical welcome. Early callbacks, timeouts and persisted failures must not silently lose or duplicate sends.

## Tasks
- [x] 1. Reconcile exact staging delta against local base, preserving local edits; baseline tests.
- [x] 2. RED/GREEN database tests: consent, phone STOP, concurrent welcome uniqueness, template/lead correlation and callback replay. Add ordered service-only migration and DRAFT rule preparation.
- [x] 3. RED/GREEN application tests: validated staging ownership for both signup routes, truthful outcomes, variables, no legacy double-send, safe provider failures and callback compatibility.
- [x] 4. Run focused/full tests, typecheck/build/lint; independent review; stage migration/config only where isolation is proven. Write operations, rollback and authorized E2E checklist with exact unverified steps.

## Execution ledger
2026-10-29: Request read in full. No external mutations or sends. Source reconciliation in progress.

2026-10-29: Reconciled 33 files against exact 0cd4aa1 base and c2fab28 staging blobs. All matched base after newline normalization; prior versions saved under .codex/whatsapp-backup. No local conflicts or resets.

Ruling: Use one dedicated WhatsApp intent per normalized phone and the existing rule/run/message/delivery pipeline. Hold pending intents while the dedicated welcome rule/template is inactive; never consume an event before its draft rule is enabled. No inline provider calls from signup.

Ruling: Preserve the existing lead form's email-consent validation contract. WhatsApp permission remains a separate database channel and is never inferred from that required field.

2026-10-29: Independent reviewer identified consent withdrawal after QUEUED; reproduced with failing SQL/route tests, then fixed explicit withdrawal synchronization and source-consent send-time checks. Follow-up review found no remaining important issue.

2026-10-29: Applied additive migration only to jwsivyxapfnyaafdcdos. MCP assigned version 20261029113628; local filename aligned without modifying SQL. Nine separate WhatsApp rules and eight new template drafts prepared; existing welcome draft reused. All 18 rules remain DRAFT, zero WhatsApp sends/intent rows. No deployment/provider subscription/schedule changes.

2026-10-29: Full test suite passed 41 files/278 tests. Final typecheck found an unknown-row type in a new test; added the explicit query row type. Reverification pending. Earlier dummy-credential production build passed. Lint requests setup and is not configured.

2026-10-29 final verification: repeated bare npm test passed 41 files / 278 tests; npm run typecheck passed; npm run build passed under dummy credentials. No provider calls, deployment, production changes or automation activation. Handoff: docs/WHATSAPP_STAGING_HANDOFF.md. New staging tables' RLS/client denial verified. Existing security advisor WARN counts unchanged; documented separately rather than changing unrelated commerce privileges.
