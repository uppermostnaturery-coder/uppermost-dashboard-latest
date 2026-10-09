# Communication V1 implementation report

7 October 2026. Repository implementation is reviewable in the current workspace. Nothing was deployed, migrated in production, broadcast, submitted to Meta, synchronized to Lemlist, or published in GTM/Framer. This report distinguishes implemented behavior from production gates and remaining specification gaps.

## 1. Repository audit

The [audit](UPPERMOST_COMMUNICATION_AUDIT.md) covers the frozen architecture, contracts, all migrations, checkout/customer resolution, commerce/provider routes, message/analytics tables, promotions, cron, RLS and live schema drift. Read-only Supabase catalogs and aggregate counts took precedence over stale documents. No customer rows were extracted. The unused live `integration_outbox` was reused. The missing admin-authorization prerequisite was resolved by the user's approved continuation.

## 2. Security implementation

Verified Supabase Auth sessions plus server-owned `admin_memberships` gate the dashboard, provider analytics and new admin APIs. ADMIN can mutate; VIEWER can inspect. Guest/customer commerce tokens and editable user metadata cannot grant operator access. Mutations require the dashboard's Origin. Communication/identity tables and RPCs are service-only; existing commerce RLS remains. Public lead/checkout and authenticated provider webhooks retain their intended contracts. Dashboard/provider reads are intentionally no longer public.

## 3. Admin bootstrap — manual

In staging first, configure Supabase Auth's dashboard site/redirect URLs and disable public operator signup. Create/invite a real operator through trusted Auth administration, establish its login, then use the resulting Auth user UUID in trusted SQL:

```sql
insert into public.admin_memberships(user_id,role,active)
values ('REPLACE_WITH_AUTH_USER_UUID'::uuid,'ADMIN',true)
on conflict(user_id) do update set role=excluded.role,active=true,updated_at=now();
```

Use VIEWER for read-only staff. Never seed memberships through browser user metadata or a public route. Verify login/logout, expired-session refresh, nonmember denial, VIEWER read/write denial and ADMIN mutations before production rollout. No account or membership was created during implementation.

## 4. Analytics architecture before/after

Before: the tracker wrote directly to Supabase with broad anonymous analytics policies. After the approved continuation: validated `/api/analytics/ingest` persists bounded batches with service credentials, preserves actual device/geo/attribution/offline fields and updates compact behavior state. Browser-supplied customer IDs are rejected. Origin allowlists, 32-KB UTF-8 request bounds, 50 events, 4-KB metadata, depth/width limits and a soft IP rate limit constrain input. Origin and browser IDs are observations, not authentication; distributed abuse controls remain a rollout consideration.

Anonymous permission lockdown is a **separate manual SQL step after GTM publication and healthy ingestion**. Deploying the additive migrations alone does not remove existing public analytics exposure.

## 5–8. GTM, GA4, Clarity and Framer handoff

The existing GTM Custom Tracker source was read without saving or publishing; its seven existing workspace changes were left intact. [Exact GTM instructions](UPPERMOST_GTM_ANALYTICS.md) identify the insertion point and provide the tested [drop-in patch](integrations/gtm-communications-patch.js). It retains the current IDs, UUID fallback, inactivity behavior, callers, technical dimensions and online/offline state. Replace its dashboard-origin placeholder before GTM Preview. Private metadata/button text and URL queries are omitted.

[GA4/Clarity instructions](UPPERMOST_CLARITY_GA4_INTEGRATION.md) preserve independent tags/destinations and use only visitor/session identity for Clarity. No contact data or customer UUID is exposed. Their external DebugView/session checks remain manual.

[Exact CheckoutDrawer changes](UPPERMOST_FRAMER_INTEGRATION.md) add the GTM/localStorage accessor and two optional headers. Deploy the CORS change before publishing Framer. Checkout JSON, quote handling and the Idempotency-Key stay unchanged. No external UI/tag publication occurred.

## 9–10. Checkout compatibility and identity graph

`POST /api/checkout/prepare` remains present. Analytics context is outside its schema, request hash, quote fingerprint, pricing and payment decisions. The existing customer resolver runs once; linking follows resolution and has a 750-ms abort deadline. A linker failure logs a safe warning and cannot fail checkout. Quote/payment/renewal state machines are untouched by communication rules.

