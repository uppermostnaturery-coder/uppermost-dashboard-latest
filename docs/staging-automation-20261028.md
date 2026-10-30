# Staging automation support — 28 October 2026

This additive patch supplies the application support required by the nine saved DRAFT staging rule configurations: completed-signup events, EMAIL-only channel mappings, checkout/shipment date fields and whole-hour age operators. Existing event names, day operators, lane budgets, QStash publication fix and strict no-email safeguards are preserved.

Scope: GitHub staging branch and Preview deployment for staging.uppermost.store. Production and main are outside this rollout. All nine rules and canonical template versions remain DRAFT; next_run_at stays null. No rules are activated and no email is sent by publishing this patch.

## Source and database relationship

The accompanying timing migration 20261028054906 was already applied to staging. Its source is included for migration history and local database tests. Do not reapply it or resave/overwrite the nine version-2 rules merely to publish this application patch. Other environments need their own explicitly authorized migration review.

docs/staging-automation-rules.json is a staging-only fixture and review reference, not activation-ready content and not a deployment script. It describes cart/checkout eligibility after one hour, care after one day and replenishment after thirty days. Care/replenishment currently use the latest shipment-update timestamp; immutable delivered-at semantics and lifecycle correlation remain separate work.

## Scheduling

The existing signed staging QStash dispatcher wakes every five minutes. The four scheduled rule fixtures poll every fifteen minutes. One-hour eligibility does not guarantee inbox delivery exactly sixty minutes after activity. Repository Vercel cron settings are unchanged.

## Remaining email readiness work

- Complete and validate customer-owned cart/checkout/payment/order/tracking URLs, shop/care URLs and company address. Existing rule constants are empty.
- Reconcile canonical template readiness/content with the already-active Brevo provider templates #18–#26.
- Keep stagingEmailSafety, lead/contact suppression and all provider no-send checks unchanged. A test-email allowlist cannot override the staging hard stop.
- Any future real-email test requires a separately reviewed recipient-restricted sending path and explicit authorization. This patch does not introduce one.
- Before enabling real lifecycle rules, verify duplicate/out-of-order events, cancellation/recovered-purchase suppression, per-order/per-shipment correlation and send-time eligibility. A weekly cap is not an exactly-once lifecycle guarantee.

## Verification and rollback

Local regression tests cover schema compatibility, DRAFT fixtures, intended positive/negative conditions, hour boundaries and database timing projection. Full suite/typecheck/build and exact remote artifact checks are required before declaring the rollout complete. These checks do not establish live inbox or Brevo callback delivery.

For code rollback, restore only this patch's changed paths from the pre-rollout staging head in a new staging commit, preserving the earlier QStash fix. Verify the reverted Preview and staging alias. No database/rule rollback is required for this code-only publication. Keep all nine rules DRAFT; never force-push main or reset completed jobs.
