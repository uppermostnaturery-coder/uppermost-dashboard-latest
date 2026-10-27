# Welcome signup bridge implementation ledger

- Approved scope: completed /api/lead signup -> customer -> EMAIL/MARKETING consent -> one logical Welcome event. Staging only, all rules/templates DRAFT, zero provider calls and no historical backfill.
- Base: staging 0cd4aa140603dcd702f706049bb82c160fd02c06.
- Task 1 complete: strict staging no-send prerequisite, 24 focused tests RED -> GREEN; no dependencies changed.
- Task 2 complete: database bridge initially 10 failures (missing function), now 12 passing SQL tests; helper/route/no-send checks 34 passing. Final suite 31 files / 188 tests passed using npm test -- --maxWorkers=2. Typecheck and local Next build passed with dummy configuration and outbound fetch blocked.
- Initial default-concurrency run: one admin endpoint test exceeded its existing 5-second timeout; isolated rerun and complete lower-concurrency rerun passed. No timeout/test configuration changed.
- Independent review: no Critical/Important runtime defects; duplicate consent audit entry found. Regraded as important for audit fidelity, reproduced with the existing real audit trigger, removed redundant insert, regression RED -> GREEN. No deferred code findings.
- Ruling: database lifecycle tables remain service-only (RLS enabled, no browser policies). Supabase reports INFO/no-policy on them, consistent with the existing architecture; adding browser policies would expose internal state.
- Ruling: deterministic contact matching does not establish verified possession; no VERIFIED status or commerce identity fields are changed.
- Ruling: tests establish retry idempotency; the local PGlite concurrent Promise.all calls do not prove independent-session contention. Durable uniqueness/advisory locks reviewed; no independent-session live concurrency claim.
- Staging migration staging_welcome_signup_bridge applied successfully to jwsivyxapfnyaafdcdos only.
- Staging service_role transaction: completed synthetic signup -> connected; repeated call -> already_connected; exactly one intent, event and consent-history record. Transaction rolled back. Customers remain 1; links/intents 0; pre-existing outbox count 1; synthetic lead count 0; non-DRAFT rules 0. No dispatcher, consumer, provider or live form submission invoked.
- Live RPC is SECURITY INVOKER; anon/authenticated EXECUTE denied, service_role allowed. Existing service-role read/write and normalized identity unique indexes verified.
- Dashboard crash patch excluded; existing Brevo template #18 and all nine rules unchanged.
- Deployment verification pending at this commit; final task report records the deployed SHA and result.