`analytics_identity_links` has one current mapping per visitor, many visitors per customer and preserved historical intervals. A short browser-scoped advisory lock serializes shared-device transitions. Old behavior clears on customer change; delayed pre-link events do not update the new customer's features. Checkout links are IDENTIFIED, not VERIFIED. No fuzzy lead matching or verified-contact inference is introduced. The support journey uses scoped link intervals and 50-row timestamp/ID pagination.

## 11–12. Read models, performance and outbox decision

Rules query `communication_customer_features`, not raw orders/payments/subscriptions/analytics joins. Idempotent receipts increment order/spend/product facts. A small subscription projection supplies each customer's active counts/dates; payment/shipment timestamps reject stale changes. Ingest incrementally maintains visitor behavior and identified cart/product/last-seen state. Marketing reservations provide indexed rolling caps.

Exception-isolated AFTER bridges persist narrow event facts into the existing `integration_outbox`. Normal capture is transaction-local, but a failed downstream write cannot veto commerce; bounded recovery is required for that intentional tradeoff. Order facts read only that order's indexed items. There is no permanent worker or second generic message ledger.

Hard bounds: 20 due/event rules, 500 audience rows, 50 recipient/retry/outbox rows, 100 preview/recovery rows, ten-second publication budget, provider HTTP timeout and SQL query budgets. Keysets replace OFFSET. Manual recovery uses durable cursors for orders/subscriptions/payments/shipments and projection-only events, so historical backfill cannot launch old campaigns. Corrections/refunds and lost message intents need separate reconciliation.

## 13–15. QStash, rules and scheduling

Official `@upstash/qstash` publishing and signature verification use IDs-only bodies. Supabase is durable authority; queue redelivery cannot reserve the same provider attempt twice. REALTIME subject work and operational sends are prioritized over BULK campaigns, with provider/lane flow-control budgets. Publication/delivery retries persist locally. Twenty transport claims quarantine exhausted work for operator inspection/replay; five explicit delivery retries precede permanent failure. Ambiguous provider calls require reconciliation rather than blind resend.

The typed JSON DSL whitelists read-model fields/operators and bounded all/any/none groups. Entire predicates are scoped inside customer/cursor constraints. Rule/run versions snapshot configuration, with compare-and-set scheduling and unique run keys. Friendly presets plus advanced cron show five future timezone-aware runs. Rules decide audience/channel/content only; offer eligibility remains pricing-owned.

One `/api/internal/cron/communications` dispatcher is separate from the unchanged renewal cron. Its GET verifies CRON_SECRET; POST verifies QStash. Vercel supplies daily safety dispatch. Configure **one signed minute QStash schedule manually** using the snippet in the [engine guide](UPPERMOST_COMMUNICATION_ENGINE.md). Without it, real-time events can wait for daily dispatch. No schedule was created during implementation.

## 16–17. Templates and providers

Canonical logical templates have immutable versions and provider artifacts; legacy messages/deliveries remain the ledger. HTML paste/upload, sanitized desktop/mobile/plain-text previews, assets/variables, poster links and allowlisted tests are implemented. Campaign constants cannot override server-resolved message/order/payment/subscription facts. Missing correlated variables fail safely. Assets are external references; no binary storage uploader or drag/drop builder is included.

Brevo sends direct canonical HTML, optionally using a provider template. Meta submission/status webhook/API refresh and approval gates preserve the previous active version while its successor waits. Admins cannot fabricate Meta approval. SMS requires externally approved DLT IDs and ready MSG91 mapping. Lemlist remains marketing/nurture, maps campaign/sequence/step, rejects running-campaign edits, preserves placeholders and requires a distinct campaign per immutable version. Provider mutation controls default off. See the [template guide](UPPERMOST_COMMUNICATION_TEMPLATES.md).

Native MSG91 callbacks authenticate the configured header and map request IDs/status codes with timezone-aware timestamps. Native Lemlist callbacks verify the provider's echoed body secret, deduplicate activity IDs and correlate lead/campaign/stable step to the immutable artifact, including early-callback replay. Normalized callbacks remain supported. Persistence failures return 503 for retry. [Manual configuration and primary sources](UPPERMOST_COMMUNICATION_TEMPLATES.md) are documented; account fixture validation remains pending. Preserve existing Brevo/WhatsApp webhook settings until additions are tested.

## 18. OTP and consent

