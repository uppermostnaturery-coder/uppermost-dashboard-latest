# Uppermost Commerce Documentation Map

Use this file to choose the correct source before changing or integrating commerce behavior.

## Authority order

1. `UPPERMOST_COMMERCE_ARCHITECTURE.md` — frozen architecture and business/state-machine source of truth. Update this first before any architecture-level behavior change.
2. Actual route, service, schema, migration, and test code — source of truth for currently deployed implementation details. If implementation differs from the frozen architecture, stop, document the drift, and reconcile intentionally.
3. `FRAMER_COMMERCE_CONTRACT.md` and `FRAMER_COMMERCE_TYPES.ts` — exact browser-safe request, response, error, polling, and type contract for Framer.
4. `UPPERMOST_COMMERCE_CONTRACT.md` — concise API and platform contract overview.
5. `RAZORPAY_LIVE_RUNBOOK.md` — deployment, webhook, renewal, recovery, and production-validation operations.

## Critical reading path for a human or AI

Before commerce work:

1. Read `UPPERMOST_COMMERCE_ARCHITECTURE.md` completely.
2. Read `AGENTS.md` at the repository root.
3. Read the relevant public contract and route/service/tests for the requested area.
4. For payments or renewals, also read `RAZORPAY_LIVE_RUNBOOK.md` and the current migrations.
5. Keep all monetary values in integer paise and all provider secrets/tokens server-side.
6. Do not infer state from browser callbacks, token-ID presence, or UI state. Use persisted, verified provider evidence and the centralized state machines.
7. Treat sections labelled future scope as unimplemented. Never silently promote them to current behavior.

## Razorpay activation invariant

Initial recurring activation requires both a strictly validated captured `RECURRING_AUTH` payment and the exactly correlated recurring mandate in `ACTIVE` with a bound provider token. Mandate confirmation can arrive in a standalone `token.confirmed` event or as an embedded token with `recurring = true` and `recurring_details.status = confirmed` in a signed capture/verified provider fetch. A token ID alone never activates. Arrival order and duplicate delivery must converge without moving billing dates twice or creating duplicate cycles.

## Document formats

The Markdown architecture file is canonical and current. `architecture/UPPERMOST_COMMERCE_ARCHITECTURE.docx` is a historical 24 September 2026 presentation snapshot (version 1.0); it is not maintained as an implementation contract and must not override the Markdown architecture, current contracts, migrations, or code. Regenerate and review that presentation artifact before distributing it as current architecture.

## Current migration note

As confirmed by the operator on 5 October 2026, `20261005090000_harden_razorpay_recurring_architecture.sql` has already been applied to the target environment. The embedded confirmed-token activation reconciliation is code-only and adds no migration. Verify migration history rather than rerunning a migration solely for that fix.
