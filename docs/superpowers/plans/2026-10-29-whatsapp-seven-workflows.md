# Seven WhatsApp workflows implementation plan

> Execute inline using executing-plans and test-driven-development. User approved
> the design and explicitly requested continuous local implementation; no further
> planning gate, commits, remote changes or deployments are authorized.

Goal: implement all seven workflows behind existing staging safeguards.
Spec: `../specs/2026-10-29-whatsapp-seven-workflows-design.md`.
Architecture: specialized intents reuse canonical messages, runs, deliveries and
outbox/QStash. Additive SQL is tested locally only; no remote migration applied.

Review focus: cross-order payment facts; duplicate scheduled recovery; stale
shipment milestones; consent withdrawal after queuing; activation releasing old work.

- [x] Write failing PGlite tests for durable intent eligibility, exact source facts,
  episode deduplication, cancellation, DRAFT cutoff and authenticated shipments.
- [x] Generate an ordered local migration with the installed CLI. Implement
  `comm_capture_whatsapp_workflows`, `comm_dispatch_whatsapp_workflows`,
  `comm_whatsapp_workflow_permission` and atomic `comm_ingest_shipment_event`.
- [x] Integrate bounded staging-only capture/dispatch and pre-send permission into
  `rules.ts`, `consumer.ts`, `delivery.ts` and the carrier webhook. Preserve the
  old Production branch and all provider safety guards.
- [x] Prepare local idempotent seven-workflow DRAFT configuration and tests; no
  remote template/rule changes. Add route and queue retry/zero-network coverage.
- [ ] Run focused and full tests, typecheck and dummy-credential build; independent
  read-only review. Record exact files, migration status and E2E blockers.

Ledger: baseline HEAD `0cd4aa140603dcd702f706049bb82c160fd02c06`, existing staging
workspace retained. New authorization restricts changes to local code/tests/docs.
Ruling: no Supabase/Vercel writes, even for DRAFTs or additive migrations. Draft
preparation is a local SQL artifact and disposable database test only.

Verification ledger: initial missing-feature tests RED; lifecycle/cutoff, missed
outbox recovery, late payment and cart-context regressions independently reproduced
RED then fixed. Latest full run: 339 tests / 46 files PASS; typecheck PASS; build
with dummy credentials PASS; diff whitespace check PASS. HEAD unchanged.

Ruling: recover only post-installation verified facts, not historical campaigns.
Prepared checkouts supply server-owned recovery cart lines without changing financial
records. Courier evidence may precede payment locally; retain the authenticated
milestone but hold all WhatsApp eligibility until capture is proven. Welcome uses
the persisted consent timestamp, not a late connector call, for activation cutoff.