One secure six-digit challenge stores only HMAC hash and authenticated encrypted ciphertext; transport receives its ID. Five-minute expiry, five verification attempts, single use, one-minute cooldown and IP/identity limits apply. Fallback uses WhatsApp → SMS → email with the same challenge. Pre-provider crashes can recover; ambiguous provider attempts quarantine. VERIFY returns a verification result, not customer/admin login credentials. Delayed failure-webhook fallback, verified identity upgrades and a customer session exchange remain unimplemented.

Marketing permissions fail closed until trusted evidence is recorded. Providers has an ADMIN evidence form; preference history is immutable. Existing consent history remains. Recurring consent is not marketing permission. Brevo/Lemlist unsubscribe and WhatsApp STOP suppress marketing. Quiet-hour messages are suppressed for that run rather than deferred.

New-engine dry-run defaults safe. **Explicit `COMMUNICATION_DRY_RUN=true` also gates legacy lead Brevo/contact/welcome, Lemlist enrollment and WhatsApp welcome for non-allowlisted destinations.** An unset value preserves those legacy behaviors. Always set true in staging; allowlisted destinations can still receive test messages. No provider call was made during implementation.

## 19–20. Communications and Offers dashboards

Communications adds Overview, Rules, Runs, Templates, Deliveries, Providers and DLQ. Rule actions, bounded previews, dry runs, template lifecycle, provider observations, consent evidence, recovery controls and a merged customer journey are available to authorized operators. Metrics are explicitly bounded recent samples, not complete historical/billing analytics. Transport DLQ and ambiguous deliveries have separate safe controls. Existing Overview receives only navigation additions.

Offers manages the existing PromotionConditions/PromotionActions and supports create/edit/clone/pause/resume/archive, validity filters, history and server-side simulation. Stale writes return 409 PROMOTION_VERSION_CONFLICT. Existing usage counters and order snapshots remain commerce-owned. Simulation calls calculateCartQuote; it does not mutate orders or compute prices in the browser. Its synthetic shipping/entitlement inputs do not replace a fully authorized real checkout quote.

The requested design references informed dense tables, status semantics, form hierarchy, responsive scrolling, keyboard focus and restrained styling. Authenticated visual/workflow acceptance still requires staging operator accounts; local browser inspection only verified the anonymous login boundary.

## 21. Migrations and changed files

Apply only the three new forward migrations, in this order, after checking deployed historical migration state and live catalog compatibility:

1. `20261007092356_communications_security_identity.sql` — memberships/operator policies, identity history, ingest and behavior projection.
2. `20261007092407_communications_engine.sql` — additive existing outbox/message fields, features, templates/artifacts, rules/runs/recipients, preferences, OTP, delivery/callback claims, recovery and service-only access.
3. `20261007092414_promotion_version_history.sql` — immutable offer snapshots and optimistic mutation RPC.

Then, **after GTM rollout only**, apply `supabase/manual/analytics_lockdown_after_gtm_rollout.sql`. No historical migration was edited by this implementation. All historical/new migrations execute against a disposable local fixture; that does not prove production schema compatibility.

Session file inventory:

| Area | Files |
| --- | --- |
| Auth/security | `lib/admin/{auth,policy}.ts`, `middleware.ts`, `app/login/*`, `app/page.tsx`, `lib/supabase.ts`; guards in Brevo status, Lemlist analytics, Meta ads and WhatsApp send routes |
| Checkout/analytics | checkout prepare route, `lib/commerce/{checkout,http}.ts`, `lib/analytics/{identity,schema}.ts`, analytics ingest and admin journey routes |
| Runtime | `lib/communications/*`, `lib/communications/providers/*`, communication OTP/webhooks, internal consumer/cron routes |
| Admin/services/UI | `lib/admin/{communications,offers,offersSchema}.ts`, admin communications/offers routes, `components/operations/*`, limited `components/Dashboard.tsx` navigation |
| Compatibility | lead route, `lib/whatsapp/legacy.ts`, existing WhatsApp webhook and Brevo client/contacts/webhook bridges |
| Database/tests | three migrations, gated manual SQL, `tests/admin/*`, `tests/analytics/*`, `tests/communications/*` |
| Build/docs | package/lockfile, `.env.local.example`, `.gitignore`, `vercel.json`, Next generated type reference, documentation map/architecture/plan/guides, saved query plan, `scripts/check-workspace.mjs` |

The workspace already contained many commerce/payment/renewal files and migrations before this task. A Git-index comparison lists those too; it is **not** an attribution of all worktree changes to this session. Git is unavailable, so no commit, branch switch, reset or push was attempted. The whitespace fallback reads verified Git blobs without mutating repository metadata.

