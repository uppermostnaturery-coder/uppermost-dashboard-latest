# Staging Welcome signup bridge implementation plan

> For agentic workers: use superpowers:executing-plans task by task. User approved implementation and staging-only verification in the current chat.

Goal: connect completed signup to a real customer, consent and one durable Welcome event without sending email.
Architecture: preserve existing lead save; server-gated transactional RPC resolves identity, records consent and one welcome intent/outbox event. No queue dispatch or rule activation.
Tech stack: Next.js, TypeScript, Supabase Postgres, Vitest and PGlite.
Spec: ./2026-10-27-welcome-bridge-design.md

## Global constraints
- Only staging branch/project jwsivyxapfnyaafdcdos. Production untouched.
- All nine rules/templates remain DRAFT; Brevo #18 unchanged.
- No email, contact sync, enrollment, queue dispatch or historical backfill.
- Preserve opt-outs, existing commerce identity, WhatsApp behavior and response compatibility.
- Dashboard crash changes excluded.

## Review focus
- Simultaneous email/phone identity collision must stop, without overwriting customer fields.
- Completion and consent are read from persisted server-owned context, never browser customer IDs.
- Retry cannot duplicate a logical Welcome event, even if a rule version changes.
- Bridge failure cannot fall back to the legacy email sender.
- Provider suppression must hold for allowlisted destinations and invalid staging configuration.

## Task 1: no-send prerequisite
- [x] Copy only the reviewed local safety runtime files and their two regression test files into this clean staging checkout.
- [x] Run focused safety tests, inspect exact diff; no dependency changes.

## Task 2: transactional bridge and route wiring
- [x] Add failing SQL tests with a realistic legacy um_leads fixture: eligible/incomplete/no-consent/opt-out, reuse, conflicts, retries, event rollback and privileges.
- [x] Generate ordered migration using installed Supabase CLI. Add lead/customer linkage plus a unique logical welcome intent and an invoker RPC comm_connect_lead_welcome(p_lead_id uuid).
- [x] Transaction validates persisted completion/consent, locks identities, preserves existing customer attributes and opt-outs, inserts one intent and outbox event atomically. No client data payload and no sending.
- [x] Add staging-gated TypeScript helper; call after lead save, return truthful integration status and never invoke direct welcome on the staging-owned path.
- [x] Add route/helper tests for staging, production unchanged, failure, no consent/incomplete, malicious metadata and zero provider calls. Extend local SQL fixture for new migration prerequisites.
- [x] Run focused tests RED then GREEN, full suite, typecheck and build with dummy configuration and blocked outbound fetch.

## Task 3: review, staging application and verification
- [ ] Independent whole-patch review; resolve actionable issues and rerun affected checks.
- [ ] Verify current branch head and all nine DRAFT rows. Apply migration only to staging after local verification. Check grants/RLS and advisors.
- [ ] Commit/push only the approved staging patch. Verify Preview deployment targets staging and deployed source SHA.
- [ ] Verify synthetic eligible signup linkage/idempotency in a rolled-back staging transaction, no dispatcher/provider calls, baseline rule rows unchanged.
- [ ] Save report with exact test/build/deployment evidence and remaining blockers. Do not claim deployed success if access blocks application.
