# Communication implementation audit

7 October 2026, Asia/Kolkata. Repository code, all migration files and read-only live catalogs were inspected. The initial admin-security stop condition was reported and resolved by the user's approved [continuation](UPPERMOST_COMMUNICATION_SPEC.md). This is a repository implementation audit, not a production deployment claim.

| Area | Starting state and decision |
| --- | --- |
| Synchronous communication | `/api/lead` awaited Lemlist, Brevo contacts/welcome and internal public WhatsApp. Commerce createCustomerMessage persisted IN_APP only. Commerce still has no communication-provider call. Lead retains its compatibility path with internal server WhatsApp and explicit dry-run gates. |
| Message tables | Live message_templates/customer_messages/message_deliveries/whatsapp_messages/brevo_email_events exist. customer_messages has no template FK. Reuse messages/deliveries and add canonical child versions/artifacts. |
| Outbox | Live integration_outbox/integration_failures were absent from migration history and unused: zero rows, no producers/triggers/RPCs. Reconcile and reuse integration_outbox, preserving provider/operation/aggregate/idempotency/lowercase statuses. No second generic ledger. |
| Analytics | Public policies were broad despite RLS. Sessions have both is_online/is_active and device/browser/OS/time_zone, geo and attribution columns. The GTM workspace source was read without saving. Preserve dimensions/offline state; anonymous lockdown stays separate until publication. |
| Checkout customer resolution | Existing findCustomerIdentity then resolveOrCreateCustomer remain. Header context links after the single resolution with a bounded best-effort RPC. Parsed input and requestHash are unchanged. |
| Promotions | Promotions/entitlements/calculateCartQuote remain authoritative. Add optimistic admin edits and immutable promotion_versions; scheduling derives from validity/status. Usage/order snapshots remain commerce-owned. |
| Cron | Renewal stays daily at 0 0 * * *. Add one daily communication safety dispatcher and one optional signed QStash minute schedule. No per-rule cron/permanent worker. |
| Admin security | Initial dashboard/provider analytics/WhatsApp lacked operator auth; Auth had zero users/no memberships. Verified Auth and server-owned ADMIN/VIEWER now guard those routes. Customer tokens/editable metadata cannot grant admin access. Bootstrap is manual. |
| Providers | Preserve Brevo/Meta/Lemlist; add official QStash, direct HTML, Meta approval, MSG91 DLT mapping and Lemlist sequence mapping. Native callbacks use MSG91 configured headers and Lemlist body secrets with immutable campaign/step correlation; account fixtures remain unverified. |
| Compatibility risks | Preserve commerce routes/body/hash/money/idempotency/state machines and lead body/response shape. Admin protection intentionally removes public access. Framework major upgrades need staging smoke tests despite passing local checks. |

The frozen architecture, commerce/Framer contracts, Razorpay runbook, WhatsApp process, checkout/customer/pricing/promotions/messages/payment/subscription/renewal/fulfillment services, provider routes/webhooks, dashboard analytics and Vercel configuration were inspected. Current code/catalogs took precedence over stale docs. Live queries inspected schema/policies/indexes/aggregate counts; no customer rows, DDL or sends.

Commerce/lead/consent/message tables were RLS-enabled and server-only. New operator SELECT policies alone do not remove old public analytics exposure; the manual lockdown is essential after GTM rollout. New identity/communication/rule/history state and RPCs are server-only.

No verified-contact columns were found in lead/customer schemas. Do not call checkout-entered contact values verified or guess lead/customer matches. consent_records remains intact; recurring mandate consent is not marketing permission. Canonical marketing preferences fail closed until trustworthy evidence is recorded.

Live whatsapp_messages permits queued/sent/delivered/read/failed. The additive migration preserves those values and adds DRY_RUN for the explicit legacy gate.

One independent review found audience OR scope leakage, shared-device aggregate leakage, lost early callbacks, stuck OTP claims, Lemlist personalization/version issues and dropped dimensions. Disposable SQL/HTTP regression checks reproduced and verified repairs. All historical/new migrations are exercised locally; none was applied to production. Current validation, file inventory, rollout and gaps are in the [implementation report](UPPERMOST_COMMUNICATION_IMPLEMENTATION_REPORT.md). Git is unavailable. No commit/push/deployment/provider template creation/GTM publication was performed.