## 22–23. Query plans and validation

The disposable PGlite database applies all migrations and tests 500,000 synthetic features with 500-row keyset pages. [EXPLAIN ANALYZE artifact](communication-query-plan.json) shows an index scan on the derived model, without order/analytics scans. Timings vary with local WASM execution and concurrent test/build load; they are not production benchmarks. Staging must verify representative selective predicates, row estimates, timeout enforcement and actual index/statistics distribution.

Final command results are recorded in the execution ledger below. Coverage includes commerce pricing/quotes/idempotency/payment/webhook/renewal tests; operator guards; optional checkout identity/hash equivalence and failure isolation; GTM accessor/transport behavior; shared-device history; projection dedupe; bounded recovery; 500k keysets; cron dedupe; immutable templates/offers; early callbacks; HTML/variables/DLT gates; ambiguous HTTP outcomes; OTP leases/single-use; dry-run legacy gates; and scoped timestamp/ID journey pagination. Provider HTTP checks use controlled seams. Live account acceptance tests were not performed.

Next was upgraded to 15.5.25 and React to 19.3.0 after dependency audit identified unresolved critical advisories on the older framework line. SSR/async request APIs were adapted. Pinned QStash/cron/sanitizer/PGlite dependencies and the PostCSS override are in the lockfile. This framework change increases staging smoke-test scope despite passing local checks.

## 24. Environment

[`.env.local.example`](../.env.local.example) contains placeholders and is explicitly permitted by gitignore. Keep actual secrets in server-side deployment configuration.

| Purpose | Variables |
| --- | --- |
| Existing authority/Auth | NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, COMMERCE_TOKEN_PEPPER, COMMERCE_ALLOWED_ORIGINS, CRON_SECRET/COMMERCE_CRON_SECRET; existing Razorpay/Shiprocket/Shopify settings |
| QStash | QSTASH_TOKEN, QSTASH_CURRENT_SIGNING_KEY, QSTASH_NEXT_SIGNING_KEY, COMMUNICATION_BASE_URL |
| Launch controls | COMMUNICATION_DRY_RUN=true, COMMUNICATION_ALLOWED_TEST_EMAILS, COMMUNICATION_ALLOWED_TEST_PHONES, COMMUNICATION_PROVIDER_MUTATIONS_ENABLED=false |
| Brevo | BREVO_API_KEY, COMMUNICATION_EMAIL_FROM, existing BREVO_WEBHOOK_TOKEN/list/welcome settings |
| Meta | WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_BUSINESS_ACCOUNT_ID, WHATSAPP_API_VERSION, WHATSAPP_APP_SECRET, WHATSAPP_WEBHOOK_VERIFY_TOKEN; preserve legacy welcome/language and ads settings |
| SMS/Lemlist | MSG91_AUTH_KEY, MSG91_COMMUNICATION_WEBHOOK_TOKEN, LEMLIST_API_KEY, LEMLIST_COMMUNICATION_WEBHOOK_TOKEN |
| OTP | OTP_ENCRYPTION_KEY (random base64 32-byte key), OTP_TTL_SECONDS, OTP_WHATSAPP_TEMPLATE_VERSION, OTP_SMS_TEMPLATE_VERSION, OTP_EMAIL_TEMPLATE_VERSION |

Do not rotate OTP encryption keys while unexpired challenges still depend on them without a coordinated expiry plan. Test allowlists intentionally permit external sends; populate them only with controlled addresses/numbers.

## 25–26. Manual setup and deployment order

1. Review this patch against the preexisting workspace changes. Restore Git tooling and make a deliberate reviewed commit; no automatic deployment occurred.
2. Reconcile live migration history and catalog drift in staging. Check existing status/duplicate data before constraints. Measure index creation on analytics_events; these transactional migration files do not use CONCURRENTLY. For large production tables, prepare an operator-reviewed nontransactional concurrent index rollout and matching migration adjustments before deployment. Do not rerun historical migrations.
3. Apply the three new migrations in staging, bootstrap ADMIN/VIEWER and deploy with explicit dry-run true/provider mutations false. Smoke-test commerce quote/prepare/idempotent retries, captured-payment activation, shipment hooks, renewal recovery and existing lead behavior.
4. Exercise authenticated dashboard actions, stale offer edits, HTML upload/preview, Meta pending/rejected/disabled versions, MSG91 readiness, Lemlist pause conflicts, consent suppression, OTP and duplicate signed QStash deliveries. Validate native callback normalization/correlation and failure replay against actual account fixtures.
5. Configure verified Brevo sender/domain and webhook, version-specific Meta template mappings/subscriptions, external telecom DLT approval plus MSG91 mapping, and isolated paused Lemlist campaigns/steps. Real template submission/sync/send requires separate explicit approval; none was done here.
6. Configure QStash keys/base URL and the single signed dispatcher schedule. Observe backlog age, lane throughput, provider rate limits, leases, projection lag, audience timings and DLQ. Backfill bounded feature state before historical segmentation; migrate only trustworthy consent evidence.
7. Deploy ingestion/CORS, publish GTM Preview-tested transport/accessor, then publish Framer headers. Verify GA4/Clarity and commerce remain healthy. Only then apply the manual analytics lockdown and verify anonymous denial/operator reads/server ingestion.
8. Repeat staging acceptance against production configuration under a controlled approved rollout. Keep rules paused/draft and dry-run enabled until acceptance and communication authorization are explicit.

## 27. Rollback

Pause active rules and the single QStash schedule; keep dry-run true and provider mutations false. Stop new external sends while retaining outbox/delivery/version/identity history for reconciliation. Roll back application behavior to a reviewed compatible build; the original pre-auth application would reopen public operator endpoints, so it is not a safe blanket security rollback. Preserve additive tables and migrations. Disable narrowly scoped capture triggers only through a reviewed operational change if necessary; recover lost projections later. Do not delete commerce or reset receipts/totals blindly.

After analytics lockdown, keep server ingestion or a reviewed secure fallback. Do not restore broad anonymous reads. External provider/Framer/GTM configuration rollback is a separate manual operation; coordinate it with the deployed endpoint and CORS version.

## 28. Outstanding production risks and incomplete scope

- No production migrations/deployment, authenticated browser acceptance, real provider sends, native MSG91/Lemlist callback fixtures, production query plans or throughput/load tests were performed.
- Native MSG91/Lemlist callback contracts are implemented from current official documentation but actual account fixtures/shared-secret settings remain unverified. Older Lemlist events without stable campaign/step correlation are acknowledged without attribution. Meta refresh conservatively compares components and can reject provider-normalized content.
- OTP does not issue a customer session, upgrade identity links, or react automatically to delayed failed-delivery callbacks. No verified-contact lead/customer linking was invented from unverified columns.
- Quiet hours suppress rather than defer. Historical correction/refund reconciliation and recovery of original message intents are incomplete. Read-model affinity/friction is limited to available tracker facts; no Clarity signal ingestion or behavioral complaint messaging is implemented.
- Metrics are bounded samples; full historical analytics, an asset uploader, advanced WhatsApp media rendering, distributed ingest abuse controls and complete offer shipping/entitlement simulation are outside the implemented surface. Template pickers currently load 100 versions/artifacts; larger libraries need filtered/paged selectors.
- Transactional content requires a valid correlated event/order and declared variables; missing values fail safely. Missing single-minute QStash setup causes daily dispatch latency. Provider flow-control and SQL timeout assumptions must be checked against the actual plans/deployment.
- Anonymous analytics exposure persists until the deliberately gated manual lockdown. Migration indexes/DDL require live-size/lock-budget review. The Next/React major upgrade and existing workspace changes require staging commerce regression checks.

## Final execution ledger

Observed final results: `npm run typecheck` passed; `npm test` passed **27 files / 142 tests**; `npm run build` passed using dummy credentials; `npm audit --json` reported **zero known vulnerabilities**. All historical/new migrations applied in disposable PGlite. The 500,000-feature plan used an index scan and bounded keyset pages. Local production HTTP checks returned root 307 to `/login`, 401 for protected admin/provider reads and unsigned QStash consumer, and rejected the anonymous WhatsApp mutation. Browser inspection confirmed the anonymous login boundary; authenticated acceptance remains unperformed.

`npm run lint` prompted for configuration because the repository has no ESLint setup; no lint success is claimed. `git diff --check` could not run because Git is unavailable. `node scripts/check-workspace.mjs` verified stored baseline blobs and found zero changed-line whitespace findings; existing Dashboard UTF-8 punctuation/arrows were preserved. This fallback is not a substitute for a reviewed commit/diff once Git is restored. Local test servers were stopped after verification. Nothing was deployed or externally sent.
